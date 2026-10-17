import { createTestApp, resetState } from './helpers/testApp.js';
import { apiClient } from './helpers/client.js';
import {
  addMember,
  createOrganization,
  createUser,
  lastEmailTo,
  signIn,
} from './helpers/factories.js';

let ctx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => resetState(ctx));

async function setup() {
  const org = await createOrganization(ctx.prisma, { name: 'Sahara Supply' });
  return { ...org, ownerClient: await signIn(ctx.app, org.owner) };
}

describe('member management', () => {
  test('lists members with their roles', async () => {
    const s = await setup();
    await addMember(ctx.prisma, s.organization.id, 'ANALYST');

    const res = await s.ownerClient.get('/members');
    expect(res.status).toBe(200);
    expect(res.body.data.map((m) => m.role).sort()).toEqual(['ANALYST', 'OWNER']);
    expect(res.body.data[0]).not.toHaveProperty('passwordHash');
  });

  test('the owner changes a role, and the change is audited', async () => {
    const s = await setup();
    const { membership } = await addMember(ctx.prisma, s.organization.id, 'ANALYST');

    const res = await s.ownerClient.patch(`/members/${membership.id}`, { role: 'ORDER_MANAGER' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('ORDER_MANAGER');
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'member.role_changed' } });
    expect(audit.metadata).toEqual({ from: 'ANALYST', to: 'ORDER_MANAGER' });
  });

  test('OWNER cannot be granted directly', async () => {
    const s = await setup();
    const { membership } = await addMember(ctx.prisma, s.organization.id, 'MANAGER');

    const res = await s.ownerClient.patch(`/members/${membership.id}`, { role: 'OWNER' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.role).toBeDefined();
  });

  test('the owner cannot demote or deactivate themselves (the organization keeps its owner)', async () => {
    const s = await setup();
    const demote = await s.ownerClient.patch(`/members/${s.ownerMembership.id}`, {
      role: 'MANAGER',
    });
    expect(demote.status).toBe(403);
    expect(demote.body.error.code).toBe('CANNOT_CHANGE_SELF');

    const deactivate = await s.ownerClient.post(`/members/${s.ownerMembership.id}/deactivate`);
    expect(deactivate.status).toBe(403);

    const owners = await ctx.prisma.organizationMembership.count({
      where: { organizationId: s.organization.id, role: 'OWNER', status: 'ACTIVE' },
    });
    expect(owners).toBe(1);
  });

  test('a manager cannot change roles (no member:manage)', async () => {
    const s = await setup();
    const manager = await addMember(ctx.prisma, s.organization.id, 'MANAGER');
    const analyst = await addMember(ctx.prisma, s.organization.id, 'ANALYST');
    const client = await signIn(ctx.app, manager.user);

    const res = await client.patch(`/members/${analyst.membership.id}`, { role: 'MANAGER' });
    expect(res.status).toBe(403);
    // Not even their own role.
    expect(
      (await client.patch(`/members/${manager.membership.id}`, { role: 'ANALYST' })).status,
    ).toBe(403);
  });

  test("deactivation takes effect on the member's next request; reactivation restores access", async () => {
    const s = await setup();
    const analyst = await addMember(ctx.prisma, s.organization.id, 'ANALYST');
    const analystClient = await signIn(ctx.app, analyst.user);
    expect((await analystClient.get('/organizations/current')).status).toBe(200);

    expect((await s.ownerClient.post(`/members/${analyst.membership.id}/deactivate`)).status).toBe(
      200,
    );
    const blocked = await analystClient.get('/organizations/current');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ORGANIZATION_ACCESS_REVOKED');

    expect((await s.ownerClient.post(`/members/${analyst.membership.id}/reactivate`)).status).toBe(
      200,
    );
    expect((await analystClient.post(`/organizations/${s.organization.id}/switch`)).status).toBe(
      200,
    );
    expect((await analystClient.get('/organizations/current')).status).toBe(200);
  });
});

