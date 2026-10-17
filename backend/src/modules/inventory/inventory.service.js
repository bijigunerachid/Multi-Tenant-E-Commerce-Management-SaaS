import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppError, conflict, notFound } from '../../utils/errors.js';
import { recordAudit } from '../../utils/audit.js';
import { formatMoney } from '../../utils/money.js';
import { recordNotificationEvent } from '../notifications/events.js';

// Inventory rules (see docs/data-model.md):
// - Every quantity change is ONE conditional SQL statement: the condition and the change are
//   evaluated atomically by PostgreSQL, so concurrent requests cannot oversell. There is no
//   "read the quantity, check it in JavaScript, write it back".
// - CHECK constraints (on_hand >= 0, 0 <= reserved <= on_hand) back this up in the database.
// - Every change writes an InventoryMovement in the same transaction.
// - Raw SQL is not scoped by tenantDb, so every statement filters organization_id itself.
// - A change that makes a level's status worse (in stock → low → out) records a low-stock
//   notification event in the same transaction. It fires on the crossing only: stock that
//   stays low does not notify again until it has gone back above the threshold.

const insufficient = (details) =>
  new AppError(409, 'INSUFFICIENT_STOCK', 'Not enough stock for this change', details);
const fieldError = (field, message) =>
  new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid', {
    fieldErrors: { [field]: message },
  });

export const STOCK_FILTERS = ['attention', 'low', 'out', 'in'];
const SORTS = {
  product: Prisma.sql`p.name ASC, v.position ASC`,
  sku: Prisma.sql`v.sku ASC`,
  available: Prisma.sql`available ASC, v.sku ASC`,
  '-available': Prisma.sql`available DESC, v.sku ASC`,
};
export const INVENTORY_SORTS = Object.keys(SORTS);

export function stockStatus(available, threshold) {
  if (available <= 0) return 'OUT';
  if (available <= threshold) return 'LOW';
  return 'OK';
}
const SEVERITY = { OK: 0, LOW: 1, OUT: 2 };

const escapeLike = (value) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Applies one stock change and records it. Usable inside any transaction (`tx`).
 * Throws 409 INSUFFICIENT_STOCK when the change would break an invariant.
 */
export async function applyStockChange(
  tx,
  {
    organizationId,
    storeId,
    variantId,
    onHandDelta = 0,
    reservedDelta = 0,
    type,
    reason = null,
    note = null,
    actorUserId = null,
    orderId = null,
  },
) {
  if (!Number.isInteger(onHandDelta) || !Number.isInteger(reservedDelta)) {
    throw new Error('Stock deltas must be integers');
  }
  if (onHandDelta === 0 && reservedDelta === 0) throw new Error('Stock change must not be empty');

  const threshold = Prisma.sql`(SELECT low_stock_threshold FROM product_variants
    WHERE organization_id = ${organizationId}::uuid AND id = ${variantId}::uuid)`;
  let rows;
  if (reservedDelta === 0 && onHandDelta > 0) {
    // Adding stock never violates an invariant: create the level on first receipt.
    rows = await tx.$queryRaw`
      INSERT INTO inventory_levels (id, organization_id, store_id, variant_id, on_hand, reserved, created_at, updated_at)
      VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${storeId}::uuid, ${variantId}::uuid, ${onHandDelta}, 0, now(), now())
      ON CONFLICT (organization_id, store_id, variant_id)
      DO UPDATE SET on_hand = inventory_levels.on_hand + EXCLUDED.on_hand, updated_at = now()
      RETURNING id, on_hand AS "onHand", reserved, ${threshold} AS threshold`;
  } else {
    rows = await tx.$queryRaw`
      UPDATE inventory_levels
      SET on_hand = on_hand + ${onHandDelta}, reserved = reserved + ${reservedDelta}, updated_at = now()
      WHERE organization_id = ${organizationId}::uuid
        AND store_id = ${storeId}::uuid
        AND variant_id = ${variantId}::uuid
        AND on_hand + ${onHandDelta} >= 0
        AND reserved + ${reservedDelta} >= 0
        AND reserved + ${reservedDelta} <= on_hand + ${onHandDelta}
      RETURNING id, on_hand AS "onHand", reserved, ${threshold} AS threshold`;
  }

  if (rows.length === 0) {
    const [level] = await tx.$queryRaw`
      SELECT on_hand AS "onHand", reserved FROM inventory_levels
      WHERE organization_id = ${organizationId}::uuid AND store_id = ${storeId}::uuid AND variant_id = ${variantId}::uuid`;
    const onHand = level?.onHand ?? 0;
    const reserved = level?.reserved ?? 0;
    throw insufficient({ onHand, reserved, available: onHand - reserved });
  }

  const level = rows[0];
  const movement = await tx.inventoryMovement.create({
    data: {
      organizationId,
      inventoryLevelId: level.id,
      type,
      onHandDelta,
      reservedDelta,
      onHandAfter: level.onHand,
      reservedAfter: level.reserved,
      reason,
      note,
      actorUserId,
      orderId,
    },
  });

  const available = level.onHand - level.reserved;
  const status = stockStatus(available, level.threshold);
  const before = stockStatus(available - (onHandDelta - reservedDelta), level.threshold);
  if (SEVERITY[status] > SEVERITY[before]) {
    await recordNotificationEvent(tx, {
      organizationId,
      type: 'inventory.low_stock',
      payload: { storeId, variantId, status, available, threshold: level.threshold },
      actorUserId,
    });
  }
  return { levelId: level.id, onHand: level.onHand, reserved: level.reserved, movement };
}

