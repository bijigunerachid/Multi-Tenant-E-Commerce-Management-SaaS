import { Prisma } from '@prisma/client';
import { formatMoney } from '../../utils/money.js';

// Dashboard metrics. Definitions (also in docs/architecture.md, "Business metrics"):
//
//   Revenue        Net sales (subtotal − discount; excludes tax and shipping) of orders SHIPPED
//                  in the period, by ship date. Shipped and delivered orders count; drafts,
//                  pending, confirmed, processing and cancelled orders do not.
//   Orders         Orders PLACED in the period that are not cancelled.
//   Average order  Revenue ÷ number of orders shipped in the period.
//   Open orders    Orders currently pending, confirmed or processing (not period-bound).
//
// Day boundaries use the organization's time zone. Money is reported in the organization's
// default currency; orders in any other currency are counted separately, never added in.
// Raw SQL is not scoped by tenantDb, so every query filters organization_id itself.

const SHIPPED = Prisma.sql`o.status IN ('SHIPPED', 'DELIVERED')`;
const NET = Prisma.sql`o.subtotal - o.discount_total`;
const CACHE_TTL_SECONDS = 60;
const WEEKLY_AFTER_DAYS = 92;

const DAY_MS = 86_400_000;
const toDate = (s) => new Date(`${s}T00:00:00.000Z`);
const isoDate = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => isoDate(new Date(toDate(s).getTime() + n * DAY_MS));
const daysBetween = (from, to) => Math.round((toDate(to) - toDate(from)) / DAY_MS) + 1;

/**
 * The last N days (default 30), today included, where "today" is decided by PostgreSQL.
 * All period maths runs in the database, so "today" must come from the same time zone data:
 * Node (ICU) and PostgreSQL can ship different tzdata versions, and they do disagree on some
 * zones (for example Africa/Casablanca from 2026-09-20).
 */
async function lastDays(db, timezone, days = 30) {
  const [{ today }] = await db.$queryRaw`
    SELECT to_char((now() AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS today`;
  return { from: addDays(today, -(days - 1)), to: today };
}

function percentChange(current, previous) {
  if (previous.isZero()) return current.isZero() ? 0 : null; // null: no basis for comparison
  return Number(current.sub(previous).div(previous).mul(100).toDecimalPlaces(1));
}

