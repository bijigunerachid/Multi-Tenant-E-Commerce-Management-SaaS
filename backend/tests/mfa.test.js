import { jest } from '@jest/globals';
import { createTestApp, resetState } from './helpers/testApp.js';
import { apiClient } from './helpers/client.js';
import { PASSWORD, createUser, enableMfa, signIn, signInWithMfa } from './helpers/factories.js';
import { totp } from '../src/utils/totp.js';
import { RECOVERY_CODE_COUNT, consumeTotpCode } from '../src/modules/auth/mfa.service.js';
import { createSecretBox } from '../src/utils/secretBox.js';

let ctx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => resetState(ctx));
afterEach(() => jest.restoreAllMocks());

const login = (client, user) =>
  client.post('/auth/login', { email: user.email, password: PASSWORD });
const userRow = (user) => ctx.prisma.user.findUnique({ where: { id: user.id } });

describe('turning it on', () => {
  test('needs the password, then a code from the app; gives recovery codes once', async () => {
    const user = await createUser(ctx.prisma);
    const client = await signIn(ctx.app, user);
    const other = await signIn(ctx.app, user); // e.g. a laptop left signed in

    expect((await client.post('/auth/mfa/setup', { password: 'wrong-password' })).status).toBe(400);
    const setup = await client.post('/auth/mfa/setup', { password: PASSWORD });
    expect(setup.status).toBe(200);
    const { secret, otpauthUrl } = setup.body.data;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUrl).toContain(`secret=${secret}`);
    // Not on until a code confirms it.
    expect((await userRow(user)).mfaEnabledAt).toBeNull();

    expect((await client.post('/auth/mfa/enable', { code: '000000' })).status).toBe(400);
    const enabled = await client.post('/auth/mfa/enable', { code: totp(secret) });
    expect(enabled.status).toBe(200);
    const codes = enabled.body.data.recoveryCodes;
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);

    // At rest: the secret is encrypted, recovery codes are hashes.
    const row = await userRow(user);
    expect(row.mfaEnabledAt).toBeInstanceOf(Date);
    expect(row.mfaSecret).not.toContain(secret);
    expect(row.mfaPendingSecret).toBeNull();
    const stored = await ctx.prisma.mfaRecoveryCode.findMany({ where: { userId: user.id } });
    expect(stored.map((c) => c.codeHash).join()).not.toContain(codes[0].replace('-', ''));

    // This session continues; the one opened with the password alone does not.
    expect((await client.get('/auth/me')).status).toBe(200);
    expect((await other.get('/auth/me')).status).toBe(401);
    expect((await client.get('/auth/mfa')).body.data).toMatchObject({
      enabled: true,
      recoveryCodesLeft: RECOVERY_CODE_COUNT,
    });
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'auth.mfa_enabled', entityId: user.id } }),
    ).toBe(1);
  });
});

