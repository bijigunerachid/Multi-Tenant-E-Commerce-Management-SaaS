import { AppError, conflict, notFound, isUniqueViolation } from '../../utils/errors.js';
import { recordAudit } from '../../utils/audit.js';
import { csvRow } from '../../utils/csv.js';
import { formatMoney } from '../../utils/money.js';

export const MAX_EXPORT_ROWS = 100_000;
const EXPORT_BATCH = 1000;

const SORTS = {
  name: [{ name: 'asc' }, { id: 'asc' }],
  '-name': [{ name: 'desc' }, { id: 'asc' }],
  '-createdAt': [{ createdAt: 'desc' }, { id: 'asc' }],
  createdAt: [{ createdAt: 'asc' }, { id: 'asc' }],
};
export const CUSTOMER_SORTS = Object.keys(SORTS);

const emailTaken = () =>
  conflict('EMAIL_TAKEN', 'Another customer already uses this email', {
    fieldErrors: { email: 'Another customer already uses this email' },
  });
const isForeignKeyViolation = (err) => err?.code === 'P2003';

function presentAddress(a) {
  return {
    id: a.id,
    label: a.label,
    recipientName: a.recipientName,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    region: a.region,
    postalCode: a.postalCode,
    country: a.country,
    phone: a.phone,
    isDefault: a.defaultForCustomerId !== null,
  };
}

function presentCustomer(c) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    archived: c.archivedAt !== null,
    addresses: (c.addresses ?? []).map(presentAddress),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function presentListItem(c) {
  const address = c.addresses[0];
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    archived: c.archivedAt !== null,
    location: address ? { city: address.city, country: address.country } : null,
    createdAt: c.createdAt,
  };
}

// "Spending" counts orders that were placed and not cancelled (pending through delivered).
// Drafts were never placed; cancelled orders were not paid for. Amounts are kept per currency
// and never added across currencies.
const COUNTED_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];

/** Map of customerId -> { orderCount, spent: [{ currency, total }], firstOrderAt, lastOrderAt }. */
async function purchaseStats(db, customerIds) {
  const stats = new Map();
  if (customerIds.length === 0) return stats;
  const groups = await db.order.groupBy({
    by: ['customerId', 'currency'],
    where: { customerId: { in: customerIds }, status: { in: COUNTED_STATUSES } },
    _count: { _all: true },
    _sum: { total: true },
    _min: { placedAt: true },
    _max: { placedAt: true },
  });
  for (const g of groups) {
    const entry = stats.get(g.customerId) ?? {
      orderCount: 0,
      spent: [],
      firstOrderAt: null,
      lastOrderAt: null,
    };
    entry.orderCount += g._count._all;
    entry.spent.push({ currency: g.currency, total: g._sum.total, count: g._count._all });
    if (!entry.firstOrderAt || g._min.placedAt < entry.firstOrderAt)
      entry.firstOrderAt = g._min.placedAt;
    if (!entry.lastOrderAt || g._max.placedAt > entry.lastOrderAt)
      entry.lastOrderAt = g._max.placedAt;
    stats.set(g.customerId, entry);
  }
  return stats;
}

function presentStats(entry) {
  if (!entry) return { orderCount: 0, spent: [], firstOrderAt: null, lastOrderAt: null };
  return {
    orderCount: entry.orderCount,
    spent: entry.spent
      .sort((a, b) => a.currency.localeCompare(b.currency))
      .map((s) => ({
        currency: s.currency,
        total: formatMoney(s.total),
        averageOrder: formatMoney(s.total.div(s.count).toDecimalPlaces(2)),
      })),
    firstOrderAt: entry.firstOrderAt,
    lastOrderAt: entry.lastOrderAt,
  };
}

function listWhere({ search, status }) {
  const where = {};
  if (status === 'archived') where.archivedAt = { not: null };
  else if (status !== 'all') where.archivedAt = null;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
    ];
  }
  return where;
}

const ADDRESS_ORDER = [
  { defaultForCustomerId: { sort: 'asc', nulls: 'last' } },
  { createdAt: 'asc' },
];

