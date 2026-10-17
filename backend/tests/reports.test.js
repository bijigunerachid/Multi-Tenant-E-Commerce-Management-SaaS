import { createTestApp, resetState } from './helpers/testApp.js';
import { createOrganization, organizationWithAllRoles, signIn } from './helpers/factories.js';
import { SHIP, order as createOrder, product, seedSeptember as seed } from './helpers/sales.js';

let ctx;
let org;
let owner;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await resetState(ctx);
  org = await organizationWithAllRoles(ctx.app, ctx.prisma);
  owner = org.members.OWNER.client;
  // A fixed-offset zone (UTC+5:30, no daylight saving), as in the dashboard tests.
  await ctx.prisma.organization.update({
    where: { id: org.organization.id },
    data: { timezone: 'Asia/Kolkata' },
  });
});

const SEPTEMBER = 'from=2026-09-01&to=2026-09-30';
const order = (...args) => createOrder(ctx.prisma, ...args);
const seedSeptember = (client = owner, store = org.store) => seed(ctx.prisma, client, store);

// Hand-calculated from the September scenario in helpers/sales.js. Shipped in September
// (Kolkata time):
//   O3  Sep 1 00:15  5 mugs                         gross  50, net  50, tax 10, ship 50, total 110
//   O1  Sep 10       2 shirts + 3 mugs, −30 discount gross 230, net 200, tax 40, ship 50, total 290
//   O4  Sep 15       1 mug (delivered)              gross  10, net  10, tax  2, ship 50, total  62
// Not counted: O2 (ships Oct 1 local time), O7 (August), cancelled, pending and draft orders.
const SEPTEMBER_TOTALS = {
  orders: 3,
  units: 11,
  grossSales: '290.00',
  discounts: '30.00',
  netSales: '260.00',
  tax: '52.00',
  shipping: '150.00',
  total: '462.00',
};

/** A second store in the organization, with stock, and one shipped order in it. */
async function secondStoreSale() {
  const store = await ctx.prisma.store.create({
    data: {
      organizationId: org.organization.id,
      name: 'Rabat outlet',
      slug: 'rabat-outlet',
      currency: 'USD',
      timezone: 'Asia/Kolkata',
    },
  });
  const tray = await product(owner, 'Cedar tray', 'TRAY-1', '45.00');
  const variantId = tray.variants[0].id;
  await owner.post('/inventory/receipts', { storeId: store.id, variantId, quantity: 5 });
  const created = await owner.post('/orders', {
    storeId: store.id,
    items: [{ variantId, quantity: 2 }],
  });
  for (const action of SHIP) {
    await owner.post(`/orders/${created.body.data.id}/transitions`, { action });
  }
  await ctx.prisma.$executeRaw`
    UPDATE orders SET shipped_at = '2026-09-20T10:00:00Z' WHERE id = ${created.body.data.id}::uuid`;
  return store;
}

describe('sales report', () => {
  test('daily rows cover every day of the range and add up to the totals', async () => {
    await seedSeptember();
    const res = await owner.get(`/reports/sales?${SEPTEMBER}`);
    expect(res.status).toBe(200);
    const r = res.body.data;

    expect(r.range).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      timezone: 'Asia/Kolkata',
      groupBy: 'day',
    });
    expect(r.currency).toBe('USD');
    expect(r.store).toBeNull();
    expect(r.otherCurrencyOrders).toBe(0);
    expect(r.rows).toHaveLength(30);
    expect(r.rows[0]).toEqual({
      periodStart: '2026-09-01',
      periodEnd: '2026-09-01',
      orders: 1,
      units: 5,
      grossSales: '50.00',
      discounts: '0.00',
      netSales: '50.00',
      tax: '10.00',
      shipping: '50.00',
      total: '110.00',
    });
    expect(r.rows[9]).toMatchObject({
      periodStart: '2026-09-10',
      orders: 1,
      units: 5,
      grossSales: '230.00',
      discounts: '30.00',
      netSales: '200.00',
      total: '290.00',
    });
    expect(r.rows[29]).toMatchObject({ periodStart: '2026-09-30', orders: 0, netSales: '0.00' });
    expect(r.totals).toEqual(SEPTEMBER_TOTALS);
  });

  test('weeks start on Monday and are clipped to the range; a month is one row', async () => {
    await seedSeptember();
    const weeks = (await owner.get(`/reports/sales?${SEPTEMBER}&groupBy=week`)).body.data;
    expect(weeks.rows.map((w) => [w.periodStart, w.periodEnd, w.netSales])).toEqual([
      ['2026-09-01', '2026-09-06', '50.00'], // the week of Monday Aug 31, from Sep 1
      ['2026-09-07', '2026-09-13', '200.00'],
      ['2026-09-14', '2026-09-20', '10.00'],
      ['2026-09-21', '2026-09-27', '0.00'],
      ['2026-09-28', '2026-09-30', '0.00'], // ends with the range, not on Sunday Oct 4
    ]);
    expect(weeks.totals).toEqual(SEPTEMBER_TOTALS);

    const month = (await owner.get(`/reports/sales?${SEPTEMBER}&groupBy=month`)).body.data;
    expect(month.rows).toEqual([
      { periodStart: '2026-09-01', periodEnd: '2026-09-30', ...SEPTEMBER_TOTALS },
    ]);
  });

  test('agrees with the dashboard revenue for the same range', async () => {
    await seedSeptember();
    const sales = (await owner.get(`/reports/sales?${SEPTEMBER}`)).body.data;
    const dashboard = (await owner.get(`/reports/dashboard?${SEPTEMBER}`)).body.data;
    expect(sales.totals.netSales).toBe(dashboard.kpis.revenue.value);
    expect(sales.totals.orders).toBe(dashboard.kpis.shippedOrders);
  });

  test('orders in another currency are counted, not added', async () => {
    await seedSeptember();
    await ctx.prisma.organization.update({
      where: { id: org.organization.id },
      data: { defaultCurrency: 'EUR' },
    });
    const r = (await owner.get(`/reports/sales?${SEPTEMBER}&groupBy=month`)).body.data;
    expect(r.currency).toBe('EUR');
    expect(r.otherCurrencyOrders).toBe(3);
    expect(r.totals).toMatchObject({ orders: 0, netSales: '0.00', total: '0.00' });
  });
});