describe('signing in', () => {
  test('the password alone opens nothing; the code completes the sign-in', async () => {
    const user = await createUser(ctx.prisma);
    const secret = await enableMfa(ctx.prisma, user);
    const client = apiClient(ctx.app);

    const first = await login(client, user);
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ mfaRequired: true, csrfToken: expect.any(String) });
    expect((await client.get('/auth/me')).status).toBe(401);
    expect((await client.get('/organizations')).status).toBe(401);

    const wrong = await client.post('/auth/mfa/verify', { code: '123456' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details.fieldErrors.code).toBeDefined();

    const ok = await client.post('/auth/mfa/verify', { code: totp(secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user).toMatchObject({ email: user.email, mfaEnabled: true });
    expect((await client.get('/auth/me')).status).toBe(200);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'auth.login', entityId: user.id },
    });
    expect(audit.metadata).toEqual({ secondFactor: 'authenticator' });
  });

  test('a code works once, even for two sign-ins in the same 30 seconds', async () => {
    const user = await createUser(ctx.prisma);
    const secret = await enableMfa(ctx.prisma, user);
    const code = totp(secret);
    const a = apiClient(ctx.app);
    const b = apiClient(ctx.app);
    await login(a, user);
    await login(b, user);
    const results = await Promise.all([
      a.post('/auth/mfa/verify', { code }),
      b.post('/auth/mfa/verify', { code }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  test('two requests racing with the same code: the database lets only one through', async () => {
    const user = await createUser(ctx.prisma);
    const secret = await enableMfa(ctx.prisma, user);
    // Both requests read the user before either wrote: the same stale row for each.
    const stale = await userRow(user);
    const box = createSecretBox(ctx.env.MFA_ENCRYPTION_KEY);
    const code = totp(secret);
    const first = await consumeTotpCode({ prisma: ctx.prisma, box }, stale, code);
    const second = await consumeTotpCode({ prisma: ctx.prisma, box }, stale, code);
    expect([first, second]).toEqual([true, false]);
  });

  test('5 wrong codes end the attempt, and the step expires after 5 minutes', async () => {
    const user = await createUser(ctx.prisma);
    const secret = await enableMfa(ctx.prisma, user);
    const client = apiClient(ctx.app);
    await login(client, user);
    for (let i = 0; i < 4; i += 1) {
      expect((await client.post('/auth/mfa/verify', { code: '000000' })).status).toBe(400);
    }
    const fifth = await client.post('/auth/mfa/verify', { code: '000000' });
    expect(fifth.status).toBe(401);
    expect(fifth.body.error.code).toBe('MFA_TOO_MANY_ATTEMPTS');
    // The pending session is gone: even the right code needs a new sign-in now.
    const after = await client.post('/auth/mfa/verify', { code: totp(secret) });
    expect(after.status).toBe(401);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.mfa_failed' } })).toBe(5);

    const late = apiClient(ctx.app);
    await login(late, user);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 6 * 60 * 1000);
    const expired = await late.post('/auth/mfa/verify', {
      code: totp(secret, now + 6 * 60 * 1000),
    });
    expect(expired.body.error.code).toBe('MFA_SESSION_EXPIRED');
  });

  test('a recovery code signs in once', async () => {
    const user = await createUser(ctx.prisma);
    const client = await signIn(ctx.app, user);
    const { secret } = (await client.post('/auth/mfa/setup', { password: PASSWORD })).body.data;
    const { recoveryCodes } = (await client.post('/auth/mfa/enable', { code: totp(secret) })).body
      .data;

    const lost = apiClient(ctx.app);
    await login(lost, user);
    // Typed with capitals and spaces: still accepted.
    const ok = await lost.post('/auth/mfa/verify', {
      recoveryCode: ` ${recoveryCodes[0].toUpperCase()} `,
    });
    expect(ok.status).toBe(200);

    const again = apiClient(ctx.app);
    await login(again, user);
    expect((await again.post('/auth/mfa/verify', { recoveryCode: recoveryCodes[0] })).status).toBe(
      400,
    );
    expect((await lost.get('/auth/mfa')).body.data.recoveryCodesLeft).toBe(RECOVERY_CODE_COUNT - 1);
  });

  test('a disabled account cannot finish signing in', async () => {
    const user = await createUser(ctx.prisma);
    const secret = await enableMfa(ctx.prisma, user);
    const client = apiClient(ctx.app);
    await login(client, user);
    await ctx.prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
    expect((await client.post('/auth/mfa/verify', { code: totp(secret) })).status).toBe(401);
  });
});

describe('turning it off and new recovery codes', () => {
  test('need the password and a current code', async () => {
    const user = await createUser(ctx.prisma);
    const secret = await enableMfa(ctx.prisma, user);
    const client = await signInWithMfa(ctx.app, user, secret);

    const codes = await client.post('/auth/mfa/recovery-codes', {
      password: 'wrong-password',
      code: '000000',
    });
    expect(codes.status).toBe(400);
    expect(codes.body.error.details.fieldErrors.password).toBeDefined();

    // The sign-in code was used a moment ago: wait for the next step.
    const next = Date.now() + 30_000;
    jest.spyOn(Date, 'now').mockReturnValue(next);
    const fresh = await client.post('/auth/mfa/recovery-codes', {
      password: PASSWORD,
      code: totp(secret, next),
    });
    expect(fresh.status).toBe(200);
    expect(fresh.body.data.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);

    const off = await client.post('/auth/mfa/disable', {
      password: PASSWORD,
      code: fresh.body.data.recoveryCodes[0],
    });
    expect(off.status).toBe(204);
    const row = await userRow(user);
    expect(row).toMatchObject({ mfaSecret: null, mfaEnabledAt: null });
    expect(await ctx.prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    // The password alone signs in again.
    jest.restoreAllMocks();
    const plain = apiClient(ctx.app);
    expect((await login(plain, user)).body.data.mfaRequired).toBeUndefined();
  });
});

describe('platform administrators', () => {
  test('cannot use the admin area until two-factor sign-in is on and used', async () => {
    const admin = await createUser(ctx.prisma, { platformRole: 'SUPER_ADMIN' });
    const client = await signIn(ctx.app, admin);
    const refused = await client.get('/admin/stats');
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatchObject({
      code: 'MFA_REQUIRED',
      message: expect.stringContaining('Turn on two-factor sign-in'),
    });

    const { secret } = (await client.post('/auth/mfa/setup', { password: PASSWORD })).body.data;
    await client.post('/auth/mfa/enable', { code: totp(secret) });
    expect((await client.get('/admin/stats')).status).toBe(200);
  });
});
