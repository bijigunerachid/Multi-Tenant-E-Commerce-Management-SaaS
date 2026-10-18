import { randomUUID } from 'node:crypto';
import { createTestApp, resetState } from './helpers/testApp.js';
import { apiClient } from './helpers/client.js';
import {
  createUser,
  lastEmailTo,
  organizationWithAllRoles,
  productInput,
  setSubscription,
  signIn,
} from './helpers/factories.js';
import { expireTrials } from '../src/jobs/subscriptions.js';

// A plan with tiny limits, so tests reach them in a few requests. Inactive: never offered.
const TINY = { stores: 2, members: 3, products: 2 };

let ctx;
let org;
let owner;

beforeAll(async () => {
  ctx = await createTestApp();
  const tiny = {
    name: 'Tiny (tests)',
    priceMonthly: '1.00',
    currency: 'USD',
    limits: TINY,
    features: { csvExport: false },
    isActive: false,
    position: 99,
  };
  await ctx.prisma.subscriptionPlan.upsert({
    where: { code: 'test-tiny' },
    create: { code: 'test-tiny', ...tiny },
    update: tiny,
  });
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await resetState(ctx);
  org = await organizationWithAllRoles(ctx.app, ctx.prisma);
  owner = org.members.OWNER.client;
});

const onPlan = (plan, status = 'ACTIVE') =>
  setSubscription(ctx.prisma, org.organization.id, { plan, status });
const createProduct = (overrides) => owner.post('/products', productInput(overrides));
const fillWithRandomIds = (path) => path.replace(/:(\w+)/g, () => randomUUID());

describe('trial', () => {
  test('onboarding starts a 14-day Growth trial that everyone can see', async () => {
    const user = await createUser(ctx.prisma);
    const client = await signIn(ctx.app, user);
    const res = await client.post('/organizations', {
      name: 'Atlas Outfitters',
      storeName: 'Main store',
      defaultCurrency: 'USD',
      timezone: 'UTC',
    });
    expect(res.status).toBe(201);
    const trial = res.body.data.session.activeOrganization.subscription;
    expect(trial).toMatchObject({ status: 'TRIALING', usable: true, planName: 'Growth' });
    const days = (new Date(trial.trialEndsAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);

    const current = await client.get('/subscriptions/current');
    expect(current.body.data).toMatchObject({
      status: 'TRIALING',
      plan: { code: 'growth', priceMonthly: '79.00', limits: { stores: 3 } },
      usage: { stores: 1, members: 1, products: 0 },
    });
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'organization.created' },
    });
    expect(audit.metadata.trialEndsAt).toBeDefined();
  });

  test('the offered plans are listed in order, without inactive ones', async () => {
    const res = await owner.get('/subscriptions/plans');
    expect(res.body.data.map((p) => [p.code, p.priceMonthly, p.features.csvExport])).toEqual([
      ['starter', '29.00', false],
      ['growth', '79.00', true],
      ['scale', '199.00', true],
    ]);
  });

  test('the hourly job expires ended trials once, and leaves the others alone', async () => {
    const other = await organizationWithAllRoles(ctx.app, ctx.prisma);
    await ctx.prisma.subscription.update({
      where: { organizationId: org.organization.id },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    });
    expect(await expireTrials(ctx.prisma)).toBe(1);
    expect(await expireTrials(ctx.prisma)).toBe(0);

    const [expired, running] = await Promise.all(
      [org, other].map((o) =>
        ctx.prisma.subscription.findUnique({ where: { organizationId: o.organization.id } }),
      ),
    );
    expect(expired.status).toBe('EXPIRED');
    expect(running.status).toBe('TRIALING');
    const audits = await ctx.prisma.auditLog.findMany({
      where: { action: 'subscription.trial_expired' },
    });
    expect(audits.map((a) => a.organizationId)).toEqual([org.organization.id]);
  });
});

describe('read-only mode', () => {
  const readOnlyStatuses = ['EXPIRED', 'CANCELED'];

  test.each(readOnlyStatuses)(
    '%s: every change is refused with 402, except those that reduce usage or concern access',
    async (status) => {
      await onPlan('growth', status);
      const writes = ctx.app.locals.routeTable.filter(
        (r) => r.access.permission && r.method !== 'GET',
      );
      for (const route of writes) {
        const res = await owner[route.method.toLowerCase()](fillWithRandomIds(route.path), {});
        const refused = res.status === 402 && res.body.error.code === 'SUBSCRIPTION_INACTIVE';
        expect({ route: `${route.method} ${route.path}`, refused }).toEqual({
          route: `${route.method} ${route.path}`,
          refused: route.whenInactive !== 'allow',
        });
      }
    },
  );

  test('reads keep working, and every member is told why', async () => {
    await createProduct();
    await onPlan('growth', 'EXPIRED');
    expect((await owner.get('/products')).body.meta.total).toBe(1);
    const session = await org.members.ANALYST.client.get('/auth/me');
    expect(session.body.data.activeOrganization.subscription).toMatchObject({
      status: 'EXPIRED',
      usable: false,
    });
    const refused = await createProduct();
    expect(refused.body.error.message).toMatch(/trial has ended.*read-only/);
  });

  test('a trial is read-only as soon as it ends, before the job has run', async () => {
    await ctx.prisma.subscription.update({
      where: { organizationId: org.organization.id },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    });
    const res = await createProduct();
    expect(res.status).toBe(402);
    expect(res.body.error.details.status).toBe('EXPIRED');
  });

  test('a failed payment (past due) keeps the organization usable during the grace period', async () => {
    await onPlan('growth', 'PAST_DUE');
    expect((await createProduct()).status).toBe(201);
  });

  test('an invitation to a read-only organization cannot be accepted', async () => {
    await owner.post('/members/invitations', { email: 'late@example.com', role: 'ANALYST' });
    const { token } = await lastEmailTo(ctx, 'late@example.com');
    await onPlan('growth', 'EXPIRED');
    const res = await apiClient(ctx.app).post('/invitations/accept', {
      token,
      name: 'Late Joiner',
      password: 'a-long-enough-password',
    });
    expect(res.status).toBe(402);
    expect(await ctx.prisma.user.count({ where: { email: 'late@example.com' } })).toBe(0);
  });
});