export function createInventoryService() {
  async function resolveStore(db, storeId) {
    if (storeId) {
      const store = await db.store.findUnique({ where: { id: storeId } });
      if (!store) throw fieldError('storeId', 'Choose a valid store');
      return store;
    }
    const store = await db.store.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!store) throw conflict('NO_STORE', 'Create a store first');
    return store;
  }

  async function resolveVariant(db, variantId) {
    const variant = await db.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { name: true } } },
    });
    if (!variant) throw fieldError('variantId', 'Choose a valid product variant');
    return variant;
  }

  async function writableStore(db, storeId) {
    const store = await resolveStore(db, storeId);
    if (store.status !== 'ACTIVE') throw fieldError('storeId', 'This store is archived');
    return store;
  }

  function presentLevel(store, variant, result) {
    return {
      storeId: store.id,
      variantId: variant.id,
      sku: variant.sku,
      productName: variant.product.name,
      variantName: variant.name,
      onHand: result.onHand,
      reserved: result.reserved,
      available: result.onHand - result.reserved,
      status: stockStatus(result.onHand - result.reserved, variant.lowStockThreshold),
      movementId: result.movement?.id ?? null,
    };
  }

  return {
    async list(req, { storeId, search, categoryId, stock, sort, page, pageSize, includeArchived }) {
      const store = await resolveStore(req.db, storeId);
      const org = req.ctx.organizationId;

      const conditions = [Prisma.sql`v.organization_id = ${org}::uuid`];
      if (!includeArchived) conditions.push(Prisma.sql`p.status <> 'ARCHIVED'`);
      if (categoryId) conditions.push(Prisma.sql`p.category_id = ${categoryId}::uuid`);
      if (search) {
        const pattern = `%${escapeLike(search)}%`;
        conditions.push(Prisma.sql`(p.name ILIKE ${pattern} OR v.sku ILIKE ${pattern})`);
      }
      const available = Prisma.sql`(COALESCE(l.on_hand, 0) - COALESCE(l.reserved, 0))`;
      if (stock === 'attention') conditions.push(Prisma.sql`${available} <= v.low_stock_threshold`);
      if (stock === 'low')
        conditions.push(Prisma.sql`${available} > 0 AND ${available} <= v.low_stock_threshold`);
      if (stock === 'out') conditions.push(Prisma.sql`${available} <= 0`);
      if (stock === 'in') conditions.push(Prisma.sql`${available} > v.low_stock_threshold`);
      const where = Prisma.join(conditions, ' AND ');

      const from = Prisma.sql`
        FROM product_variants v
        JOIN products p ON p.organization_id = v.organization_id AND p.id = v.product_id
        LEFT JOIN inventory_levels l
          ON l.organization_id = v.organization_id AND l.variant_id = v.id AND l.store_id = ${store.id}::uuid`;

      const [rows, [{ total }]] = await Promise.all([
        req.db.$queryRaw`
          SELECT v.id AS "variantId", v.sku, v.name AS "variantName", v.low_stock_threshold AS "lowStockThreshold",
                 v.cost, v.currency, p.id AS "productId", p.name AS "productName", p.status AS "productStatus",
                 COALESCE(l.on_hand, 0) AS "onHand", COALESCE(l.reserved, 0) AS reserved, ${available} AS available,
                 l.updated_at AS "updatedAt"
          ${from}
          WHERE ${where}
          ORDER BY ${SORTS[sort]}
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        req.db.$queryRaw`SELECT COUNT(*)::int AS total ${from} WHERE ${where}`,
      ]);

      return {
        data: rows.map((r) => ({
          variantId: r.variantId,
          productId: r.productId,
          productName: r.productName,
          productStatus: r.productStatus,
          variantName: r.variantName,
          sku: r.sku,
          onHand: r.onHand,
          reserved: r.reserved,
          available: r.available,
          lowStockThreshold: r.lowStockThreshold,
          status: stockStatus(r.available, r.lowStockThreshold),
          unitCost: formatMoney(r.cost),
          stockValue: r.cost === null ? null : formatMoney(r.cost.mul(r.onHand)),
          currency: r.currency,
          updatedAt: r.updatedAt,
        })),
        meta: { page, pageSize, total, store: { id: store.id, name: store.name } },
      };
    },

    /**
     * Totals for one store. Valuation = on hand × unit cost, per currency; variants without a
     * cost are counted separately rather than silently valued at zero.
     */
    async summary(req, { storeId }) {
      const store = await resolveStore(req.db, storeId);
      const org = req.ctx.organizationId;
      const [totals] = await req.db.$queryRaw`
        SELECT COUNT(*)::int AS "variantCount",
               COALESCE(SUM(COALESCE(l.on_hand, 0)), 0)::int AS "unitsOnHand",
               COALESCE(SUM(COALESCE(l.reserved, 0)), 0)::int AS "unitsReserved",
               COUNT(*) FILTER (WHERE COALESCE(l.on_hand, 0) - COALESCE(l.reserved, 0) <= 0)::int AS "outOfStock",
               COUNT(*) FILTER (WHERE COALESCE(l.on_hand, 0) - COALESCE(l.reserved, 0) > 0
                                  AND COALESCE(l.on_hand, 0) - COALESCE(l.reserved, 0) <= v.low_stock_threshold)::int AS "lowStock",
               COUNT(*) FILTER (WHERE v.cost IS NULL AND COALESCE(l.on_hand, 0) > 0)::int AS "unitsWithoutCost"
        FROM product_variants v
        JOIN products p ON p.organization_id = v.organization_id AND p.id = v.product_id
        LEFT JOIN inventory_levels l
          ON l.organization_id = v.organization_id AND l.variant_id = v.id AND l.store_id = ${store.id}::uuid
        WHERE v.organization_id = ${org}::uuid AND p.status <> 'ARCHIVED'`;
      const valuation = await req.db.$queryRaw`
        SELECT v.currency, SUM(l.on_hand * v.cost) AS value
        FROM inventory_levels l
        JOIN product_variants v ON v.organization_id = l.organization_id AND v.id = l.variant_id
        WHERE l.organization_id = ${org}::uuid AND l.store_id = ${store.id}::uuid AND v.cost IS NOT NULL
        GROUP BY v.currency
        ORDER BY v.currency`;
      return {
        store: { id: store.id, name: store.name },
        ...totals,
        valuation: valuation.map((r) => ({ currency: r.currency, value: formatMoney(r.value) })),
      };
    },

    async receive(req, { storeId, variantId, quantity, note }) {
      const store = await writableStore(req.db, storeId);
      const variant = await resolveVariant(req.db, variantId);
      const result = await req.db.$transaction(async (tx) =>
        applyStockChange(tx, {
          organizationId: req.ctx.organizationId,
          storeId: store.id,
          variantId: variant.id,
          onHandDelta: quantity,
          type: 'RECEIPT',
          note: note ?? null,
          actorUserId: req.user.id,
        }),
      );
      return presentLevel(store, variant, result);
    },

    /**
     * Manual adjustment, either by a signed change (-3, +2) or to an absolute counted quantity.
     * A counted quantity locks the row (SELECT … FOR UPDATE) so the delta is computed from a
     * value no one else can change before the update.
     */
    async adjust(req, { storeId, variantId, change, setTo, reason, note }) {
      const store = await writableStore(req.db, storeId);
      const variant = await resolveVariant(req.db, variantId);
      const org = req.ctx.organizationId;

      const result = await req.db.$transaction(async (tx) => {
        let delta = change;
        if (setTo !== undefined) {
          const [level] = await tx.$queryRaw`
            SELECT on_hand AS "onHand", reserved FROM inventory_levels
            WHERE organization_id = ${org}::uuid AND store_id = ${store.id}::uuid AND variant_id = ${variant.id}::uuid
            FOR UPDATE`;
          const onHand = level?.onHand ?? 0;
          if (setTo < (level?.reserved ?? 0)) {
            throw insufficient({
              onHand,
              reserved: level.reserved,
              available: onHand - level.reserved,
              message: `${level.reserved} units are reserved for orders`,
            });
          }
          delta = setTo - onHand;
          if (delta === 0) return null;
        }
        const applied = await applyStockChange(tx, {
          organizationId: org,
          storeId: store.id,
          variantId: variant.id,
          onHandDelta: delta,
          type: 'ADJUSTMENT',
          reason,
          note: note ?? null,
          actorUserId: req.user.id,
        });
        await recordAudit(tx, req, {
          action: 'inventory.adjusted',
          entityType: 'ProductVariant',
          entityId: variant.id,
          metadata: {
            storeId: store.id,
            sku: variant.sku,
            delta,
            reason,
            onHandAfter: applied.onHand,
          },
        });
        return applied;
      });

      if (!result) {
        throw conflict('NO_CHANGE', `${variant.sku} already has ${setTo} units on hand`);
      }
      return presentLevel(store, variant, result);
    },

    async movements(req, { storeId, variantId, type, page, pageSize }) {
      const where = {};
      if (storeId || variantId) {
        where.inventoryLevel = {
          ...(storeId ? { storeId } : {}),
          ...(variantId ? { variantId } : {}),
        };
      }
      if (type) where.type = type;

      const [rows, total] = await Promise.all([
        req.db.inventoryMovement.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            inventoryLevel: {
              select: {
                storeId: true,
                store: { select: { name: true } },
                variant: {
                  select: {
                    id: true,
                    sku: true,
                    name: true,
                    product: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        }),
        req.db.inventoryMovement.count({ where }),
      ]);
      const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))];
      const actors = await req.db.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true },
      });
      const names = new Map(actors.map((a) => [a.id, a.name]));

      return {
        data: rows.map((m) => ({
          id: m.id,
          type: m.type,
          reason: m.reason,
          note: m.note,
          onHandDelta: m.onHandDelta,
          reservedDelta: m.reservedDelta,
          onHandAfter: m.onHandAfter,
          reservedAfter: m.reservedAfter,
          store: { id: m.inventoryLevel.storeId, name: m.inventoryLevel.store.name },
          variant: {
            id: m.inventoryLevel.variant.id,
            sku: m.inventoryLevel.variant.sku,
            name: m.inventoryLevel.variant.name,
          },
          product: m.inventoryLevel.variant.product,
          actor: m.actorUserId
            ? { id: m.actorUserId, name: names.get(m.actorUserId) ?? null }
            : null,
          orderId: m.orderId,
          createdAt: m.createdAt,
        })),
        meta: { page, pageSize, total },
      };
    },

    async variantLevels(req, variantId) {
      const variant = await req.db.productVariant.findUnique({ where: { id: variantId } });
      if (!variant) throw notFound('Variant not found');
      const levels = await req.db.inventoryLevel.findMany({
        where: { variantId },
        include: { store: { select: { id: true, name: true } } },
      });
      return levels.map((l) => ({
        store: l.store,
        onHand: l.onHand,
        reserved: l.reserved,
        available: l.onHand - l.reserved,
        status: stockStatus(l.onHand - l.reserved, variant.lowStockThreshold),
      }));
    },
  };
}