export function createDashboardService({ redis }) {
  /** Timestamps bounding [from, to] (whole days, inclusive) in the organization's time zone. */
  const bounds = (from, to, tz) => ({
    start: Prisma.sql`(${from}::date)::timestamp AT TIME ZONE ${tz}`,
    end: Prisma.sql`(${addDays(to, 1)}::date)::timestamp AT TIME ZONE ${tz}`,
  });

  async function salesTotals(db, org, currency, from, to, tz) {
    const { start, end } = bounds(from, to, tz);
    const [row] = await db.$queryRaw`
      SELECT COALESCE(SUM(${NET}) FILTER (WHERE o.currency = ${currency}), 0) AS revenue,
             COUNT(*) FILTER (WHERE o.currency = ${currency})::int AS "shippedOrders",
             COUNT(*) FILTER (WHERE o.currency <> ${currency})::int AS "otherCurrencyOrders"
      FROM orders o
      WHERE o.organization_id = ${org}::uuid AND ${SHIPPED}
        AND o.shipped_at >= ${start} AND o.shipped_at < ${end}`;
    const [placed] = await db.$queryRaw`
      SELECT COUNT(*)::int AS count FROM orders o
      WHERE o.organization_id = ${org}::uuid AND o.status <> 'CANCELLED' AND o.status <> 'DRAFT'
        AND o.placed_at >= ${start} AND o.placed_at < ${end}`;
    return { ...row, ordersPlaced: placed.count };
  }

  async function compute(db, org, { from, to, timezone, currency }) {
    const length = daysBetween(from, to);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(length - 1));
    const { start, end } = bounds(from, to, timezone);
    const bucket = length > WEEKLY_AFTER_DAYS ? 'week' : 'day';

    const [current, previous, open, products, stock, alerts, trend, top] = await Promise.all([
      salesTotals(db, org, currency, from, to, timezone),
      salesTotals(db, org, currency, prevFrom, prevTo, timezone),
      db.$queryRaw`
        SELECT COUNT(*)::int AS count FROM orders
        WHERE organization_id = ${org}::uuid AND status IN ('PENDING', 'CONFIRMED', 'PROCESSING')`,
      db.$queryRaw`
        SELECT COUNT(*)::int AS count FROM products
        WHERE organization_id = ${org}::uuid AND status = 'ACTIVE'`,
      // Stock is summed over active stores, per variant of an active product.
      db.$queryRaw`
        WITH available AS (
          SELECT v.id, v.low_stock_threshold AS threshold,
                 COALESCE(SUM(l.on_hand - l.reserved), 0)::int AS available
          FROM product_variants v
          JOIN products p ON p.organization_id = v.organization_id AND p.id = v.product_id
          LEFT JOIN inventory_levels l ON l.organization_id = v.organization_id AND l.variant_id = v.id
          LEFT JOIN stores s ON s.organization_id = l.organization_id AND s.id = l.store_id
          WHERE v.organization_id = ${org}::uuid AND p.status = 'ACTIVE'
            AND (l.id IS NULL OR s.status = 'ACTIVE')
          GROUP BY v.id
        )
        SELECT COUNT(*) FILTER (WHERE available > 0 AND available <= threshold)::int AS low,
               COUNT(*) FILTER (WHERE available <= 0)::int AS out
        FROM available`,
      db.$queryRaw`
        SELECT v.id AS "variantId", v.sku, v.name AS "variantName", p.id AS "productId",
               p.name AS "productName", v.low_stock_threshold AS threshold,
               COALESCE(SUM(l.on_hand - l.reserved), 0)::int AS available
        FROM product_variants v
        JOIN products p ON p.organization_id = v.organization_id AND p.id = v.product_id
        LEFT JOIN inventory_levels l ON l.organization_id = v.organization_id AND l.variant_id = v.id
        LEFT JOIN stores s ON s.organization_id = l.organization_id AND s.id = l.store_id
        WHERE v.organization_id = ${org}::uuid AND p.status = 'ACTIVE'
          AND (l.id IS NULL OR s.status = 'ACTIVE')
        GROUP BY v.id, p.id
        HAVING COALESCE(SUM(l.on_hand - l.reserved), 0) <= v.low_stock_threshold
        ORDER BY available ASC, v.sku ASC
        LIMIT 5`,
      db.$queryRaw`
        WITH buckets AS (
          SELECT generate_series(
            date_trunc(${bucket}, ${from}::date)::date,
            ${to}::date,
            CASE WHEN ${bucket} = 'week' THEN interval '1 week' ELSE interval '1 day' END
          )::date AS period
        )
        SELECT b.period::text AS period,
               COALESCE(SUM(${NET}), 0) AS revenue,
               COUNT(o.id)::int AS orders
        FROM buckets b
        LEFT JOIN orders o
          ON o.organization_id = ${org}::uuid AND ${SHIPPED} AND o.currency = ${currency}
          AND o.shipped_at >= ${start} AND o.shipped_at < ${end}
          AND date_trunc(${bucket}, o.shipped_at AT TIME ZONE ${timezone})::date = b.period
        GROUP BY b.period
        ORDER BY b.period`,
      db.$queryRaw`
        SELECT p.id AS "productId", p.name AS "productName",
               SUM(i.quantity)::int AS units, SUM(i.line_total) AS sales
        FROM order_items i
        JOIN orders o ON o.organization_id = i.organization_id AND o.id = i.order_id
        JOIN product_variants v ON v.organization_id = i.organization_id AND v.id = i.variant_id
        JOIN products p ON p.organization_id = v.organization_id AND p.id = v.product_id
        WHERE i.organization_id = ${org}::uuid AND ${SHIPPED} AND o.currency = ${currency}
          AND o.shipped_at >= ${start} AND o.shipped_at < ${end}
        GROUP BY p.id
        ORDER BY sales DESC, units DESC, p.name ASC
        LIMIT 5`,
    ]);

    const revenue = new Prisma.Decimal(current.revenue);
    const previousRevenue = new Prisma.Decimal(previous.revenue);
    const averageOrder = current.shippedOrders ? revenue.div(current.shippedOrders) : null;
    const previousAverage = previous.shippedOrders
      ? previousRevenue.div(previous.shippedOrders)
      : null;

    return {
      range: { from, to, timezone, bucket, previous: { from: prevFrom, to: prevTo } },
      currency,
      kpis: {
        revenue: {
          value: formatMoney(revenue),
          previous: formatMoney(previousRevenue),
          changePercent: percentChange(revenue, previousRevenue),
        },
        ordersPlaced: {
          value: current.ordersPlaced,
          previous: previous.ordersPlaced,
          changePercent: percentChange(
            new Prisma.Decimal(current.ordersPlaced),
            new Prisma.Decimal(previous.ordersPlaced),
          ),
        },
        averageOrderValue: {
          value: averageOrder ? formatMoney(averageOrder.toDecimalPlaces(2)) : null,
          previous: previousAverage ? formatMoney(previousAverage.toDecimalPlaces(2)) : null,
          changePercent:
            averageOrder && previousAverage ? percentChange(averageOrder, previousAverage) : null,
        },
        shippedOrders: current.shippedOrders,
        openOrders: open[0].count,
        activeProducts: products[0].count,
        lowStockVariants: stock[0].low,
        outOfStockVariants: stock[0].out,
      },
      otherCurrencyOrders: current.otherCurrencyOrders,
      revenueTrend: trend.map((t) => ({
        period: t.period,
        revenue: formatMoney(new Prisma.Decimal(t.revenue)),
        orders: t.orders,
      })),
      topProducts: top.map((t) => ({
        productId: t.productId,
        productName: t.productName,
        units: t.units,
        sales: formatMoney(t.sales),
      })),
      inventoryAlerts: alerts.map((a) => ({
        variantId: a.variantId,
        productId: a.productId,
        productName: a.productName,
        variantName: a.variantName,
        sku: a.sku,
        available: a.available,
        threshold: a.threshold,
        status: a.available <= 0 ? 'OUT' : 'LOW',
      })),
    };
  }

  return {
    /**
     * Cached for up to 60 seconds per organization, range and data version. The version is a
     * fingerprint of the latest change to orders, catalog and stock, so any change (an order
     * shipped, stock received) produces fresh figures on the next request; unchanged data is
     * served from the cache.
     */
    async dashboard(req, { from, to, days }) {
      const org = await req.db.organization.findFirstOrThrow();
      const range = from && to ? { from, to } : await lastDays(req.db, org.timezone, days);
      const [{ version }] = await req.db.$queryRaw`
        SELECT concat_ws(':',
          (SELECT extract(epoch FROM max(updated_at)) FROM orders WHERE organization_id = ${org.id}::uuid),
          (SELECT extract(epoch FROM max(updated_at)) FROM inventory_levels WHERE organization_id = ${org.id}::uuid),
          (SELECT extract(epoch FROM max(updated_at)) FROM products WHERE organization_id = ${org.id}::uuid),
          (SELECT extract(epoch FROM max(updated_at)) FROM product_variants WHERE organization_id = ${org.id}::uuid),
          (SELECT extract(epoch FROM max(updated_at)) FROM stores WHERE organization_id = ${org.id}::uuid),
          extract(epoch FROM ${org.updatedAt}::timestamptz)
        ) AS version`;
      const key = `dashboard:v2:${org.id}:${range.from}:${range.to}:${version}`;
      const cached = await redis.get(key);
      if (cached) return { ...JSON.parse(cached), cached: true };

      const result = {
        ...(await compute(req.db, org.id, {
          ...range,
          timezone: org.timezone,
          currency: org.defaultCurrency,
        })),
        generatedAt: new Date().toISOString(),
      };
      await redis.set(key, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
      return { ...result, cached: false };
    },
  };
}
