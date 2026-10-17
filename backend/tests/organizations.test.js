import { createTestApp, resetState } from './helpers/testApp.js';
import {
  PASSWORD,
  addMember,
  createOrganization,
  createUser,
  signIn,
} from './helpers/factories.js';

let ctx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => resetState(ctx));

const onboarding = {
  name: 'Atlas Outfitters',
  defaultCurrency: 'mad',
  timezone: 'Africa/Casablanca',
  storeName: 'Casablanca flagship',
};

describe('onboarding', () => {
  test('creates the organization, owner membership and first store, and switches into it', async () => {
    const user = await createUser(ctx.prisma);
    const client = await signIn(ctx.app, user);

    const res = await client.post('/organizations', onboarding);

    expect(res.status).toBe(201);
    expect(res.body.data.organization).toMatchObject({
      name: 'Atlas Outfitters',
      slug: 'atlas-outfitters',
      defaultCurrency: 'MAD',
      timezone: 'Africa/Casablanca',
    });
    const session = res.body.data.session;
    expect(session.activeOrganization).toMatchObject({ name: 'Atlas Outfitters', role: 'OWNER' });
    expect(session.activeOrganization.permissions).toContain('member:manage');

    const stores = await client.get('/stores');
    expect(stores.body.data).toEqual([
      expect.objectContaining({
        name: 'Casablanca flagship',
        slug: 'casablanca-flagship',
        currency: 'MAD',
      }),
    ]);

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'organization.created' },
    });
    expect(audit.organizationId).toBe(res.body.data.organization.id);
  });

  test('requires a verified email', async () => {
    const user = await createUser(ctx.prisma, { emailVerifiedAt: null });
    const client = await signIn(ctx.app, user);

    const res = await client.post('/organizations', onboarding);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  test('a generated slug that collides gets a suffix; a chosen slug that collides is a 409', async () => {
    const user = await createUser(ctx.prisma);
    const client = await signIn(ctx.app, user);

    const first = await client.post('/organizations', onboarding);
    const second = await client.post('/organizations', onboarding);
    expect(second.status).toBe(201);
    expect(second.body.data.organization.slug).toMatch(/^atlas-outfitters-[0-9a-f]{6}$/);

    const chosen = await client.post('/organizations', {
      ...onboarding,
      slug: first.body.data.organization.slug,
    });
    expect(chosen.status).toBe(409);
    expect(chosen.body.error.details.fieldErrors.slug).toBeDefined();
  });

  test('validates currency and time zone', async () => {
    const client = await signIn(ctx.app, await createUser(ctx.prisma));
    const res = await client.post('/organizations', {
      ...onboarding,
      defaultCurrency: 'XXZ',
      timezone: 'Mars/Olympus',
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details.fieldErrors).sort()).toEqual([
      'defaultCurrency',
      'timezone',
    ]);
  });

  test('a user without an organization gets a clear error on tenant routes', async () => {
    const client = await signIn(ctx.app, await createUser(ctx.prisma));
    const res = await client.get('/organizations/current');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NO_ACTIVE_ORGANIZATION');
  });
});

