import { randomUUID } from 'node:crypto';
import { createTestApp, resetState } from './helpers/testApp.js';
import { apiClient } from './helpers/client.js';
import {
  createUser,
  organizationWithAllRoles,
  productInput,
  setSubscription,
  enableMfa,
  lastEmailTo,
  platformAdmin,
  signIn,
} from './helpers/factories.js';
import { ROLES } from '../src/modules/auth/permissions.js';

let ctx;
let A;
let B;
let adminUser;
let admin;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await resetState(ctx);
  A = await organizationWithAllRoles(ctx.app, ctx.prisma);
  B = await organizationWithAllRoles(ctx.app, ctx.prisma);
  ({ user: adminUser, client: admin } = await platformAdmin(ctx.app, ctx.prisma));
});

const platformRoutes = () => ctx.app.locals.routeTable.filter((r) => r.access.platform);
const fill = (path) => path.replace(/:(\w+)/g, () => randomUUID());
const REASON = 'Customer asked support to look into a billing question';
const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

describe('access', () => {
  test('every admin route refuses anonymous callers and every organization role, owners included', async () => {
    const routes = platformRoutes();
    expect(routes.length).toBe(15);
    const outsider = await signIn(ctx.app, await createUser(ctx.prisma));
    const callers = [
      ...ROLES.map((role) => [role, A.members[role].client]),
      ['no organization', outsider],
    ];
    for (const route of routes) {
      const anonymous = await apiClient(ctx.app)[route.method.toLowerCase()](fill(route.path), {});
      expect({ route: route.path, status: anonymous.status }).toEqual({
        route: route.path,
        status: 401,
      });
      for (const [who, client] of callers) {
        const res = await client[route.method.toLowerCase()](fill(route.path), {});
        expect({ route: `${route.method} ${route.path}`, who, status: res.status }).toEqual({
          route: `${route.method} ${route.path}`,
          who,
          status: 403,
        });
      }
    }
  });

  test('revoking the role takes effect on the next request', async () => {
    expect((await admin.get('/admin/stats')).status).toBe(200);
    await ctx.prisma.user.update({ where: { id: adminUser.id }, data: { platformRole: 'NONE' } });
    expect((await admin.get('/admin/stats')).status).toBe(403);
  });

  test('the role cannot be granted through the API', async () => {
    // The profile update ignores or refuses the field; either way nothing changes.
    await A.members.OWNER.client.patch('/auth/me', { name: 'Owner', platformRole: 'SUPER_ADMIN' });
    const owner = await ctx.prisma.user.findUnique({ where: { id: A.members.OWNER.user.id } });
    expect(owner.platformRole).toBe('NONE');
  });
});

