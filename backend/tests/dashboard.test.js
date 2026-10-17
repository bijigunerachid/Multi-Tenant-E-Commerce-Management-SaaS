import { createTestApp, resetState } from './helpers/testApp.js';
import { organizationWithAllRoles, createOrganization, signIn } from './helpers/factories.js';
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
  // Kolkata is UTC+5:30 all year (no daylight saving): local midnight is 18:30 UTC the day
  // before. A fixed-offset zone keeps these tests independent of tzdata rule changes.
  await ctx.prisma.organization.update({
    where: { id: org.organization.id },
    data: { timezone: 'Asia/Kolkata' },
  });
});

const SEPTEMBER = 'from=2026-09-01&to=2026-09-30';

const order = (...args) => createOrder(ctx.prisma, ...args);
const seedSeptember = (client = owner, store = org.store) => seed(ctx.prisma, client, store);

describe('dashboard metrics', () => {
  test('KPIs follow the documented definitions, in the organization time zone', async () => {
    await seedSeptember();
    const res = await owner.get(`/reports/dashboard?${SEPTEMBER}`);
    expect(res.status).toBe(200);
    const d = res.body.data;

    expect(d.range).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      timezone: 'Asia/Kolkata',
      bucket: 'day',
      previous: { from: '2026-08-02', to: '2026-08-31' },
    });
    expect(d.currency).toBe('USD');
    expect(d.kpis).toEqual({
      revenue: { value: '260.00', previous: '100.00', changePercent: 160 },
      ordersPlaced: { value: 4, previous: 2, changePercent: 100 },
      averageOrderValue: { value: '86.67', previous: '100.00', changePercent: -13.3 },
      shippedOrders: 3,
      openOrders: 1,
      activeProducts: 3,
      lowStockVariants: 1,
      outOfStockVariants: 1,
    });
    expect(d.otherCurrencyOrders).toBe(0);
  });

  test('the revenue trend has one point per day, zero-filled, with time-zone-correct days', async () => {
    await seedSeptember();
    const { revenueTrend } = (await owner.get(`/reports/dashboard?${SEPTEMBER}`)).body.data;
    expect(revenueTrend).toHaveLength(30);
    expect(revenueTrend[0]).toEqual({ period: '2026-09-01', revenue: '50.00', orders: 1 });
    const nonZero = revenueTrend.filter((p) => p.orders > 0).map((p) => [p.period, p.revenue]);
    expect(nonZero).toEqual([
      ['2026-09-01', '50.00'],
      ['2026-09-10', '200.00'],
      ['2026-09-15', '10.00'],
    ]);
    const sum = revenueTrend.reduce((s, p) => s + Number(p.revenue), 0);
    expect(sum.toFixed(2)).toBe('260.00'); // the chart adds up to the KPI
  });

  test('long ranges are grouped by week', async () => {
    const res = await owner.get('/reports/dashboard?from=2026-01-01&to=2026-06-30');
    expect(res.body.data.range.bucket).toBe('week');
    expect(res.body.data.revenueTrend[0].period).toBe('2025-12-29'); // the Monday of that week
    expect(res.body.data.revenueTrend.length).toBe(27);
  });

  test('top products rank line sales of shipped orders; inventory alerts list the weakest stock', async () => {
    await seedSeptember();
    const d = (await owner.get(`/reports/dashboard?${SEPTEMBER}`)).body.data;
    expect(d.topProducts.map((p) => [p.productName, p.units, p.sales])).toEqual([
      ['Linen shirt', 2, '200.00'],
      ['Ceramic mug', 9, '90.00'],
    ]);
    expect(d.inventoryAlerts.map((a) => [a.sku, a.available, a.status])).toEqual([
      ['BOARD-1', 0, 'OUT'],
      // 10 received − 4 shipped (O1 ×2, O2, O7) − 4 reserved for the pending O6
      ['SHIRT-1', 2, 'LOW'],
    ]);
  });

  test('orders in a currency other than the organization default are counted, not added', async () => {
    await seedSeptember();
    await ctx.prisma.organization.update({
      where: { id: org.organization.id },
      data: { defaultCurrency: 'EUR' },
    });
    const d = (await owner.get(`/reports/dashboard?${SEPTEMBER}`)).body.data;
    expect(d.currency).toBe('EUR');
    expect(d.kpis.revenue.value).toBe('0.00');
    expect(d.kpis.averageOrderValue.value).toBeNull();
    expect(d.otherCurrencyOrders).toBe(3);
  });

  test('another organization’s sales never appear', async () => {
    const other = await createOrganization(ctx.prisma);
    await ctx.prisma.organization.update({
      where: { id: other.organization.id },
      data: { timezone: 'Asia/Kolkata' },
    });
    const otherClient = await signIn(ctx.app, other.owner);
    await seedSeptember(otherClient, other.store);

    const d = (await owner.get(`/reports/dashboard?${SEPTEMBER}`)).body.data;
    expect(d.kpis).toMatchObject({
      revenue: { value: '0.00' },
      ordersPlaced: { value: 0 },
      openOrders: 0,
      activeProducts: 0,
    });
    expect(d.topProducts).toEqual([]);
    expect(d.inventoryAlerts).toEqual([]);
  });
});

