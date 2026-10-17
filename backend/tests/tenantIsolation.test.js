import { createTestApp, resetState } from './helpers/testApp.js';
import {
  lastEmailTo,
  organizationWithAllRoles,
  productInput,
  uploadImage,
} from './helpers/factories.js';

/**
 * Cross-tenant access attempts. Org A's owner (who holds every tenant permission) uses
 * identifiers that belong to org B: guessed in URLs, swapped into bodies, and via nested
 * routes. Every attempt must behave as if the record does not exist, and org B's data must
 * be unchanged afterwards.
 */

let ctx;
let A;
let B;
let foreign; // identifiers that belong to org B, by route parameter name

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

beforeEach(async () => {
  await resetState(ctx);
  A = await organizationWithAllRoles(ctx.app, ctx.prisma);
  B = await organizationWithAllRoles(ctx.app, ctx.prisma);

  const invite = await B.members.OWNER.client.post('/members/invitations', {
    email: 'b-invitee@example.com',
    role: 'ANALYST',
  });
  const bOwner = B.members.OWNER.client;
  const category = await bOwner.post('/categories', { name: 'B shirts' });
  const product = await bOwner.post(
    '/products',
    productInput({ categoryId: category.body.data.id }),
  );
  const image = await uploadImage(bOwner, product.body.data.id);
  expect(image.status).toBe(201);

  foreign = {
    membershipId: B.members.ANALYST.membership.id,
    invitationId: invite.body.data.id,
    organizationId: B.organization.id,
    categoryId: category.body.data.id,
    productId: product.body.data.id,
    imageId: image.body.data.id,
    variantId: product.body.data.variants[0].id,
  };
  const customer = await bOwner.post('/customers', {
    name: 'B customer',
    email: 'b-customer@example.com',
    address: { line1: '1 Rue B', city: 'Rabat', country: 'MA' },
  });
  expect(customer.status).toBe(201);
  foreign.customerId = customer.body.data.id;
  const receipt = await bOwner.post('/inventory/receipts', {
    storeId: B.store.id,
    variantId: foreign.variantId,
    quantity: 7,
  });
  expect(receipt.status).toBe(201);
  const order = await bOwner.post('/orders', {
    customerId: foreign.customerId,
    items: [{ variantId: foreign.variantId, quantity: 2 }],
  });
  expect(order.status).toBe(201);
  const placed = await bOwner.post(`/orders/${order.body.data.id}/transitions`, {
    action: 'place',
  });
  expect(placed.status).toBe(200);
  foreign.orderId = order.body.data.id;
  foreign.addressId = customer.body.data.addresses[0].id;
});

