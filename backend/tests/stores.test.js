import { createTestApp, resetState } from './helpers/testApp.js';
import { organizationWithAllRoles } from './helpers/factories.js';
import { product } from './helpers/sales.js';

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
});

const newStore = (name = 'Harbour store') =>
  owner.post('/stores', { name, currency: 'EUR', timezone: 'Europe/Paris' });

test('owners add stores with their own currency and time zone, and the change is audited', async () => {
  const res = await newStore();
  expect(res.status).toBe(201);
  expect(res.body.data).toMatchObject({
    name: 'Harbour store',
    slug: 'harbour-store',
    currency: 'EUR',
    timezone: 'Europe/Paris',
    status: 'ACTIVE',
  });
  // Same name again: the address gets a suffix instead of failing.
  const twin = await newStore();
  expect(twin.status).toBe(201);
  expect(twin.body.data.slug).toMatch(/^harbour-store-[0-9a-f]{6}$/);

  const list = await org.members.ANALYST.client.get('/stores');
  expect(list.body.data.map((s) => s.name)).toEqual([
    'Main store',
    'Harbour store',
    'Harbour store',
  ]);
  const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'store.created' } });
  expect(audit).toMatchObject({
    entityId: res.body.data.id,
    actorUserId: org.members.OWNER.user.id,
  });
});

test('input is validated, and the currency cannot change later', async () => {
  const bad = await owner.post('/stores', { name: ' ', currency: 'XXQ', timezone: 'Mars/Base' });
  expect(bad.status).toBe(400);
  expect(Object.keys(bad.body.error.details.fieldErrors).sort()).toEqual([
    'currency',
    'name',
    'timezone',
  ]);

  const store = (await newStore()).body.data;
  const renamed = await owner.patch(`/stores/${store.id}`, { name: 'Quay store' });
  expect(renamed.body.data).toMatchObject({ name: 'Quay store', currency: 'EUR' });
  const currency = await owner.patch(`/stores/${store.id}`, { currency: 'USD' });
  expect(currency.status).toBe(400);
  expect((await ctx.prisma.store.findUnique({ where: { id: store.id } })).currency).toBe('EUR');
});

test('the last active store cannot be archived', async () => {
  const res = await owner.post(`/stores/${org.store.id}/archive`);
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('LAST_ACTIVE_STORE');
});

test('a store with open orders, drafts included, cannot be archived', async () => {
  const store = (await newStore()).body.data;
  const shirt = (await product(owner, 'Linen shirt', 'SHIRT-1', '100')).variants[0];
  const draft = await owner.post('/orders', {
    storeId: store.id,
    items: [{ variantId: shirt.id, quantity: 1 }],
  });
  expect(draft.status).toBe(201);

  const res = await owner.post(`/stores/${store.id}/archive`);
  expect(res.status).toBe(409);
  expect(res.body.error).toMatchObject({
    code: 'STORE_HAS_OPEN_ORDERS',
    details: { openOrders: 1 },
  });

  await owner.delete(`/orders/${draft.body.data.id}`);
  expect((await owner.post(`/stores/${store.id}/archive`)).status).toBe(200);
});

test('an archived store keeps its history but takes no new stock or orders until restored', async () => {
  const store = (await newStore()).body.data;
  const shirt = (await product(owner, 'Linen shirt', 'SHIRT-1', '100')).variants[0];
  const receipt = () =>
    owner.post('/inventory/receipts', { storeId: store.id, variantId: shirt.id, quantity: 3 });
  expect((await receipt()).status).toBe(201);

  const archived = await owner.post(`/stores/${store.id}/archive`);
  expect(archived.body.data.status).toBe('ARCHIVED');
  expect((await receipt()).status).toBe(400);
  const order = await owner.post('/orders', {
    storeId: store.id,
    items: [{ variantId: shirt.id, quantity: 1 }],
  });
  expect(order.status).toBe(400);
  // History is still there.
  const movements = await owner.get(`/inventory/movements?storeId=${store.id}`);
  expect(movements.body.meta.total).toBe(1);

  const restored = await owner.post(`/stores/${store.id}/restore`);
  expect(restored.body.data.status).toBe('ACTIVE');
  expect((await receipt()).status).toBe(201);
  const actions = (
    await ctx.prisma.auditLog.findMany({
      where: { entityId: store.id },
      orderBy: { createdAt: 'asc' },
    })
  ).map((a) => a.action);
  expect(actions).toEqual(['store.created', 'store.archived', 'store.restored']);
});

test('two archives at once cannot leave the organization without an active store', async () => {
  const second = (await newStore()).body.data;
  const results = await Promise.all([
    owner.post(`/stores/${org.store.id}/archive`),
    owner.post(`/stores/${second.id}/archive`),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    await ctx.prisma.store.count({
      where: { organizationId: org.organization.id, status: 'ACTIVE' },
    }),
  ).toBe(1);
});