describe('overview', () => {
  test('stats count organizations, subscriptions, revenue from paying customers and problems', async () => {
    // A pays for Growth through Stripe; B was given Scale for free; one more trial ends soon.
    await setSubscription(ctx.prisma, A.organization.id, { plan: 'growth', status: 'ACTIVE' });
    await ctx.prisma.subscription.update({
      where: { organizationId: A.organization.id },
      data: { provider: 'stripe', providerSubscriptionId: 'sub_admin_1' },
    });
    await setSubscription(ctx.prisma, B.organization.id, { plan: 'scale', status: 'ACTIVE' });
    const C = await organizationWithAllRoles(ctx.app, ctx.prisma);
    await ctx.prisma.subscription.update({
      where: { organizationId: C.organization.id },
      data: { trialEndsAt: new Date(Date.now() + 3 * 86_400_000) },
    });
    await ctx.prisma.webhookEvent.create({
      data: { provider: 'stripe', eventId: 'evt_failed', type: 'invoice.paid', status: 'FAILED' },
    });
    await admin.post(`/admin/organizations/${C.organization.id}/suspend`, { reason: REASON });

    const res = await admin.get('/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      organizations: { total: 3, active: 2, suspended: 1, createdLast30Days: 3 },
      subscriptionsByStatus: { ACTIVE: 2, TRIALING: 1 },
      subscriptionsByPlan: [
        { code: 'growth', count: 2 },
        { code: 'scale', count: 1 },
      ],
      // Only A pays: the complimentary Scale plan and the trial bring nothing.
      monthlyRecurringRevenue: [{ currency: 'USD', amount: '79.00', subscriptions: 1 }],
      trialsEndingIn7Days: 1,
      failedWebhooks: 1,
    });
    expect(res.body.data.users.total).toBe(16); // 3 × 5 members + the admin
  });

  test('organizations can be searched by name or owner email and filtered', async () => {
    await ctx.prisma.organization.update({
      where: { id: B.organization.id },
      data: { name: 'Casablanca Ceramics' },
    });
    await ctx.prisma.subscription.update({
      where: { organizationId: A.organization.id },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    });
    const byName = await admin.get('/admin/organizations?search=ceramics');
    expect(byName.body.data.map((o) => o.id)).toEqual([B.organization.id]);
    expect(byName.body.data[0]).toMatchObject({
      planCode: 'growth',
      subscriptionStatus: 'TRIALING',
      memberCount: 5,
      owner: { email: B.members.OWNER.user.email },
    });

    const byOwner = await admin.get(`/admin/organizations?search=${A.members.OWNER.user.email}`);
    expect(byOwner.body.data.map((o) => o.id)).toEqual([A.organization.id]);
    // A's trial ended a second ago: it is expired even before the hourly job.
    const expired = await admin.get('/admin/organizations?subscription=EXPIRED');
    expect(expired.body.data.map((o) => o.id)).toEqual([A.organization.id]);
    expect((await admin.get('/admin/organizations?status=SUSPENDED')).body.meta.total).toBe(0);
    expect((await admin.get('/admin/organizations?plan=scale')).body.meta.total).toBe(0);
    expect((await admin.get('/admin/organizations')).body.meta.total).toBe(2);
  });

  test('an organization shows its members, usage, subscription and recent invoices', async () => {
    await A.members.OWNER.client.post('/products', productInput());
    const res = await admin.get(`/admin/organizations/${A.organization.id}`);
    expect(res.body.data).toMatchObject({
      id: A.organization.id,
      status: 'ACTIVE',
      subscription: { status: 'TRIALING', plan: { code: 'growth' }, billedByProvider: false },
      usage: { stores: 1, members: 5, products: 1, orders: 0 },
      recentInvoices: [],
    });
    expect(res.body.data.members.map((m) => m.role).sort()).toEqual([...ROLES].sort());
    expect((await admin.get(`/admin/organizations/${randomUUID()}`)).status).toBe(404);
  });
});

describe('suspension', () => {
  test('suspending needs a reason, locks the members out, and is visible in the audit log', async () => {
    const path = `/admin/organizations/${A.organization.id}`;
    expect((await admin.post(`${path}/suspend`, {})).status).toBe(400);
    const res = await admin.post(`${path}/suspend`, { reason: REASON });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'SUSPENDED', suspendedReason: REASON });
    expect((await admin.post(`${path}/suspend`, { reason: REASON })).status).toBe(409);

    const locked = await A.members.MANAGER.client.get('/products');
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('ORGANIZATION_SUSPENDED');
    // Other organizations are untouched.
    expect((await B.members.MANAGER.client.get('/products')).status).toBe(200);

    await admin.post(`${path}/reactivate`, { reason: 'Payment received, issue resolved' });
    expect((await A.members.MANAGER.client.get('/products')).status).toBe(200);

    const audit = await A.members.OWNER.client.get('/audit-logs');
    const actions = audit.body.data.map((r) => [r.action, r.actor?.name, r.metadata?.reason]);
    expect(actions).toEqual(
      expect.arrayContaining([
        ['admin.organization_suspended', adminUser.name, REASON],
        ['admin.organization_reactivated', adminUser.name, 'Payment received, issue resolved'],
      ]),
    );
  });
});