describe('products report', () => {
  test('one row per variant sold, adding up to the gross sales', async () => {
    await seedSeptember();
    const r = (await owner.get(`/reports/products?${SEPTEMBER}`)).body.data;
    expect(
      r.rows.map(({ productName, sku, units, orders, sales, sharePercent }) => ({
        productName,
        sku,
        units,
        orders,
        sales,
        sharePercent,
      })),
    ).toEqual([
      {
        productName: 'Linen shirt',
        sku: 'SHIRT-1',
        units: 2,
        orders: 1,
        sales: '200.00',
        sharePercent: 69,
      },
      {
        productName: 'Ceramic mug',
        sku: 'MUG-1',
        units: 9,
        orders: 3,
        sales: '90.00',
        sharePercent: 31,
      },
    ]);
    // Line totals are before order discounts, so they match gross (not net) sales.
    expect(r.totals).toEqual({ variants: 2, units: 11, sales: SEPTEMBER_TOTALS.grossSales });
    expect(r.meta).toEqual({ page: 1, pageSize: 50, total: 2 });
  });

  test('pages through the variants, keeping the totals for the whole range', async () => {
    await seedSeptember();
    const r = (await owner.get(`/reports/products?${SEPTEMBER}&page=2&pageSize=1`)).body.data;
    expect(r.rows.map((row) => row.sku)).toEqual(['MUG-1']);
    expect(r.meta).toEqual({ page: 2, pageSize: 1, total: 2 });
    expect(r.totals.sales).toBe('290.00');
  });
});

describe('stores report and store filter', () => {
  test('compares stores and filters the other reports to one store', async () => {
    await seedSeptember();
    const rabat = await secondStoreSale(); // 2 trays × 45 = 90, shipped Sep 20

    const stores = (await owner.get(`/reports/stores?${SEPTEMBER}`)).body.data;
    expect(
      stores.rows.map(({ name, orders, netSales, averageOrderValue }) => [
        name,
        orders,
        netSales,
        averageOrderValue,
      ]),
    ).toEqual([
      ['Main store', 3, '260.00', '86.67'],
      ['Rabat outlet', 1, '90.00', '90.00'],
    ]);
    expect(stores.totals).toEqual({ orders: 4, netSales: '350.00', averageOrderValue: '87.50' });

    const onlyRabat = (
      await owner.get(`/reports/sales?${SEPTEMBER}&groupBy=month&storeId=${rabat.id}`)
    ).body.data;
    expect(onlyRabat.store).toEqual({ id: rabat.id, name: 'Rabat outlet' });
    expect(onlyRabat.totals).toMatchObject({ orders: 1, units: 2, netSales: '90.00' });

    const products = (await owner.get(`/reports/products?${SEPTEMBER}&storeId=${rabat.id}`)).body
      .data;
    expect(products.rows.map((p) => p.sku)).toEqual(['TRAY-1']);
  });

  test("another organization's store is not found, and its sales never appear", async () => {
    await seedSeptember();
    const other = await createOrganization(ctx.prisma);
    const otherOwner = await signIn(ctx.app, other.owner);
    await ctx.prisma.organization.update({
      where: { id: other.organization.id },
      data: { timezone: 'Asia/Kolkata' },
    });
    await seed(ctx.prisma, otherOwner, other.store);

    const res = await owner.get(`/reports/sales?${SEPTEMBER}&storeId=${other.store.id}`);
    expect(res.status).toBe(404);
    const stores = (await owner.get(`/reports/stores?${SEPTEMBER}`)).body.data;
    expect(stores.rows.map((s) => s.storeId)).toEqual([org.store.id]);
    expect(stores.totals.netSales).toBe('260.00');
  });
});

