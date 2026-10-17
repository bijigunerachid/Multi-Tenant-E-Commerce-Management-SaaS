import { Prisma } from '@prisma/client';
import { AppError, conflict, notFound } from '../../utils/errors.js';
import { recordAudit } from '../../utils/audit.js';
import { formatMoney } from '../../utils/money.js';
import { csvRow } from '../../utils/csv.js';
import { applyStockChange } from '../inventory/inventory.service.js';
import { TRANSITIONS, allowedActions, canTransition } from './stateMachine.js';
import { computeTotals } from './totals.js';

export const MAX_EXPORT_ROWS = 100_000;
const EXPORT_BATCH = 1000;
const FIRST_ORDER_NUMBER = 1001;

const SORTS = {
  '-createdAt': [{ createdAt: 'desc' }, { id: 'asc' }],
  createdAt: [{ createdAt: 'asc' }, { id: 'asc' }],
  '-placedAt': [{ placedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
  '-total': [{ total: 'desc' }, { id: 'asc' }],
  total: [{ total: 'asc' }, { id: 'asc' }],
  '-number': [{ number: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
};
export const ORDER_SORTS = Object.keys(SORTS);

const validation = (fieldErrors, message = 'Some fields are invalid') =>
  new AppError(400, 'VALIDATION_FAILED', message, { fieldErrors });

const PAST_TENSE = {
  place: 'placed',
  confirm: 'confirmed',
  start: 'started',
  ship: 'shipped',
  deliver: 'delivered',
  cancel: 'cancelled',
};

const STATUS_TIMESTAMP = {
  PENDING: 'placedAt',
  SHIPPED: 'shippedAt',
  DELIVERED: 'deliveredAt',
  CANCELLED: 'cancelledAt',
};

function presentItem(item) {
  return {
    id: item.id,
    variantId: item.variantId,
    productName: item.productName,
    variantName: item.variantName,
    sku: item.sku,
    unitPrice: formatMoney(item.unitPrice),
    quantity: item.quantity,
    lineTotal: formatMoney(item.lineTotal),
    reservation: item.reservation ? item.reservation.status : null,
  };
}

function presentOrder(order, actorNames = new Map()) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    allowedActions: allowedActions(order.status),
    store: order.store ? { id: order.store.id, name: order.store.name } : { id: order.storeId },
    customer: order.customerId
      ? { id: order.customerId, name: order.customerName, email: order.customerEmail }
      : null,
    shippingAddress: order.shippingAddress,
    currency: order.currency,
    subtotal: formatMoney(order.subtotal),
    discountTotal: formatMoney(order.discountTotal),
    taxRate: order.taxRate.toString(),
    taxTotal: formatMoney(order.taxTotal),
    shippingTotal: formatMoney(order.shippingTotal),
    total: formatMoney(order.total),
    notes: order.notes,
    cancelReason: order.cancelReason,
    items: (order.items ?? []).map(presentItem),
    history: (order.history ?? []).map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      note: h.note,
      actor: h.actorUserId
        ? { id: h.actorUserId, name: actorNames.get(h.actorUserId) ?? null }
        : null,
      createdAt: h.createdAt,
    })),
    placedAt: order.placedAt,
    shippedAt: order.shippedAt,
    deliveredAt: order.deliveredAt,
    cancelledAt: order.cancelledAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function presentListItem(order) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    customer: order.customerId ? { id: order.customerId, name: order.customerName } : null,
    itemCount: order.items.reduce((n, i) => n + i.quantity, 0),
    total: formatMoney(order.total),
    currency: order.currency,
    placedAt: order.placedAt,
    createdAt: order.createdAt,
  };
}

function listWhere({ status, customerId, search, from, to }) {
  const where = {};
  if (status) where.status = status;
  if (customerId) where.customerId = customerId;
  if (from || to) where.placedAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
  if (search) {
    const number = /^#?\d{1,9}$/.test(search) ? Number(search.replace('#', '')) : null;
    where.OR = [
      ...(number ? [{ number }] : []),
      { customerName: { contains: search, mode: 'insensitive' } },
      { customerEmail: { contains: search, mode: 'insensitive' } },
      { items: { some: { sku: { contains: search, mode: 'insensitive' } } } },
    ];
  }
  return where;
}