// Valid bodies, so a request is refused because of the foreign id and not because of the input.
const BODIES = {
  'PATCH /members/:membershipId': { role: 'MANAGER' },
  'PATCH /categories/:categoryId': { name: 'Hijacked' },
  'PUT /products/:productId': productInput(),
  'PATCH /products/:productId/status': { status: 'ARCHIVED' },
  'PATCH /products/:productId/images/:imageId': { altText: 'Hijacked' },
  'PATCH /customers/:customerId': { name: 'Hijacked' },
  'PATCH /customers/:customerId/status': { archived: true },
  'POST /customers/:customerId/addresses': { line1: 'x', city: 'x', country: 'MA' },
  'PATCH /customers/:customerId/addresses/:addressId': { city: 'Hijacked' },
  'PUT /orders/:orderId': {
    items: [{ variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
  },
  'POST /orders/:orderId/transitions': { action: 'confirm' },
  'POST /orders/:orderId/cancel': { reason: 'Hijacked' },
};

const fill = (path, ids) => path.replace(/:(\w+)/g, (_, name) => ids[name]);
const paramNames = (path) => [...path.matchAll(/:(\w+)/g)].map((m) => m[1]);

async function snapshotB() {
  const where = { organizationId: B.organization.id };
  const byId = { orderBy: { id: 'asc' } };
  const snapshot = {
    org: await ctx.prisma.organization.findUnique({ where: { id: B.organization.id } }),
    memberships: await ctx.prisma.organizationMembership.findMany({ where, ...byId }),
    invitations: await ctx.prisma.invitation.findMany({ where, ...byId }),
    stores: await ctx.prisma.store.findMany({ where, ...byId }),
    categories: await ctx.prisma.category.findMany({ where, ...byId }),
    products: await ctx.prisma.product.findMany({
      where,
      ...byId,
      include: { variants: byId, images: byId },
    }),
    levels: await ctx.prisma.inventoryLevel.findMany({ where, ...byId }),
    movements: await ctx.prisma.inventoryMovement.findMany({ where, ...byId }),
    customers: await ctx.prisma.customer.findMany({ where, ...byId, include: { addresses: byId } }),
    orders: await ctx.prisma.order.findMany({
      where,
      ...byId,
      include: { items: { ...byId, include: { reservation: true } }, history: byId },
    }),
  };
  return JSON.stringify(snapshot);
}

test('every route parameter has a cross-tenant fixture (new routes must extend this suite)', () => {
  const params = new Set(ctx.app.locals.routeTable.flatMap((r) => paramNames(r.path)));
  for (const name of params) expect(Object.keys(foreign)).toContain(name);
});

test("every route with an ID in its path answers 404 for another organization's ID and changes nothing", async () => {
  const before = await snapshotB();
  const routes = ctx.app.locals.routeTable.filter(
    (r) => r.access !== 'public' && paramNames(r.path).length,
  );
  expect(routes.length).toBeGreaterThan(0);

  const client = A.members.OWNER.client;
  for (const route of routes) {
    const path = fill(route.path, foreign);
    const body = BODIES[`${route.method} ${route.path}`];
    const res = await client[route.method.toLowerCase()](path, body);
    expect({ route: `${route.method} ${route.path}`, status: res.status }).toEqual({
      route: `${route.method} ${route.path}`,
      status: 404,
    });
  }
  expect(await snapshotB()).toEqual(before);
});

test("list endpoints return only the caller's organization data", async () => {
  const client = A.members.OWNER.client;
  const aUserIds = Object.values(A.members)
    .map((m) => m.user.id)
    .sort();

  const members = await client.get('/members');
  expect(members.body.data.map((m) => m.userId).sort()).toEqual(aUserIds);

  expect((await client.get('/members/invitations')).body.data).toEqual([]);

  const stores = await client.get('/stores');
  expect(stores.body.data.map((s) => s.id)).toEqual([A.store.id]);

  const current = await client.get('/organizations/current');
  expect(current.body.data.id).toBe(A.organization.id);

  const audit = await client.get('/audit-logs');
  const bAuditIds = (
    await ctx.prisma.auditLog.findMany({ where: { organizationId: B.organization.id } })
  ).map((r) => r.id);
  expect(bAuditIds.length).toBeGreaterThan(0);
  for (const row of audit.body.data) expect(bAuditIds).not.toContain(row.id);
});

test('an ID from another organization in a request body is rejected', async () => {
  const res = await A.members.OWNER.client.post('/organizations/current/ownership-transfer', {
    toMembershipId: B.members.MANAGER.membership.id,
    password: 'correct-horse-battery',
  });
  expect(res.status).toBe(404);
  expect(await ctx.prisma.ownershipTransfer.count()).toBe(0);
});

test('stock cannot be moved across organizations through request bodies', async () => {
  const before = await snapshotB();
  const client = A.members.OWNER.client;
  const aProduct = (await client.post('/products', productInput())).body.data;

  const intoForeignVariant = await client.post('/inventory/receipts', {
    storeId: A.store.id,
    variantId: foreign.variantId,
    quantity: 5,
  });
  expect(intoForeignVariant.status).toBe(400);
  expect(intoForeignVariant.body.error.details.fieldErrors.variantId).toBeDefined();

  const intoForeignStore = await client.post('/inventory/receipts', {
    storeId: B.store.id,
    variantId: aProduct.variants[0].id,
    quantity: 5,
  });
  expect(intoForeignStore.status).toBe(400);

  const adjustForeign = await client.post('/inventory/adjustments', {
    storeId: B.store.id,
    variantId: foreign.variantId,
    change: -7,
    reason: 'LOST',
  });
  expect(adjustForeign.status).toBe(400);

  const listForeignStore = await client.get(`/inventory?storeId=${B.store.id}`);
  expect(listForeignStore.status).toBe(400);
  const historyForeign = await client.get(`/inventory/movements?variantId=${foreign.variantId}`);
  expect(historyForeign.body.data).toEqual([]);

  expect(await snapshotB()).toEqual(before);
  expect(
    await ctx.prisma.inventoryLevel.count({ where: { organizationId: A.organization.id } }),
  ).toBe(0);
});

test('an invitation token from org B cannot be used to join org A, and joins only B', async () => {
  const { token } = lastEmailTo(ctx.mailer, 'b-invitee@example.com');
  const client = A.members.OWNER.client;

  // A's owner is signed in with a different email, so the invitation is refused outright.
  const res = await client.post('/invitations/accept', { token });
  expect(res.status).toBe(403);
  const aMembers = await ctx.prisma.organizationMembership.count({
    where: { organizationId: A.organization.id },
  });
  expect(aMembers).toBe(5);
});

test('the session cannot be pointed at another organization by the client', async () => {
  const client = A.members.OWNER.client;
  // There is no request field that selects the tenant: extra headers and params are ignored.
  const res = await client.agent
    .get('/api/v1/organizations/current')
    .query({ organizationId: B.organization.id })
    .set('X-Organization-Id', B.organization.id);
  expect(res.body.data.id).toBe(A.organization.id);

  const sw = await client.post(`/organizations/${B.organization.id}/switch`);
  expect(sw.status).toBe(404);
  expect((await client.get('/organizations/current')).body.data.id).toBe(A.organization.id);
});