describe('CSV exports', () => {
  const lines = (res) =>
    res.text
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\r\n');

  test('the sales export has the same rows and totals, and is audited', async () => {
    await seedSeptember();
    const res = await owner.get(`/reports/sales/export?${SEPTEMBER}&groupBy=month`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="sales-2026-09-01-to-2026-09-30.csv"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text.startsWith('\uFEFF')).toBe(true);
    expect(lines(res)).toEqual([
      'Period start,Period end,Orders shipped,Units,Gross sales,Discounts,Net sales,Tax,Shipping,Total,Currency',
      '2026-09-01,2026-09-30,3,11,290.00,30.00,260.00,52.00,150.00,462.00,USD',
      'Total,,3,11,290.00,30.00,260.00,52.00,150.00,462.00,USD',
    ]);

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'report.exported' } });
    expect(audit).toMatchObject({
      organizationId: org.organization.id,
      metadata: { report: 'sales', from: '2026-09-01', to: '2026-09-30', storeId: null, rows: 1 },
    });
  });

  test('the products export lists every variant and neutralizes spreadsheet formulas', async () => {
    await seedSeptember();
    const evil = await product(owner, '=HYPERLINK("http://x.example","click")', 'EVIL-1', '1.00');
    await owner.post('/inventory/receipts', {
      storeId: org.store.id,
      variantId: evil.variants[0].id,
      quantity: 1,
    });
    await order(owner, [{ variantId: evil.variants[0].id, quantity: 1 }], SHIP, {
      shippedAt: '2026-09-25T10:00:00Z',
    });

    const res = await owner.get(`/reports/products/export?${SEPTEMBER}&pageSize=1`);
    expect(lines(res)).toEqual([
      'Product,Variant,SKU,Units,Orders,Sales,Share %,Currency',
      'Linen shirt,Default,SHIRT-1,2,1,200.00,68.7,USD',
      'Ceramic mug,Default,MUG-1,9,3,90.00,30.9,USD',
      `"'=HYPERLINK(""http://x.example"",""click"")",Default,EVIL-1,1,1,1.00,0.3,USD`,
      'Total,,,12,,291.00,100,USD',
    ]);
  });

  test('the stores export compares the stores', async () => {
    await seedSeptember();
    const res = await owner.get(`/reports/stores/export?${SEPTEMBER}`);
    expect(lines(res)).toEqual([
      'Store,Status,Orders shipped,Net sales,Average order value,Orders in other currencies,Currency',
      'Main store,Active,3,260.00,86.67,0,USD',
      'Total,,3,260.00,86.67,,USD',
    ]);
  });
});

describe('validation and access', () => {
  test('bad input is refused with field details', async () => {
    const cases = [
      `/reports/sales?${SEPTEMBER}&groupBy=year`,
      '/reports/sales?from=2026-09-30&to=2026-09-01',
      `/reports/sales?${SEPTEMBER}&storeId=not-a-uuid`,
      `/reports/products?${SEPTEMBER}&pageSize=500`,
      '/reports/stores?days=0',
    ];
    for (const path of cases) {
      const res = await owner.get(path);
      expect({ path, status: res.status }).toEqual({ path, status: 400 });
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  test('analysts can read and export; order and inventory managers cannot', async () => {
    await seedSeptember();
    const analyst = org.members.ANALYST.client;
    expect((await analyst.get(`/reports/stores?${SEPTEMBER}`)).status).toBe(200);
    expect((await analyst.get(`/reports/sales/export?${SEPTEMBER}`)).status).toBe(200);
    for (const role of ['ORDER_MANAGER', 'INVENTORY_MANAGER']) {
      const client = org.members[role].client;
      expect((await client.get(`/reports/sales?${SEPTEMBER}`)).status).toBe(403);
      expect((await client.get(`/reports/products/export?${SEPTEMBER}`)).status).toBe(403);
    }
  });
});