describe('organization switching', () => {
  test('switches between organizations the user belongs to', async () => {
    const user = await createUser(ctx.prisma);
    const a = await createOrganization(ctx.prisma, { owner: user, name: 'Org A' });
    const b = await createOrganization(ctx.prisma, { name: 'Org B' });
    await addMember(ctx.prisma, b.organization.id, 'ANALYST', { user });
    const client = await signIn(ctx.app, user);

    const switched = await client.post(`/organizations/${b.organization.id}/switch`);
    expect(switched.status).toBe(200);
    expect(switched.body.data.activeOrganization).toMatchObject({
      id: b.organization.id,
      role: 'ANALYST',
    });
    expect((await client.get('/organizations/current')).body.data.name).toBe('Org B');

    await client.post(`/organizations/${a.organization.id}/switch`);
    expect((await client.get('/organizations/current')).body.data.name).toBe('Org A');
  });

  test('cannot switch into an organization without membership (404, not 403)', async () => {
    const client = await signIn(ctx.app, await createUser(ctx.prisma));
    const foreign = await createOrganization(ctx.prisma);

    const res = await client.post(`/organizations/${foreign.organization.id}/switch`);
    expect(res.status).toBe(404);
  });

  test('cannot switch into an organization where the membership is deactivated or the org is suspended', async () => {
    const user = await createUser(ctx.prisma);
    const deactivated = await createOrganization(ctx.prisma);
    await addMember(ctx.prisma, deactivated.organization.id, 'MANAGER', {
      user,
      status: 'DEACTIVATED',
    });
    const suspended = await createOrganization(ctx.prisma);
    await addMember(ctx.prisma, suspended.organization.id, 'MANAGER', { user });
    await ctx.prisma.organization.update({
      where: { id: suspended.organization.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    const client = await signIn(ctx.app, user);

    expect((await client.post(`/organizations/${deactivated.organization.id}/switch`)).status).toBe(
      404,
    );
    expect((await client.post(`/organizations/${suspended.organization.id}/switch`)).status).toBe(
      404,
    );
  });

  test('suspending an organization blocks its members on the next request', async () => {
    const { organization, owner } = await createOrganization(ctx.prisma);
    const client = await signIn(ctx.app, owner);
    expect((await client.get('/organizations/current')).status).toBe(200);

    await ctx.prisma.organization.update({
      where: { id: organization.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    const res = await client.get('/organizations/current');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORGANIZATION_SUSPENDED');
  });
});

describe('organization settings', () => {
  test('the owner updates settings and the change is audited', async () => {
    const { owner } = await createOrganization(ctx.prisma);
    const client = await signIn(ctx.app, owner);

    const res = await client.patch('/organizations/current', {
      name: 'Renamed',
      contactEmail: 'Hello@Renamed.example',
      contactPhone: '+212 600 000 000',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Renamed', contactEmail: 'hello@renamed.example' });

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'organization.updated' },
    });
    expect(audit.metadata.changed.sort()).toEqual(['contactEmail', 'contactPhone', 'name']);
  });

  test('the slug and status cannot be changed through settings', async () => {
    const { owner, organization } = await createOrganization(ctx.prisma);
    const client = await signIn(ctx.app, owner);

    await client.patch('/organizations/current', {
      name: 'X',
      slug: 'hijack',
      status: 'SUSPENDED',
    });
    const after = await ctx.prisma.organization.findUnique({ where: { id: organization.id } });
    expect(after.slug).toBe(organization.slug);
    expect(after.status).toBe('ACTIVE');
  });
});

describe('ownership transfer', () => {
  async function setup() {
    const org = await createOrganization(ctx.prisma);
    const manager = await addMember(ctx.prisma, org.organization.id, 'MANAGER');
    return {
      ...org,
      manager,
      ownerClient: await signIn(ctx.app, org.owner),
      managerClient: await signIn(ctx.app, manager.user),
    };
  }

  test('owner starts, target accepts: roles swap atomically', async () => {
    const s = await setup();

    const start = await s.ownerClient.post('/organizations/current/ownership-transfer', {
      toMembershipId: s.manager.membership.id,
      password: PASSWORD,
    });
    expect(start.status).toBe(201);
    await ctx.emails.drain();
    expect(ctx.mailer.sent.at(-1).to).toBe(s.manager.user.email);

    const accept = await s.managerClient.post('/organizations/current/ownership-transfer/accept');
    expect(accept.status).toBe(200);
    expect(accept.body.data.activeOrganization.role).toBe('OWNER');

    const roles = await ctx.prisma.organizationMembership.findMany({
      where: { organizationId: s.organization.id },
      select: { userId: true, role: true },
    });
    expect(roles).toEqual(
      expect.arrayContaining([
        { userId: s.manager.user.id, role: 'OWNER' },
        { userId: s.owner.id, role: 'MANAGER' },
      ]),
    );
    // The old owner loses owner permissions on the next request.
    expect((await s.ownerClient.patch('/organizations/current', { name: 'Nope' })).status).toBe(
      403,
    );
  });

  test('requires the owner password', async () => {
    const s = await setup();
    const res = await s.ownerClient.post('/organizations/current/ownership-transfer', {
      toMembershipId: s.manager.membership.id,
      password: 'wrong-password-123',
    });
    expect(res.status).toBe(400);
    expect(await ctx.prisma.ownershipTransfer.count()).toBe(0);
  });

  test('only the target can accept', async () => {
    const s = await setup();
    const analyst = await addMember(ctx.prisma, s.organization.id, 'ANALYST');
    const analystClient = await signIn(ctx.app, analyst.user);
    await s.ownerClient.post('/organizations/current/ownership-transfer', {
      toMembershipId: s.manager.membership.id,
      password: PASSWORD,
    });

    expect(
      (await analystClient.post('/organizations/current/ownership-transfer/accept')).status,
    ).toBe(404);
    expect(
      (await s.ownerClient.post('/organizations/current/ownership-transfer/accept')).status,
    ).toBe(404);
  });

  test('an expired transfer cannot be accepted', async () => {
    const s = await setup();
    await s.ownerClient.post('/organizations/current/ownership-transfer', {
      toMembershipId: s.manager.membership.id,
      password: PASSWORD,
    });
    await ctx.prisma.ownershipTransfer.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await s.managerClient.post('/organizations/current/ownership-transfer/accept');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TRANSFER_EXPIRED');
  });

  test('cannot target a member of another organization', async () => {
    const s = await setup();
    const other = await createOrganization(ctx.prisma);
    const outsider = await addMember(ctx.prisma, other.organization.id, 'MANAGER');

    const res = await s.ownerClient.post('/organizations/current/ownership-transfer', {
      toMembershipId: outsider.membership.id,
      password: PASSWORD,
    });
    expect(res.status).toBe(404);
  });

  test('the owner can cancel a pending transfer', async () => {
    const s = await setup();
    await s.ownerClient.post('/organizations/current/ownership-transfer', {
      toMembershipId: s.manager.membership.id,
      password: PASSWORD,
    });
    expect((await s.ownerClient.delete('/organizations/current/ownership-transfer')).status).toBe(
      204,
    );
    expect(
      (await s.managerClient.post('/organizations/current/ownership-transfer/accept')).status,
    ).toBe(404);
  });
});