describe('caching, ranges and access', () => {
  test('unchanged data is served from the cache for up to a minute', async () => {
    const first = await owner.get(`/reports/dashboard?${SEPTEMBER}`);
    const second = await owner.get(`/reports/dashboard?${SEPTEMBER}`);
    expect(first.body.data.cached).toBe(false);
    expect(second.body.data.cached).toBe(true);
    expect(second.body.data.generatedAt).toBe(first.body.data.generatedAt);
    const [key] = await ctx.redis.keys(
      `dashboard:v2:${org.organization.id}:2026-09-01:2026-09-30:*`,
    );
    const ttl = await ctx.redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  test('any change to orders or stock gives fresh figures immediately, not after the cache expires', async () => {
    const empty = (await owner.get('/reports/dashboard')).body.data;
    expect(empty.kpis.activeProducts).toBe(0);

    const mug = await product(owner, 'Ceramic mug', 'MUG-1', '10.00');
    const afterProduct = (await owner.get('/reports/dashboard')).body.data;
    expect(afterProduct.cached).toBe(false);
    expect(afterProduct.kpis.activeProducts).toBe(1);

    await owner.post('/inventory/receipts', {
      storeId: org.store.id,
      variantId: mug.variants[0].id,
      quantity: 3,
    });
    await order(owner, [{ variantId: mug.variants[0].id, quantity: 2 }], SHIP);
    const afterShipping = (await owner.get('/reports/dashboard')).body.data;
    expect(afterShipping.cached).toBe(false);
    expect(afterShipping.kpis.revenue.value).toBe('20.00');
  });

  test('defaults to the last 30 days, ending today in the organization time zone', async () => {
    const d = (await owner.get('/reports/dashboard')).body.data;
    const [{ today }] = await ctx.prisma.$queryRaw`
      SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS today`;
    expect(d.range.to).toBe(today);
    expect(d.revenueTrend).toHaveLength(30);
    expect(d.revenueTrend.at(-1).period).toBe(today);

    const week = (await owner.get('/reports/dashboard?days=7')).body.data;
    expect(week.range.to).toBe(today);
    expect(week.revenueTrend).toHaveLength(7);
  });

  test('validates the range', async () => {
    const bad = async (q) => (await owner.get(`/reports/dashboard?${q}`)).status;
    expect(await bad('from=2026-09-01')).toBe(400);
    expect(await bad('from=2026-09-30&to=2026-09-01')).toBe(400);
    expect(await bad('from=2025-01-01&to=2026-06-30')).toBe(400);
    expect(await bad('from=2026-02-30&to=2026-03-01')).toBe(400);
    expect(await bad('days=7&from=2026-09-01&to=2026-09-07')).toBe(400);
    expect(await bad('days=0')).toBe(400);
  });

  test('analysts and managers see the dashboard; order and inventory managers do not', async () => {
    for (const role of ['OWNER', 'MANAGER', 'ANALYST']) {
      expect((await org.members[role].client.get('/reports/dashboard')).status).toBe(200);
    }
    for (const role of ['ORDER_MANAGER', 'INVENTORY_MANAGER']) {
      expect((await org.members[role].client.get('/reports/dashboard')).status).toBe(403);
    }
  });
});

test('the database refuses a ship date on an order that has not shipped', async () => {
  const mug = await product(owner, 'Ceramic mug', 'MUG-1', '10.00');
  await owner.post('/inventory/receipts', {
    storeId: org.store.id,
    variantId: mug.variants[0].id,
    quantity: 2,
  });
  const pending = await order(owner, [{ variantId: mug.variants[0].id, quantity: 1 }], ['place']);
  await expect(
    ctx.prisma.$executeRaw`UPDATE orders SET shipped_at = now() WHERE id = ${pending}::uuid`,
  ).rejects.toThrow(/orders_shipped_at_check/);
});
