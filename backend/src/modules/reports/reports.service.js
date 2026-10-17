import { Prisma } from '@prisma/client';
import { recordAudit } from '../../utils/audit.js';
import { csvRow } from '../../utils/csv.js';
import { conflict, notFound } from '../../utils/errors.js';
import { formatMoney } from '../../utils/money.js';
import { NET, resolveRange, shippedIn } from './period.js';

// Reports over a date range. They use the same definitions as the dashboard (see period.js and
// docs/architecture.md, "Reports"): a sale is a shipped or delivered order dated by its ship
// date, figures are in the organization's default currency, and orders in other currencies
// are counted, never added in. Reports are computed on every request (no cache), so an export
// always matches the data at the time it was made.
//
//   Sales     One row per day, week or month: orders shipped, units, gross sales (subtotal),
//             discounts, net sales, tax, shipping and total.
//   Products  One row per variant sold: units, orders and sales. Sales are line totals, before
//             order-level discounts, so they add up to the gross sales of the sales report.
//   Stores    One row per store: orders shipped, net sales and average order value.
//
// Customer-level reports are left out on purpose: analysts may read reports but not customers.

const { Decimal } = Prisma;
const ZERO = new Decimal(0);
export const MAX_EXPORT_ROWS = 100_000;
const money = (value) => formatMoney(new Decimal(value ?? 0));
const sum = (rows, key) => rows.reduce((total, row) => total.add(row[key] ?? 0), ZERO);

export const REPORTS = ['sales', 'products', 'stores'];

