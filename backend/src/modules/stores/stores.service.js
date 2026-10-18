import { randomBytes } from 'node:crypto';
import { AppError, conflict, notFound, isUniqueViolation } from '../../utils/errors.js';
import { recordAudit } from '../../utils/audit.js';
import { slugify } from '../../utils/schemas.js';
import { assertWithinLimit, lockUsage } from '../billing/limits.js';

// Stores: created and renamed by owners (org:update), within the plan's store limit.
// - The currency is fixed at creation: orders and stock values are recorded in it.
// - Archiving keeps the store's history (orders, movements) and stops new stock changes and
//   orders in it. It is refused for the last active store and while orders are still open
//   there (drafts included: placing one would reserve stock in an archived store).
// - Restoring an archived store counts against the limit again.

const OPEN_ORDER_STATUSES = ['DRAFT', 'PENDING', 'CONFIRMED', 'PROCESSING'];

export function presentStore(s) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    currency: s.currency,
    timezone: s.timezone,
    status: s.status,
  };
}

export function createStoreService() {
  async function load(db, storeId) {
    const store = await db.store.findUnique({ where: { id: storeId } });
    if (!store) throw notFound('Store not found');
    return store;
  }

  return {
    async list(req) {
      const stores = await req.db.store.findMany({ orderBy: { createdAt: 'asc' } });
      return stores.map(presentStore);
    },

    async create(req, { name, currency, timezone }) {
      let slug = slugify(name) || 'store';
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          return await req.db.$transaction(async (tx) => {
            await assertWithinLimit(tx, req.ctx, 'stores');
            const store = await tx.store.create({ data: { name, slug, currency, timezone } });
            await recordAudit(tx, req, {
              action: 'store.created',
              entityType: 'Store',
              entityId: store.id,
              metadata: { name, currency },
            });
            return presentStore(store);
          });
        } catch (err) {
          if (!isUniqueViolation(err, 'slug')) throw err;
          slug = `${(slugify(name) || 'store').slice(0, 50)}-${randomBytes(3).toString('hex')}`;
        }
      }
      throw new AppError(503, 'SLUG_UNAVAILABLE', 'Could not create the store. Try again.');
    },

    async update(req, storeId, changes) {
      const store = await load(req.db, storeId);
      const data = Object.fromEntries(
        Object.entries(changes).filter(
          ([key, value]) => value !== undefined && value !== store[key],
        ),
      );
      if (Object.keys(data).length === 0) return presentStore(store);
      return req.db.$transaction(async (tx) => {
        const updated = await tx.store.update({ where: { id: storeId }, data });
        await recordAudit(tx, req, {
          action: 'store.updated',
          entityType: 'Store',
          entityId: storeId,
          metadata: { changed: Object.keys(data) },
        });
        return presentStore(updated);
      });
    },

    async archive(req, storeId) {
      return req.db.$transaction(async (tx) => {
        // Same lock as the store limit, so two archives at once cannot leave no active store.
        await lockUsage(tx, req.ctx.organizationId, 'stores');
        const store = await load(tx, storeId);
        if (store.status === 'ARCHIVED') return presentStore(store);
        const active = await tx.store.count({ where: { status: 'ACTIVE' } });
        if (active <= 1) {
          throw conflict('LAST_ACTIVE_STORE', 'An organization needs at least one active store');
        }
        const openOrders = await tx.order.count({
          where: { storeId, status: { in: OPEN_ORDER_STATUSES } },
        });
        if (openOrders > 0) {
          throw conflict(
            'STORE_HAS_OPEN_ORDERS',
            `This store has ${openOrders} open ${openOrders === 1 ? 'order' : 'orders'} (drafts included). Ship, cancel or delete them first.`,
            { openOrders },
          );
        }
        const updated = await tx.store.update({
          where: { id: storeId },
          data: { status: 'ARCHIVED' },
        });
        await recordAudit(tx, req, {
          action: 'store.archived',
          entityType: 'Store',
          entityId: storeId,
        });
        return presentStore(updated);
      });
    },

    async restore(req, storeId) {
      return req.db.$transaction(async (tx) => {
        const store = await load(tx, storeId);
        if (store.status === 'ACTIVE') return presentStore(store);
        await assertWithinLimit(tx, req.ctx, 'stores');
        const updated = await tx.store.update({
          where: { id: storeId },
          data: { status: 'ACTIVE' },
        });
        await recordAudit(tx, req, {
          action: 'store.restored',
          entityType: 'Store',
          entityId: storeId,
        });
        return presentStore(updated);
      });
    },
  };
}