describe('subscription changes', () => {
  const path = () => `/admin/organizations/${A.organization.id}/subscription`;

  test('a trial can be extended, up to 90 days, with a reason', async () => {
    const extend = (trialEndsAt, extra = {}) =>
      admin.put(path(), {
        plan: 'growth',
        status: 'TRIALING',
        trialEndsAt,
        reason: REASON,
        ...extra,
      });
    expect((await extend(days(-1))).status).toBe(400);
    expect((await extend(days(91))).status).toBe(400);
    expect((await extend(days(30), { reason: '' })).status).toBe(400);

    const res = await extend(days(30));
    expect(res.status).toBe(200);
    expect(res.body.data.subscription).toMatchObject({
      status: 'TRIALING',
      plan: { code: 'growth' },
    });
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'admin.subscription_changed' },
    });
    expect(audit).toMatchObject({ organizationId: A.organization.id, actorUserId: adminUser.id });
    expect(audit.metadata).toMatchObject({
      reason: REASON,
      from: { plan: 'growth', status: 'TRIALING' },
      to: { plan: 'growth', status: 'TRIALING' },
    });
  });

  test('an expired organization can be given a complimentary plan, which brings it back', async () => {
    await setSubscription(ctx.prisma, A.organization.id, { plan: 'growth', status: 'EXPIRED' });
    expect((await A.members.OWNER.client.post('/products', productInput())).status).toBe(402);
    const res = await admin.put(path(), { plan: 'scale', status: 'ACTIVE', reason: REASON });
    expect(res.body.data.subscription).toMatchObject({
      status: 'ACTIVE',
      plan: { code: 'scale' },
      billedByProvider: false,
    });
    expect((await A.members.OWNER.client.post('/products', productInput())).status).toBe(201);
  });

  test('a subscription paid through Stripe is changed in Stripe, not here', async () => {
    await setSubscription(ctx.prisma, A.organization.id, { plan: 'growth', status: 'ACTIVE' });
    await ctx.prisma.subscription.update({
      where: { organizationId: A.organization.id },
      data: { provider: 'stripe', providerSubscriptionId: 'sub_admin_2' },
    });
    const res = await admin.put(path(), { plan: 'scale', status: 'ACTIVE', reason: REASON });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BILLED_BY_PROVIDER');
  });
});