export function createReportService() {
  /** Organization, resolved range and (optional) store; an unknown store is a 404. */
  async function context(req, { from, to, days, storeId }) {
    const org = await req.db.organization.findFirstOrThrow();
    const store = storeId
      ? await req.db.store.findFirst({ where: { id: storeId }, select: { id: true, name: true } })
      : null;
    if (storeId && !store) throw notFound('Store not found');
    const range = await resolveRange(req.db, org.timezone, { from, to, days });
    return {
      org: org.id,
      currency: org.defaultCurrency,
      timezone: org.timezone,
      ...range,
      storeId: store?.id ?? null,
      store,
    };
  }

  const describe = (ctx, extra = {}) => ({
    range: { from: ctx.from, to: ctx.to, timezone: ctx.timezone, ...extra },
    currency: ctx.currency,
    store: ctx.store,
  });

  async function otherCurrencyOrders(db, ctx) {
    const [row] = await db.$queryRaw`
      SELECT COUNT(*)::int AS count FROM orders o
      WHERE ${shippedIn(ctx)} AND o.currency <> ${ctx.currency}`;
    return row.count;
  }

  async function sales(db, ctx, groupBy) {
    const rows = await db.$queryRaw`
      WITH shipped AS (
        SELECT o.id, o.subtotal, o.discount_total, o.tax_total, o.shipping_total, o.total,
               date_trunc(${groupBy}, o.shipped_at AT TIME ZONE ${ctx.timezone})::date AS period,
               (SELECT COALESCE(SUM(i.quantity), 0) FROM order_items i
                 WHERE i.organization_id = o.organization_id AND i.order_id = o.id) AS units
        FROM orders o
        WHERE ${shippedIn(ctx)} AND o.currency = ${ctx.currency}
      ),
      buckets AS (
        SELECT generate_series(
          date_trunc(${groupBy}, ${ctx.from}::date)::date,
          ${ctx.to}::date,
          ('1 ' || ${groupBy})::interval
        )::date AS period
      )
      SELECT GREATEST(b.period, ${ctx.from}::date)::text AS "periodStart",
             LEAST((b.period + ('1 ' || ${groupBy})::interval)::date - 1, ${ctx.to}::date)::text
               AS "periodEnd",
             COUNT(s.id)::int AS orders,
             COALESCE(SUM(s.units), 0)::int AS units,
             COALESCE(SUM(s.subtotal), 0) AS "grossSales",
             COALESCE(SUM(s.discount_total), 0) AS discounts,
             COALESCE(SUM(s.subtotal - s.discount_total), 0) AS "netSales",
             COALESCE(SUM(s.tax_total), 0) AS tax,
             COALESCE(SUM(s.shipping_total), 0) AS shipping,
             COALESCE(SUM(s.total), 0) AS total
      FROM buckets b
      LEFT JOIN shipped s ON s.period = b.period
      GROUP BY b.period
      ORDER BY b.period`;
    const MONEY = ['grossSales', 'discounts', 'netSales', 'tax', 'shipping', 'total'];
    const present = (row) => ({
      ...row,
      ...Object.fromEntries(MONEY.map((key) => [key, money(row[key])])),
    });
    const totals = {
      orders: rows.reduce((n, r) => n + r.orders, 0),
      units: rows.reduce((n, r) => n + r.units, 0),
      ...Object.fromEntries(MONEY.map((key) => [key, formatMoney(sum(rows, key))])),
    };
    return { rows: rows.map(present), totals };
  }

  async function products(db, ctx, { limit, offset }) {
    const rows = await db.$queryRaw`
      SELECT v.id AS "variantId", v.sku, v.name AS "variantName",
             p.id AS "productId", p.name AS "productName",
             SUM(i.quantity)::int AS units,
             COUNT(DISTINCT o.id)::int AS orders,
             SUM(i.line_total) AS sales
      FROM order_items i
      JOIN orders o ON o.organization_id = i.organization_id AND o.id = i.order_id
      JOIN product_variants v ON v.organization_id = i.organization_id AND v.id = i.variant_id
      JOIN products p ON p.organization_id = v.organization_id AND p.id = v.product_id
      WHERE i.organization_id = ${ctx.org}::uuid AND ${shippedIn(ctx)}
        AND o.currency = ${ctx.currency}
      GROUP BY v.id, p.id
      ORDER BY sales DESC, units DESC, v.sku ASC
      LIMIT ${limit} OFFSET ${offset}`;
    const [totals] = await db.$queryRaw`
      SELECT COUNT(DISTINCT i.variant_id)::int AS variants,
             COALESCE(SUM(i.quantity), 0)::int AS units,
             COALESCE(SUM(i.line_total), 0) AS sales
      FROM order_items i
      JOIN orders o ON o.organization_id = i.organization_id AND o.id = i.order_id
      WHERE i.organization_id = ${ctx.org}::uuid AND ${shippedIn(ctx)}
        AND o.currency = ${ctx.currency}`;
    const allSales = new Decimal(totals.sales);
    return {
      rows: rows.map((r) => ({
        ...r,
        sales: money(r.sales),
        // Share of all product sales in the range, in percent with one decimal.
        sharePercent: allSales.isZero()
          ? 0
          : Number(new Decimal(r.sales).div(allSales).mul(100).toDecimalPlaces(1)),
      })),
      totals: { variants: totals.variants, units: totals.units, sales: formatMoney(allSales) },
    };
  }

  async function stores(db, ctx) {
    const rows = await db.$queryRaw`
      SELECT s.id AS "storeId", s.name, s.status,
             COUNT(o.id) FILTER (WHERE o.currency = ${ctx.currency})::int AS orders,
             COALESCE(SUM(${NET}) FILTER (WHERE o.currency = ${ctx.currency}), 0) AS "netSales",
             COUNT(o.id) FILTER (WHERE o.currency <> ${ctx.currency})::int
               AS "otherCurrencyOrders"
      FROM stores s
      LEFT JOIN orders o ON o.store_id = s.id AND ${shippedIn({ ...ctx, storeId: null })}
      WHERE s.organization_id = ${ctx.org}::uuid
      GROUP BY s.id
      ORDER BY "netSales" DESC, s.name ASC`;
    const netSales = sum(rows, 'netSales');
    const orders = rows.reduce((n, r) => n + r.orders, 0);
    const average = (net, count) => (count ? formatMoney(new Decimal(net).div(count)) : null);
    return {
      rows: rows.map((r) => ({
        ...r,
        netSales: money(r.netSales),
        averageOrderValue: average(r.netSales, r.orders),
      })),
      totals: {
        orders,
        netSales: formatMoney(netSales),
        averageOrderValue: average(netSales, orders),
      },
    };
  }

  // CSV layouts: header row, then one line per row, then (where it makes sense) a total line.
  const CSV = {
    sales: {
      header: [
        'Period start',
        'Period end',
        'Orders shipped',
        'Units',
        'Gross sales',
        'Discounts',
        'Net sales',
        'Tax',
        'Shipping',
        'Total',
        'Currency',
      ],
      line: (r, c) => [
        r.periodStart,
        r.periodEnd,
        r.orders,
        r.units,
        r.grossSales,
        r.discounts,
        r.netSales,
        r.tax,
        r.shipping,
        r.total,
        c,
      ],
      total: (t, c) => [
        'Total',
        '',
        t.orders,
        t.units,
        t.grossSales,
        t.discounts,
        t.netSales,
        t.tax,
        t.shipping,
        t.total,
        c,
      ],
    },
    products: {
      header: ['Product', 'Variant', 'SKU', 'Units', 'Orders', 'Sales', 'Share %', 'Currency'],
      line: (r, c) => [
        r.productName,
        r.variantName,
        r.sku,
        r.units,
        r.orders,
        r.sales,
        r.sharePercent,
        c,
      ],
      total: (t, c) => ['Total', '', '', t.units, '', t.sales, t.sales === '0.00' ? 0 : 100, c],
    },
    stores: {
      header: [
        'Store',
        'Status',
        'Orders shipped',
        'Net sales',
        'Average order value',
        'Orders in other currencies',
        'Currency',
      ],
      line: (r, c) => [
        r.name,
        r.status === 'ACTIVE' ? 'Active' : 'Archived',
        r.orders,
        r.netSales,
        r.averageOrderValue,
        r.otherCurrencyOrders,
        c,
      ],
      total: (t, c) => ['Total', '', t.orders, t.netSales, t.averageOrderValue, '', c],
    },
  };

  async function build(req, report, query, { forExport = false } = {}) {
    const ctx = await context(req, query);
    const other = await otherCurrencyOrders(req.db, ctx);
    if (report === 'sales') {
      const groupBy = query.groupBy ?? 'day';
      return {
        ...describe(ctx, { groupBy }),
        otherCurrencyOrders: other,
        ...(await sales(req.db, ctx, groupBy)),
      };
    }
    if (report === 'products') {
      const pageSize = forExport ? MAX_EXPORT_ROWS + 1 : query.pageSize;
      const page = forExport ? 1 : query.page;
      const result = await products(req.db, ctx, {
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      return {
        ...describe(ctx),
        otherCurrencyOrders: other,
        ...result,
        meta: { page, pageSize, total: result.totals.variants },
      };
    }
    return { ...describe(ctx), otherCurrencyOrders: other, ...(await stores(req.db, ctx)) };
  }

  return {
    get: (req, report, query) => build(req, report, query),

    /**
     * The same report as CSV. Rows are bounded (a year of days, the stores, the variants
     * sold), but the product export is still capped at MAX_EXPORT_ROWS. The export is audited
     * with its parameters and row count, before the response ends.
     */
    async exportCsv(req, res, report, query) {
      const result = await build(req, report, query, { forExport: true });
      if (result.rows.length > MAX_EXPORT_ROWS) {
        throw conflict(
          'EXPORT_TOO_LARGE',
          `Narrow the range: exports are limited to ${MAX_EXPORT_ROWS} rows`,
        );
      }
      const layout = CSV[report];
      const name = `${report}-${result.range.from}-to-${result.range.to}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.setHeader('Cache-Control', 'no-store');
      // A UTF-8 byte order mark lets Excel open accented names correctly.
      let body = '\uFEFF' + csvRow(layout.header);
      for (const row of result.rows) body += csvRow(layout.line(row, result.currency));
      body += csvRow(layout.total(result.totals, result.currency));

      await recordAudit(req.db, req, {
        action: 'report.exported',
        entityType: 'Report',
        metadata: {
          report,
          from: result.range.from,
          to: result.range.to,
          storeId: result.store?.id ?? null,
          rows: result.rows.length,
        },
      });
      res.end(body);
    },
  };
}