describe('usage limits', () => {
  beforeEach(() => onPlan('test-tiny'));

  test('products: archived ones do not count, and bringing one back does', async () => {
    const first = await createProduct();
    expect((await createProduct()).status).toBe(201);
    const third = await createProduct();
    expect(third.status).toBe(402);
    expect(third.body.error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      message: expect.stringContaining('includes 2 products'),
      details: { resource: 'products', limit: 2, current: 2, plan: 'test-tiny' },
    });
    // An archived product can still be created: it does not count.
    expect((await createProduct({ status: 'ARCHIVED' })).status).toBe(201);

    const id = first.body.data.id;
    await owner.patch(`/products/${id}/status`, { status: 'ARCHIVED' });
    expect((await createProduct()).status).toBe(201);
    // Now at the limit again: restoring the archived one is refused, by either route.
    expect((await owner.patch(`/products/${id}/status`, { status: 'ACTIVE' })).status).toBe(402);
    const put = await owner.put(`/products/${id}`, {
      ...productInput(),
      variants: first.body.data.variants.map((v) => ({ id: v.id, sku: v.sku, price: v.price })),
      status: 'ACTIVE',
    });
    expect(put.status).toBe(402);
  });

  test('products: requests racing for the last slot get it once', async () => {
    await createProduct();
    const results = await Promise.all(Array.from({ length: 6 }, () => createProduct()));
    expect(results.map((r) => r.status).sort()).toEqual([201, 402, 402, 402, 402, 402]);
    expect(await ctx.prisma.product.count({ where: { organizationId: org.organization.id } })).toBe(
      2,
    );
  });

  test('members: pending invitations take a seat, and seats free up', async () => {
    // The fixture organization already has 5 members; deactivate down to the owner + 1.
    for (const role of ['ORDER_MANAGER', 'INVENTORY_MANAGER', 'ANALYST']) {
      await owner.post(`/members/${org.members[role].membership.id}/deactivate`);
    }
    const invite = (email) => owner.post('/members/invitations', { email, role: 'ANALYST' });
    const pending = await invite('one@example.com');
    expect(pending.status).toBe(201);
    const over = await invite('two@example.com');
    expect(over.status).toBe(402);
    expect(over.body.error.details).toMatchObject({ resource: 'members', limit: 3, current: 3 });

    // Reactivating someone is refused for the same reason.
    const reactivate = await owner.post(`/members/${org.members.ANALYST.membership.id}/reactivate`);
    expect(reactivate.status).toBe(402);

    // Revoking the invitation frees its seat.
    await owner.delete(`/members/invitations/${pending.body.data.id}`);
    expect((await invite('two@example.com')).status).toBe(201);
    // Accepting an invitation never goes over: its seat was taken when it was sent.
    const { token } = await lastEmailTo(ctx, 'two@example.com');
    const accepted = await apiClient(ctx.app).post('/invitations/accept', {
      token,
      name: 'Two',
      password: 'a-long-enough-password',
    });
    expect(accepted.status).toBe(200);
    expect((await owner.get('/subscriptions/current')).body.data.usage.members).toBe(3);
  });

  test('stores: archived ones do not count, restoring one does', async () => {
    const store = { currency: 'USD', timezone: 'UTC' };
    const second = await owner.post('/stores', { name: 'Harbour store', ...store });
    expect(second.status).toBe(201);
    const third = await owner.post('/stores', { name: 'Airport store', ...store });
    expect(third.status).toBe(402);
    expect(third.body.error.message).toBe(
      'The Tiny (tests) plan includes 2 active stores. Archive a store or change plan to add another.',
    );

    expect((await owner.post(`/stores/${second.body.data.id}/archive`)).status).toBe(200);
    expect((await owner.post('/stores', { name: 'Airport store', ...store })).status).toBe(201);
    expect((await owner.post(`/stores/${second.body.data.id}/restore`)).status).toBe(402);
  });
});

describe('plan features', () => {
  test('CSV exports are refused on plans without them, and work on plans with them', async () => {
    const exports = ctx.app.locals.routeTable.filter((r) => r.feature === 'csvExport');
    expect(exports.map((r) => r.path).sort()).toEqual([
      '/customers/export',
      '/orders/export',
      '/reports/products/export',
      '/reports/sales/export',
      '/reports/stores/export',
    ]);
    const query = '?from=2026-09-01&to=2026-09-30';
    await onPlan('starter');
    for (const route of exports) {
      const res = await owner.get(`${route.path}${query}`);
      expect({ path: route.path, status: res.status, code: res.body.error?.code }).toEqual({
        path: route.path,
        status: 402,
        code: 'PLAN_FEATURE_UNAVAILABLE',
      });
    }
    await onPlan('growth');
    for (const route of exports) {
      const res = await owner.get(`${route.path}${query}`);
      expect({ path: route.path, status: res.status }).toEqual({ path: route.path, status: 200 });
    }
  });
});