describe('invitations', () => {
  test('owner invites; a new person accepts by creating an account and lands in the organization', async () => {
    const s = await setup();
    const invite = await s.ownerClient.post('/members/invitations', {
      email: 'New.Hire@Example.com',
      role: 'INVENTORY_MANAGER',
    });
    expect(invite.status).toBe(201);
    expect(invite.body.data).toMatchObject({
      email: 'new.hire@example.com',
      role: 'INVENTORY_MANAGER',
    });

    const email = lastEmailTo(ctx.mailer, 'new.hire@example.com');
    expect(email.subject).toBe('You are invited to join Sahara Supply on Vendora');
    expect(email.text).toContain('as Inventory manager');

    const invitee = apiClient(ctx.app);
    const preview = await invitee.post('/invitations/preview', { token: email.token });
    expect(preview.body.data).toMatchObject({
      organizationName: 'Sahara Supply',
      email: 'new.hire@example.com',
      role: 'INVENTORY_MANAGER',
      accountExists: false,
    });

    const missingFields = await invitee.post('/invitations/accept', { token: email.token });
    expect(missingFields.status).toBe(400);

    const accept = await invitee.post('/invitations/accept', {
      token: email.token,
      name: 'New Hire',
      password: 'a-long-enough-password',
    });
    expect(accept.status).toBe(200);
    expect(accept.body.data.user.emailVerified).toBe(true);
    expect(accept.body.data.activeOrganization).toMatchObject({
      id: s.organization.id,
      role: 'INVENTORY_MANAGER',
    });

    // Single use.
    const reuse = await apiClient(ctx.app).post('/invitations/accept', {
      token: email.token,
      name: 'Someone Else',
      password: 'a-long-enough-password',
    });
    expect(reuse.status).toBe(410);
  });

  test('an existing user must sign in as the invited email to accept', async () => {
    const s = await setup();
    const existing = await createUser(ctx.prisma, { email: 'existing@example.com' });
    const stranger = await createUser(ctx.prisma);
    await s.ownerClient.post('/members/invitations', { email: existing.email, role: 'ANALYST' });
    const { token } = lastEmailTo(ctx.mailer, existing.email);

    const anonymous = await apiClient(ctx.app).post('/invitations/accept', { token });
    expect(anonymous.status).toBe(409);
    expect(anonymous.body.error.code).toBe('LOGIN_REQUIRED');

    const wrongAccount = await (
      await signIn(ctx.app, stranger)
    ).post('/invitations/accept', { token });
    expect(wrongAccount.status).toBe(403);
    expect(wrongAccount.body.error.code).toBe('INVITATION_EMAIL_MISMATCH');

    const rightAccount = await (
      await signIn(ctx.app, existing)
    ).post('/invitations/accept', { token });
    expect(rightAccount.status).toBe(200);
    expect(rightAccount.body.data.activeOrganization.role).toBe('ANALYST');
  });

  test('one pending invitation per email; existing members cannot be invited', async () => {
    const s = await setup();
    await s.ownerClient.post('/members/invitations', { email: 'dup@example.com', role: 'ANALYST' });
    const dup = await s.ownerClient.post('/members/invitations', {
      email: 'DUP@example.com',
      role: 'MANAGER',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('INVITATION_PENDING');

    const member = await s.ownerClient.post('/members/invitations', {
      email: s.owner.email,
      role: 'ANALYST',
    });
    expect(member.status).toBe(409);
    expect(member.body.error.code).toBe('ALREADY_MEMBER');
  });

  test('an expired invitation cannot be accepted but no longer blocks a new one', async () => {
    const s = await setup();
    await s.ownerClient.post('/members/invitations', {
      email: 'late@example.com',
      role: 'ANALYST',
    });
    const { token } = lastEmailTo(ctx.mailer, 'late@example.com');
    await ctx.prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const accept = await apiClient(ctx.app).post('/invitations/accept', {
      token,
      name: 'Late',
      password: 'a-long-enough-password',
    });
    expect(accept.status).toBe(410);

    expect(
      (
        await s.ownerClient.post('/members/invitations', {
          email: 'late@example.com',
          role: 'ANALYST',
        })
      ).status,
    ).toBe(201);
  });

  test('a revoked invitation cannot be accepted', async () => {
    const s = await setup();
    const invite = await s.ownerClient.post('/members/invitations', {
      email: 'gone@example.com',
      role: 'ANALYST',
    });
    const { token } = lastEmailTo(ctx.mailer, 'gone@example.com');

    expect((await s.ownerClient.delete(`/members/invitations/${invite.body.data.id}`)).status).toBe(
      204,
    );
    expect((await s.ownerClient.get('/members/invitations')).body.data).toEqual([]);

    const accept = await apiClient(ctx.app).post('/invitations/accept', {
      token,
      name: 'Gone',
      password: 'a-long-enough-password',
    });
    expect(accept.status).toBe(410);
  });

  test('cannot invite as OWNER', async () => {
    const s = await setup();
    const res = await s.ownerClient.post('/members/invitations', {
      email: 'boss@example.com',
      role: 'OWNER',
    });
    expect(res.status).toBe(400);
  });

  test('two concurrent accepts of the same invitation: exactly one succeeds', async () => {
    const s = await setup();
    await s.ownerClient.post('/members/invitations', {
      email: 'race@example.com',
      role: 'ANALYST',
    });
    const { token } = lastEmailTo(ctx.mailer, 'race@example.com');

    const results = await Promise.all(
      [1, 2].map(() =>
        apiClient(ctx.app).post('/invitations/accept', {
          token,
          name: 'Racer',
          password: 'a-long-enough-password',
        }),
      ),
    );
    // The loser must get a clean "already used" answer, not a database error.
    expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(await ctx.prisma.user.count({ where: { email: 'race@example.com' } })).toBe(1);
  });
});