export function createCustomerService() {
  async function loadCustomer(db, customerId) {
    const customer = await db.customer.findUnique({
      where: { id: customerId },
      include: { addresses: { orderBy: ADDRESS_ORDER } },
    });
    if (!customer) throw notFound('Customer not found');
    return customer;
  }

  return {
    async list(req, { page, pageSize, search, status, sort }) {
      const where = listWhere({ search, status });
      const [rows, total] = await Promise.all([
        req.db.customer.findMany({
          where,
          orderBy: SORTS[sort],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { addresses: { where: { defaultForCustomerId: { not: null } }, take: 1 } },
        }),
        req.db.customer.count({ where }),
      ]);
      const stats = await purchaseStats(
        req.db,
        rows.map((r) => r.id),
      );
      return {
        data: rows.map((r) => {
          const s = presentStats(stats.get(r.id));
          return { ...presentListItem(r), orderCount: s.orderCount, spent: s.spent };
        }),
        meta: { page, pageSize, total },
      };
    },

    async get(req, customerId) {
      const customer = await loadCustomer(req.db, customerId);
      const [stats, cancelledCount] = await Promise.all([
        purchaseStats(req.db, [customerId]),
        req.db.order.count({ where: { customerId, status: 'CANCELLED' } }),
      ]);
      return {
        ...presentCustomer(customer),
        stats: { ...presentStats(stats.get(customerId)), cancelledCount },
      };
    },

    async create(req, { address, ...fields }) {
      try {
        const id = await req.db.$transaction(async (tx) => {
          const customer = await tx.customer.create({ data: fields });
          if (address) {
            await tx.address.create({
              data: { ...address, customerId: customer.id, defaultForCustomerId: customer.id },
            });
          }
          return customer.id;
        });
        return presentCustomer(await loadCustomer(req.db, id));
      } catch (err) {
        if (isUniqueViolation(err)) throw emailTaken();
        throw err;
      }
    },

    async update(req, customerId, changes) {
      await loadCustomer(req.db, customerId);
      try {
        await req.db.customer.update({ where: { id: customerId }, data: changes });
      } catch (err) {
        if (isUniqueViolation(err)) throw emailTaken();
        throw err;
      }
      return presentCustomer(await loadCustomer(req.db, customerId));
    },

    async setArchived(req, customerId, archived) {
      const customer = await loadCustomer(req.db, customerId);
      if ((customer.archivedAt !== null) !== archived) {
        await req.db.customer.update({
          where: { id: customerId },
          data: { archivedAt: archived ? new Date() : null },
        });
      }
      return presentCustomer(await loadCustomer(req.db, customerId));
    },

    /** Hard delete (with addresses). Refused once orders reference the customer (step 4). */
    async remove(req, customerId) {
      await loadCustomer(req.db, customerId);
      try {
        await req.db.$transaction(async (tx) => {
          await tx.customer.delete({ where: { id: customerId } });
          // No personal data in the audit log: the id is enough to trace the action.
          await recordAudit(tx, req, {
            action: 'customer.deleted',
            entityType: 'Customer',
            entityId: customerId,
          });
        });
      } catch (err) {
        if (isForeignKeyViolation(err)) {
          throw conflict(
            'CUSTOMER_HAS_ORDERS',
            'This customer has orders and cannot be deleted. Archive it instead.',
          );
        }
        throw err;
      }
    },

    async addAddress(req, customerId, { isDefault, ...fields }) {
      const customer = await loadCustomer(req.db, customerId);
      const makeDefault = isDefault || customer.addresses.length === 0;
      const address = await req.db.$transaction(async (tx) => {
        if (makeDefault) {
          await tx.address.updateMany({
            where: { customerId },
            data: { defaultForCustomerId: null },
          });
        }
        return tx.address.create({
          data: { ...fields, customerId, defaultForCustomerId: makeDefault ? customerId : null },
        });
      });
      return presentAddress(address);
    },

    async updateAddress(req, customerId, addressId, { isDefault, ...fields }) {
      const existing = await req.db.address.findFirst({ where: { id: addressId, customerId } });
      if (!existing) throw notFound('Address not found');
      if (isDefault === false && existing.defaultForCustomerId) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid', {
          fieldErrors: { isDefault: 'Choose another address as default instead' },
        });
      }
      const address = await req.db.$transaction(async (tx) => {
        if (isDefault && !existing.defaultForCustomerId) {
          await tx.address.updateMany({
            where: { customerId },
            data: { defaultForCustomerId: null },
          });
        }
        return tx.address.update({
          where: { id: addressId },
          data: { ...fields, ...(isDefault ? { defaultForCustomerId: customerId } : {}) },
        });
      });
      return presentAddress(address);
    },

    /** Removing the default address promotes the oldest remaining one. */
    async removeAddress(req, customerId, addressId) {
      const existing = await req.db.address.findFirst({ where: { id: addressId, customerId } });
      if (!existing) throw notFound('Address not found');
      await req.db.$transaction(async (tx) => {
        await tx.address.delete({ where: { id: addressId } });
        if (existing.defaultForCustomerId) {
          const next = await tx.address.findFirst({
            where: { customerId },
            orderBy: { createdAt: 'asc' },
          });
          if (next)
            await tx.address.update({
              where: { id: next.id },
              data: { defaultForCustomerId: customerId },
            });
        }
      });
    },

    /**
     * Streams matching customers as CSV, in batches (keyset pagination on id), up to
     * MAX_EXPORT_ROWS. The export is audited with its row count, not its contents.
     */
    async exportCsv(req, res, { search, status }) {
      const where = listWhere({ search, status });
      const total = await req.db.customer.count({ where });
      if (total > MAX_EXPORT_ROWS) {
        throw conflict(
          'EXPORT_TOO_LARGE',
          `Narrow the filters: exports are limited to ${MAX_EXPORT_ROWS} customers`,
        );
      }
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="customers-${date}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      // A UTF-8 byte order mark lets Excel open accented names correctly.
      res.write('\uFEFF');
      res.write(
        csvRow([
          'Name',
          'Email',
          'Phone',
          'City',
          'Country',
          'Status',
          'Created',
          'Orders',
          'Spent',
        ]),
      );

      let cursor = null;
      let written = 0;
      for (;;) {
        const batch = await req.db.customer.findMany({
          where,
          orderBy: { id: 'asc' },
          take: EXPORT_BATCH,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          include: { addresses: { where: { defaultForCustomerId: { not: null } }, take: 1 } },
        });
        const stats = await purchaseStats(
          req.db,
          batch.map((c) => c.id),
        );
        for (const c of batch) {
          const a = c.addresses[0];
          const s = presentStats(stats.get(c.id));
          res.write(
            csvRow([
              c.name,
              c.email,
              c.phone,
              a?.city,
              a?.country,
              c.archivedAt ? 'Archived' : 'Active',
              c.createdAt,
              s.orderCount,
              s.spent.map((x) => `${x.total} ${x.currency}`).join(' + '),
            ]),
          );
        }
        written += batch.length;
        if (batch.length < EXPORT_BATCH) break;
        cursor = batch.at(-1).id;
      }
      // Audit before ending the response: an export that cannot be audited is not completed.
      await recordAudit(req.db, req, {
        action: 'customer.exported',
        entityType: 'Customer',
        metadata: { rows: written, search: search ?? null, status: status ?? 'active' },
      });
      res.end();
    },
  };
}