describe('audit information', () => {
  test('reading an organization’s audit log needs a reason, which is itself recorded', async () => {
    await A.members.OWNER.client.post('/members/invitations', {
      email: 'new@example.com',
      role: 'ANALYST',
    });
    const path = `/admin/organizations/${A.organization.id}/audit-logs`;
    const refused = await admin.get(path);
    expect(refused.status).toBe(400);
    expect(refused.body.error.details.fieldErrors.reason).toBeDefined();
    expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.audit_viewed' } })).toBe(0);

    const res = await admin.get(`${path}?reason=${encodeURIComponent(REASON)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.action)).toContain('invitation.created');
    // Only that organization's entries.
    const orgIds = await ctx.prisma.auditLog.findMany({
      where: { id: { in: res.body.data.map((r) => r.id) } },
      select: { organizationId: true },
    });
    expect(new Set(orgIds.map((r) => r.organizationId))).toEqual(new Set([A.organization.id]));

    // The owner can see that support read it, and why.
    const ownerView = await A.members.OWNER.client.get('/audit-logs');
    expect(ownerView.body.data.find((r) => r.action === 'admin.audit_viewed')).toMatchObject({
      actor: { name: adminUser.name },
      metadata: { reason: REASON },
    });
  });
});

describe('user management', () => {
  const REASON_USER = 'Fraud report, ticket 5120';

  test('users are found by name or email, with their organizations and last sign-in', async () => {
    const target = A.members.MANAGER.user;
    const res = await admin.get(`/admin/users?search=${encodeURIComponent(target.email)}`);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({
      email: target.email,
      status: 'ACTIVE',
      mfaEnabled: false,
      organizations: 1,
      lastSignInAt: expect.any(String),
    });
    const detail = await admin.get(`/admin/users/${target.id}`);
    expect(detail.body.data.memberships).toEqual([
      expect.objectContaining({
        role: 'MANAGER',
        organization: expect.objectContaining({ id: A.organization.id }),
      }),
    ]);
    expect((await admin.get(`/admin/users/${randomUUID()}`)).status).toBe(404);
  });

  test('disabling ends every session and blocks sign-in until enabled again, with a reason', async () => {
    const target = A.members.MANAGER;
    const path = `/admin/users/${target.user.id}`;
    expect((await admin.post(`${path}/disable`, {})).status).toBe(400);

    const res = await admin.post(`${path}/disable`, { reason: REASON_USER });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DISABLED');
    expect((await target.client.get('/auth/me')).status).toBe(401);
    const login = await apiClient(ctx.app).post('/auth/login', {
      email: target.user.email,
      password: 'correct-horse-battery',
    });
    expect(login.status).toBe(401);
    expect((await admin.post(`${path}/disable`, { reason: REASON_USER })).status).toBe(409);

    await admin.post(`${path}/enable`, { reason: 'Report was a mistake' });
    expect((await signIn(ctx.app, target.user)).csrfToken).toBeTruthy();

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'admin.user_disabled' } });
    expect(audit).toMatchObject({
      organizationId: null,
      actorUserId: adminUser.id,
      entityId: target.user.id,
      metadata: { reason: REASON_USER, email: target.user.email, sessionsEnded: 1 },
    });
  });

  test('an admin cannot disable themselves or another administrator', async () => {
    const self = await admin.post(`/admin/users/${adminUser.id}/disable`, { reason: REASON_USER });
    expect(self.body.error.code).toBe('CANNOT_CHANGE_SELF');
    const other = await createUser(ctx.prisma, { platformRole: 'SUPER_ADMIN' });
    const res = await admin.post(`/admin/users/${other.id}/disable`, { reason: REASON_USER });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PLATFORM_ADMIN');
    expect((await ctx.prisma.user.findUnique({ where: { id: other.id } })).status).toBe('ACTIVE');
  });

  test('signs a user out everywhere without disabling them', async () => {
    const target = A.members.ANALYST;
    const res = await admin.post(`/admin/users/${target.user.id}/sign-out`, {
      reason: REASON_USER,
    });
    expect(res.body.data).toEqual({ sessionsEnded: 1 });
    expect((await target.client.get('/auth/me')).status).toBe(401);
    expect((await signIn(ctx.app, target.user)).csrfToken).toBeTruthy();
  });

  test('resends the confirmation email to unverified users only', async () => {
    const unverified = await createUser(ctx.prisma, { emailVerifiedAt: null });
    const res = await admin.post(`/admin/users/${unverified.id}/verification-email`);
    expect(res.status).toBe(202);
    expect((await lastEmailTo(ctx, unverified.email)).token).toBeTruthy();
    const verified = await admin.post(`/admin/users/${A.members.OWNER.user.id}/verification-email`);
    expect(verified.status).toBe(409);
  });

  test('resets two-factor sign-in for a user who lost their phone', async () => {
    const target = A.members.ORDER_MANAGER.user;
    await enableMfa(ctx.prisma, target);
    const res = await admin.post(`/admin/users/${target.id}/mfa/reset`, { reason: REASON_USER });
    expect(res.body.data.mfaEnabled).toBe(false);
    const login = await apiClient(ctx.app).post('/auth/login', {
      email: target.email,
      password: 'correct-horse-battery',
    });
    expect(login.body.data.mfaRequired).toBeUndefined();
  });
});

describe('platform activity', () => {
  test('lists every admin action across organizations, with who, why and where', async () => {
    await admin.post(`/admin/organizations/${A.organization.id}/suspend`, { reason: REASON });
    await admin.post(`/admin/users/${B.members.ANALYST.user.id}/sign-out`, {
      reason: 'Shared laptop',
    });
    await ctx.prisma.auditLog.create({
      data: { action: 'platform.admin_granted', entityType: 'User', entityId: adminUser.id },
    });
    // Not admin actions: left out.
    await A.members.OWNER.client.post('/products', productInput());

    const res = await admin.get('/admin/activity');
    expect(res.body.data.map((r) => r.action)).toEqual([
      'platform.admin_granted',
      'admin.user_signed_out',
      'admin.organization_suspended',
    ]);
    const [, signOut, suspend] = res.body.data;
    expect(signOut).toMatchObject({
      reason: 'Shared laptop',
      actor: { email: adminUser.email },
      user: { email: B.members.ANALYST.user.email },
    });
    expect(suspend.organization).toEqual({ id: A.organization.id, name: A.organization.name });

    const filtered = await admin.get('/admin/activity?action=admin.organization_suspended');
    expect(filtered.body.meta.total).toBe(1);
    expect((await admin.get('/admin/activity?action=auth.login')).status).toBe(400);
  });
});