export function createOrderService() {
  async function resolveStore(db, storeId) {
    const store = storeId
      ? await db.store.findUnique({ where: { id: storeId } })
      : await db.store.findFirst({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
    if (!store || store.status !== 'ACTIVE')
      throw validation({ storeId: 'Choose an active store' });
    return store;
  }

  /** Customer, shipping-address snapshot and customer snapshot for an order. */
  async function resolveCustomer(db, { customerId, shippingAddressId, shippingAddress }) {
    if (!customerId) {
      if (shippingAddressId) throw validation({ shippingAddressId: 'Choose a customer first' });
      return { customer: null, address: shippingAddress ?? null };
    }
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw validation({ customerId: 'Choose a valid customer' });
    if (customer.archivedAt) throw validation({ customerId: 'This customer is archived' });
    let address = shippingAddress ?? null;
    if (shippingAddressId) {
      const saved = await db.address.findFirst({ where: { id: shippingAddressId, customerId } });
      if (!saved)
        throw validation({ shippingAddressId: 'Choose one of this customer’s addresses' });
      address = {
        recipientName: saved.recipientName ?? customer.name,
        line1: saved.line1,
        line2: saved.line2,
        city: saved.city,
        region: saved.region,
        postalCode: saved.postalCode,
        country: saved.country,
        phone: saved.phone ?? customer.phone,
      };
    }
    return { customer, address };
  }

  /** Loads the variants, checks they can be sold, and snapshots name, SKU and price. */
  async function buildLines(db, items) {
    const errors = {};
    const seen = new Set();
    items.forEach((item, i) => {
      if (seen.has(item.variantId))
        errors[`items.${i}.variantId`] = 'This product is already in the order';
      seen.add(item.variantId);
    });
    const variants = await db.productVariant.findMany({
      where: { id: { in: [...seen] } },
      include: { product: { select: { name: true, status: true } } },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    items.forEach((item, i) => {
      const variant = byId.get(item.variantId);
      if (!variant) errors[`items.${i}.variantId`] ??= 'Choose a valid product';
      else if (variant.product.status !== 'ACTIVE')
        errors[`items.${i}.variantId`] ??= 'This product is not for sale';
    });
    const currencies = new Set(variants.map((v) => v.currency));
    if (currencies.size > 1) errors.items = 'All products in an order must use the same currency';
    if (Object.keys(errors).length) throw validation(errors);

    return items.map((item, position) => {
      const v = byId.get(item.variantId);
      return {
        variantId: v.id,
        productName: v.product.name,
        variantName: v.name,
        sku: v.sku,
        unitPrice: v.price,
        quantity: item.quantity,
        position,
        currency: v.currency,
      };
    });
  }

  async function prepare(db, input) {
    const store = await resolveStore(db, input.storeId);
    const { customer, address } = await resolveCustomer(db, input);
    const lines = await buildLines(db, input.items);
    const totals = computeTotals({
      lines,
      discountTotal: input.discountTotal,
      shippingTotal: input.shippingTotal,
      taxRate: input.taxRate,
    });
    if (totals.error) throw validation({ [totals.error.field]: totals.error.message });
    return {
      order: {
        storeId: store.id,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        customerEmail: customer?.email ?? null,
        shippingAddress: address ?? Prisma.DbNull,
        currency: lines[0].currency,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxRate: totals.taxRate,
        taxTotal: totals.taxTotal,
        shippingTotal: totals.shippingTotal,
        total: totals.total,
        notes: input.notes ?? null,
      },
      items: totals.lines.map(({ currency: _c, ...line }) => line),
    };
  }

  async function loadOrder(db, orderId) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        store: { select: { id: true, name: true } },
        items: {
          orderBy: { position: 'asc' },
          include: { reservation: { select: { status: true } } },
        },
        history: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw notFound('Order not found');
    return order;
  }

  async function presentWithActors(db, order) {
    const ids = [...new Set(order.history.map((h) => h.actorUserId).filter(Boolean))];
    const users = await db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return presentOrder(order, new Map(users.map((u) => [u.id, u.name])));
  }

  /** Locks the order row for the rest of the transaction and returns its status. */
  async function lockOrder(tx, organizationId, orderId) {
    const [row] = await tx.$queryRaw`
      SELECT id, status, store_id AS "storeId", number FROM orders
      WHERE organization_id = ${organizationId}::uuid AND id = ${orderId}::uuid
      FOR UPDATE`;
    if (!row) throw notFound('Order not found');
    return row;
  }

  async function nextOrderNumber(tx, organizationId) {
    const [{ number }] = await tx.$queryRaw`
      INSERT INTO organization_counters (organization_id, last_order_number)
      VALUES (${organizationId}::uuid, ${FIRST_ORDER_NUMBER})
      ON CONFLICT (organization_id)
      DO UPDATE SET last_order_number = organization_counters.last_order_number + 1
      RETURNING last_order_number AS number`;
    return number;
  }

  return {
    async list(req, { page, pageSize, sort, ...filters }) {
      const where = listWhere(filters);
      const [rows, total] = await Promise.all([
        req.db.order.findMany({
          where,
          orderBy: SORTS[sort],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { items: { select: { quantity: true } } },
        }),
        req.db.order.count({ where }),
      ]);
      return { data: rows.map(presentListItem), meta: { page, pageSize, total } };
    },

    async get(req, orderId) {
      return presentWithActors(req.db, await loadOrder(req.db, orderId));
    },

    async createDraft(req, input) {
      const { order, items } = await prepare(req.db, input);
      const id = await req.db.$transaction(async (tx) => {
        const created = await tx.order.create({ data: { ...order, createdById: req.user.id } });
        await tx.orderItem.createMany({ data: items.map((i) => ({ ...i, orderId: created.id })) });
        return created.id;
      });
      return presentWithActors(req.db, await loadOrder(req.db, id));
    },

    /** Replaces a draft's contents. Prices are re-read from the catalog. */
    async updateDraft(req, orderId, input) {
      // Existence first: an id from another organization is "not found", whatever the body.
      if (!(await req.db.order.findUnique({ where: { id: orderId }, select: { id: true } }))) {
        throw notFound('Order not found');
      }
      const { order, items } = await prepare(req.db, input);
      await req.db.$transaction(async (tx) => {
        const locked = await lockOrder(tx, req.ctx.organizationId, orderId);
        if (locked.status !== 'DRAFT') {
          throw conflict('ORDER_NOT_EDITABLE', 'Only draft orders can be edited');
        }
        await tx.orderItem.deleteMany({ where: { orderId } });
        await tx.order.update({ where: { id: orderId }, data: order });
        await tx.orderItem.createMany({ data: items.map((i) => ({ ...i, orderId })) });
      });
      return presentWithActors(req.db, await loadOrder(req.db, orderId));
    },

    async deleteDraft(req, orderId) {
      await req.db.$transaction(async (tx) => {
        const locked = await lockOrder(tx, req.ctx.organizationId, orderId);
        if (locked.status !== 'DRAFT') {
          throw conflict(
            'ORDER_NOT_EDITABLE',
            'Only draft orders can be deleted. Cancel the order instead.',
          );
        }
        await tx.order.delete({ where: { id: orderId } });
      });
    },

    /**
     * Applies a lifecycle action. The order row is locked first, so concurrent actions on the
     * same order are serialised and the second one sees the new status.
     */
    async transition(req, orderId, action, { note, reason } = {}) {
      const org = req.ctx.organizationId;
      await req.db.$transaction(async (tx) => {
        const locked = await lockOrder(tx, org, orderId);
        if (!canTransition(locked.status, action)) {
          throw conflict(
            'INVALID_TRANSITION',
            `A ${locked.status.toLowerCase()} order cannot be ${PAST_TENSE[action]}`,
            {
              status: locked.status,
              action,
              allowedActions: allowedActions(locked.status),
            },
          );
        }
        const toStatus = TRANSITIONS[action].to;
        const items = await tx.orderItem.findMany({
          where: { orderId },
          orderBy: { position: 'asc' },
          include: { reservation: true },
        });
        const data = { status: toStatus };
        if (STATUS_TIMESTAMP[toStatus]) data[STATUS_TIMESTAMP[toStatus]] = new Date();

        if (action === 'place') {
          data.number = await nextOrderNumber(tx, org);
          for (const [index, item] of items.entries()) {
            let applied;
            try {
              applied = await applyStockChange(tx, {
                organizationId: org,
                storeId: locked.storeId,
                variantId: item.variantId,
                reservedDelta: item.quantity,
                type: 'RESERVE',
                actorUserId: req.user.id,
                orderId,
              });
            } catch (err) {
              if (err.code !== 'INSUFFICIENT_STOCK') throw err;
              const available = Math.max(0, err.details?.available ?? 0);
              throw new AppError(
                409,
                'INSUFFICIENT_STOCK',
                `Not enough stock for ${item.sku}: ${available} available, ${item.quantity} ordered`,
                {
                  fieldErrors: { [`items.${index}.quantity`]: `Only ${available} available` },
                  sku: item.sku,
                  available,
                  requested: item.quantity,
                },
              );
            }
            await tx.inventoryReservation.create({
              data: {
                orderItemId: item.id,
                inventoryLevelId: applied.levelId,
                quantity: item.quantity,
              },
            });
          }
        }

        if (action === 'ship' || action === 'cancel') {
          const shipping = action === 'ship';
          for (const item of items) {
            const reservation = item.reservation;
            if (!reservation || reservation.status !== 'ACTIVE') continue;
            // Each reservation changes state exactly once, even under concurrency.
            const { count } = await tx.inventoryReservation.updateMany({
              where: { id: reservation.id, status: 'ACTIVE' },
              data: { status: shipping ? 'CONSUMED' : 'RELEASED' },
            });
            if (count !== 1)
              throw conflict(
                'INVALID_TRANSITION',
                'The order changed meanwhile. Reload and try again.',
              );
            await applyStockChange(tx, {
              organizationId: org,
              storeId: locked.storeId,
              variantId: item.variantId,
              onHandDelta: shipping ? -reservation.quantity : 0,
              reservedDelta: -reservation.quantity,
              type: shipping ? 'FULFIL' : 'RELEASE',
              actorUserId: req.user.id,
              orderId,
            });
          }
          if (!shipping) data.cancelReason = reason;
        }

        await tx.order.update({ where: { id: orderId }, data });
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            fromStatus: locked.status,
            toStatus,
            note: note ?? reason ?? null,
            actorUserId: req.user.id,
          },
        });
        if (action === 'cancel') {
          await recordAudit(tx, req, {
            action: 'order.cancelled',
            entityType: 'Order',
            entityId: orderId,
            metadata: { number: locked.number, from: locked.status },
          });
        }
      });
      return presentWithActors(req.db, await loadOrder(req.db, orderId));
    },

    /** Active variants of active products with price and the stock available in a store. */
    async sellableVariants(req, { storeId, search, limit }) {
      const store = await resolveStore(req.db, storeId);
      const pattern = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      const rows = await req.db.$queryRaw`
        SELECT v.id, v.sku, v.name AS "variantName", v.price, v.currency, p.name AS "productName",
               COALESCE(l.on_hand, 0) - COALESCE(l.reserved, 0) AS available
        FROM product_variants v
        JOIN products p ON p.organization_id = v.organization_id AND p.id = v.product_id
        LEFT JOIN inventory_levels l
          ON l.organization_id = v.organization_id AND l.variant_id = v.id AND l.store_id = ${store.id}::uuid
        WHERE v.organization_id = ${req.ctx.organizationId}::uuid
          AND p.status = 'ACTIVE'
          ${pattern ? Prisma.sql`AND (p.name ILIKE ${pattern} OR v.sku ILIKE ${pattern})` : Prisma.empty}
        ORDER BY p.name, v.position
        LIMIT ${limit}`;
      return rows.map((r) => ({
        variantId: r.id,
        sku: r.sku,
        productName: r.productName,
        variantName: r.variantName,
        price: formatMoney(r.price),
        currency: r.currency,
        available: r.available,
      }));
    },

    async exportCsv(req, res, filters) {
      const where = listWhere(filters);
      const total = await req.db.order.count({ where });
      if (total > MAX_EXPORT_ROWS) {
        throw conflict(
          'EXPORT_TOO_LARGE',
          `Narrow the filters: exports are limited to ${MAX_EXPORT_ROWS} orders`,
        );
      }
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="orders-${date}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      res.write('\uFEFF');
      res.write(
        csvRow([
          'Number',
          'Status',
          'Placed',
          'Customer',
          'Email',
          'Items',
          'Subtotal',
          'Discount',
          'Tax',
          'Shipping',
          'Total',
          'Currency',
        ]),
      );
      let cursor = null;
      let written = 0;
      for (;;) {
        const batch = await req.db.order.findMany({
          where,
          orderBy: { id: 'asc' },
          take: EXPORT_BATCH,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          include: { items: { select: { quantity: true } } },
        });
        for (const o of batch) {
          res.write(
            csvRow([
              o.number ?? 'Draft',
              o.status,
              o.placedAt,
              o.customerName,
              o.customerEmail,
              o.items.reduce((n, i) => n + i.quantity, 0),
              formatMoney(o.subtotal),
              formatMoney(o.discountTotal),
              formatMoney(o.taxTotal),
              formatMoney(o.shippingTotal),
              formatMoney(o.total),
              o.currency,
            ]),
          );
        }
        written += batch.length;
        if (batch.length < EXPORT_BATCH) break;
        cursor = batch.at(-1).id;
      }
      await recordAudit(req.db, req, {
        action: 'order.exported',
        entityType: 'Order',
        metadata: { rows: written, status: filters.status ?? null },
      });
      res.end();
    },
  };
}
