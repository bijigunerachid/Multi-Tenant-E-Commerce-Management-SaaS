import { Prisma } from '@prisma/client';

// Shared by the dashboard and the reports, so both use the same definitions:
//   - a sale is an order SHIPPED or DELIVERED, dated by its ship date;
//   - net sales are subtotal − discount (no tax, no shipping);
//   - days are whole days in the organization's time zone, computed by PostgreSQL.
// Raw SQL is not scoped by tenantDb, so every query filters organization_id itself.

export const SHIPPED = Prisma.sql`o.status IN ('SHIPPED', 'DELIVERED')`;
export const NET = Prisma.sql`o.subtotal - o.discount_total`;

const DAY_MS = 86_400_000;
const toDate = (s) => new Date(`${s}T00:00:00.000Z`);
const isoDate = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => isoDate(new Date(toDate(s).getTime() + n * DAY_MS));
export const daysBetween = (from, to) => Math.round((toDate(to) - toDate(from)) / DAY_MS) + 1;

/**
 * The last N days (default 30), today included, where "today" is decided by PostgreSQL.
 * All period maths runs in the database, so "today" must come from the same time zone data:
 * Node (ICU) and PostgreSQL can ship different tzdata versions, and they do disagree on some
 * zones (for example Africa/Casablanca from 2026-09-20).
 */
export async function lastDays(db, timezone, days = 30) {
  const [{ today }] = await db.$queryRaw`
    SELECT to_char((now() AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS today`;
  return { from: addDays(today, -(days - 1)), to: today };
}

/** The requested range, or the last N days when no explicit range is given. */
export function resolveRange(db, timezone, { from, to, days }) {
  return from && to ? { from, to } : lastDays(db, timezone, days);
}

/** Timestamps bounding [from, to] (whole days, inclusive) in the organization's time zone. */
export function bounds(from, to, tz) {
  return {
    start: Prisma.sql`(${from}::date)::timestamp AT TIME ZONE ${tz}`,
    end: Prisma.sql`(${addDays(to, 1)}::date)::timestamp AT TIME ZONE ${tz}`,
  };
}

/** Orders shipped in the range, optionally in one store (alias `o`). */
export function shippedIn({ org, from, to, timezone, storeId }) {
  const { start, end } = bounds(from, to, timezone);
  return Prisma.sql`o.organization_id = ${org}::uuid AND ${SHIPPED}
    AND o.shipped_at >= ${start} AND o.shipped_at < ${end}
    ${storeId ? Prisma.sql`AND o.store_id = ${storeId}::uuid` : Prisma.empty}`;
}
