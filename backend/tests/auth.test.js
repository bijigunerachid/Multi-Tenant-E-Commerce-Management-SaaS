import { createTestApp, resetState } from './helpers/testApp.js';
import { apiClient } from './helpers/client.js';
import {
  PASSWORD,
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

const sessionCookie = (res) =>
  (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('vendora_session='));

describe('registration', () => {
  test('creates an account, signs in, and sends a verification email', async () => {
    const client = apiClient(ctx.app);
    const res = await client.post('/auth/register', {
      name: 'Amina Haddad',
      email: '  Amina@Example.COM ',
      password: 'a-long-enough-password',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({
      email: 'amina@example.com',
      name: 'Amina Haddad',
      emailVerified: false,
    });
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.organizations).toEqual([]);
    expect(res.body.data.activeOrganization).toBeNull();

    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const stored = await ctx.prisma.user.findUnique({ where: { email: 'amina@example.com' } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);

    const email = lastEmailTo(ctx.mailer, 'amina@example.com');
    expect(email.subject).toBe('Confirm your email address');
    expect(email.token).toBeTruthy();

    expect((await client.get('/auth/me')).status).toBe(200);
  });

  test('rejects weak or common passwords and invalid emails with field errors', async () => {
    const client = apiClient(ctx.app);
    const res = await client.post('/auth/register', {
      name: '',
      email: 'not-an-email',
      password: 'short',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body.error.details.fieldErrors).sort()).toEqual([
      'email',
      'name',
      'password',
    ]);

    const common = await client.post('/auth/register', {
      name: 'A',
      email: 'a@example.com',
      password: 'password123',
    });
    expect(common.body.error.details.fieldErrors.password).toMatch(/too common/);
  });

  test('rejects a duplicate email regardless of case', async () => {
    await createUser(ctx.prisma, { email: 'taken@example.com' });
    const res = await apiClient(ctx.app).post('/auth/register', {
      name: 'Someone',
      email: 'TAKEN@example.com',
      password: 'a-long-enough-password',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });
});

describe('login and logout', () => {
  test('signs in with the right password and issues a new session id each time', async () => {
    const user = await createUser(ctx.prisma);
    const first = await apiClient(ctx.app).post('/auth/login', {
      email: user.email,
      password: PASSWORD,
    });
    const second = await apiClient(ctx.app).post('/auth/login', {
      email: user.email,
      password: PASSWORD,
    });

    expect(first.status).toBe(200);
    expect(first.body.data.csrfToken).toEqual(expect.any(String));
    expect(sessionCookie(first)).not.toEqual(sessionCookie(second));
  });

  test('gives the same answer for an unknown email and a wrong password', async () => {
    const user = await createUser(ctx.prisma);
    const wrongPassword = await apiClient(ctx.app).post('/auth/login', {
      email: user.email,
      password: 'wrong-password-123',
    });
    const unknownEmail = await apiClient(ctx.app).post('/auth/login', {
      email: 'nobody@example.com',
      password: 'wrong-password-123',
    });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }
    const failures = await ctx.prisma.auditLog.count({ where: { action: 'auth.login_failed' } });
    expect(failures).toBe(2);
  });

  test('a disabled account cannot sign in, and its existing sessions stop working', async () => {
    const user = await createUser(ctx.prisma);
    const client = await signIn(ctx.app, user);
    await ctx.prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });

    expect((await client.get('/auth/me')).status).toBe(401);
    const login = await apiClient(ctx.app).post('/auth/login', {
      email: user.email,
      password: PASSWORD,
    });
    expect(login.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('restores the last active organization at login', async () => {
    const user = await createUser(ctx.prisma);
    const { organization } = await createOrganization(ctx.prisma, { owner: user });
    const second = await createOrganization(ctx.prisma, { owner: user });
    await ctx.prisma.user.update({
      where: { id: user.id },
      data: { lastActiveOrganizationId: second.organization.id },
    });

    const client = await signIn(ctx.app, user);
    const me = await client.get('/auth/me');
    expect(me.body.data.activeOrganization.id).toBe(second.organization.id);
    expect(me.body.data.organizations.map((o) => o.id).sort()).toEqual(
      [organization.id, second.organization.id].sort(),
    );
  });

  test('logout destroys the server-side session', async () => {
    const user = await createUser(ctx.prisma);
    const client = await signIn(ctx.app, user);

    expect((await client.post('/auth/logout')).status).toBe(204);
    expect((await client.get('/auth/me')).status).toBe(401);
  });

  test('"log out everywhere" ends every session of the user', async () => {
    const user = await createUser(ctx.prisma);
    const laptop = await signIn(ctx.app, user);
    const phone = await signIn(ctx.app, user);

    expect((await laptop.post('/auth/logout-all')).status).toBe(204);
    expect((await laptop.get('/auth/me')).status).toBe(401);
    expect((await phone.get('/auth/me')).status).toBe(401);
  });

  test('login is rate limited per email address', async () => {
    const user = await createUser(ctx.prisma);
    const client = apiClient(ctx.app);
    for (let i = 0; i < 8; i += 1) {
      await client.post('/auth/login', { email: user.email, password: 'wrong-password-123' });
    }
    const blocked = await client.post('/auth/login', { email: user.email, password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('CSRF protection', () => {
  test('a signed-in write without the CSRF token is rejected', async () => {
    const user = await createUser(ctx.prisma);
    const client = await signIn(ctx.app, user);

    const res = await client.patch('/auth/me', { name: 'New name' }, { csrf: false });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');

    const forged = await client.agent
      .patch('/api/v1/auth/me')
      .set('X-CSRF-Token', 'guessed-token-value-that-is-wrong')
      .send({ name: 'New name' });
    expect(forged.status).toBe(403);

    expect((await client.patch('/auth/me', { name: 'New name' })).status).toBe(200);
  });

  test('requests from a foreign origin are rejected, even on public endpoints (login CSRF)', async () => {
    const user = await createUser(ctx.prisma);
    const res = await apiClient(ctx.app).post(
      '/auth/login',
      { email: user.email, password: PASSWORD },
      { origin: 'https://evil.example' },
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN_REJECTED');
  });

  test('reads do not need a token', async () => {
    const user = await createUser(ctx.prisma);
    const client = await signIn(ctx.app, user);
    expect((await client.get('/auth/me', { csrf: false })).status).toBe(200);
  });
});

describe('email verification', () => {
  test('a valid token verifies the email once', async () => {
    const client = apiClient(ctx.app);
    await client.post('/auth/register', {
      name: 'Y',
      email: 'y@example.com',
      password: 'a-long-enough-password',
    });
    const { token } = lastEmailTo(ctx.mailer, 'y@example.com');

    expect((await client.post('/auth/email/verify', { token })).status).toBe(204);
    expect((await client.get('/auth/me')).body.data.user.emailVerified).toBe(true);

    const reused = await client.post('/auth/email/verify', { token });
    expect(reused.status).toBe(400);
    expect(reused.body.error.code).toBe('TOKEN_INVALID');
  });

  test('resending invalidates the previous link', async () => {
    const client = apiClient(ctx.app);
    await client.post('/auth/register', {
      name: 'Z',
      email: 'z@example.com',
      password: 'a-long-enough-password',
    });
    const first = lastEmailTo(ctx.mailer, 'z@example.com').token;

    expect((await client.post('/auth/email/resend')).status).toBe(202);
    const second = lastEmailTo(ctx.mailer, 'z@example.com').token;

    expect((await client.post('/auth/email/verify', { token: first })).status).toBe(400);
    expect((await client.post('/auth/email/verify', { token: second })).status).toBe(204);
  });

  test('an expired token is rejected', async () => {
    const client = apiClient(ctx.app);
    await client.post('/auth/register', {
      name: 'E',
      email: 'e@example.com',
      password: 'a-long-enough-password',
    });
    const { token } = lastEmailTo(ctx.mailer, 'e@example.com');
    await ctx.prisma.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await client.post('/auth/email/verify', { token })).status).toBe(400);
  });
});

describe('password reset', () => {
  test('answers the same way for known and unknown emails', async () => {
    const user = await createUser(ctx.prisma);
    const known = await apiClient(ctx.app).post('/auth/password/forgot', { email: user.email });
    const unknown = await apiClient(ctx.app).post('/auth/password/forgot', {
      email: 'ghost@example.com',
    });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(ctx.mailer.sent.map((m) => m.to)).toEqual([user.email]);
  });

  test('resets the password once and signs out every session', async () => {
    const user = await createUser(ctx.prisma);
    const existing = await signIn(ctx.app, user);
    await apiClient(ctx.app).post('/auth/password/forgot', { email: user.email });
    const { token } = lastEmailTo(ctx.mailer, user.email);

    const reset = await apiClient(ctx.app).post('/auth/password/reset', {
      token,
      password: 'brand-new-password-1',
    });
    expect(reset.status).toBe(204);
    expect((await existing.get('/auth/me')).status).toBe(401);

    const again = await apiClient(ctx.app).post('/auth/password/reset', {
      token,
      password: 'another-password-22',
    });
    expect(again.status).toBe(400);

    const oldLogin = await apiClient(ctx.app).post('/auth/login', {
      email: user.email,
      password: PASSWORD,
    });
    expect(oldLogin.status).toBe(401);
    await signIn(ctx.app, user, 'brand-new-password-1');
  });

  test('a verification token cannot be used as a reset token', async () => {
    const client = apiClient(ctx.app);
    await client.post('/auth/register', {
      name: 'V',
      email: 'v@example.com',
      password: 'a-long-enough-password',
    });
    const { token } = lastEmailTo(ctx.mailer, 'v@example.com');

    const res = await apiClient(ctx.app).post('/auth/password/reset', {
      token,
      password: 'brand-new-password-1',
    });
    expect(res.status).toBe(400);
  });
});

describe('profile and password change', () => {
  test('changing the password keeps the current session and ends the others', async () => {
    const user = await createUser(ctx.prisma);
    const current = await signIn(ctx.app, user);
    const other = await signIn(ctx.app, user);

    const wrong = await current.post('/auth/password/change', {
      currentPassword: 'not-my-password',
      newPassword: 'brand-new-password-1',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details.fieldErrors.currentPassword).toBeDefined();

    const ok = await current.post('/auth/password/change', {
      currentPassword: PASSWORD,
      newPassword: 'brand-new-password-1',
    });
    expect(ok.status).toBe(204);
    expect((await current.get('/auth/me')).status).toBe(200);
    expect((await other.get('/auth/me')).status).toBe(401);
  });

  test('updates the display name', async () => {
    const user = await createUser(ctx.prisma);
    const client = await signIn(ctx.app, user);
    const res = await client.patch('/auth/me', { name: '  Yasmine B.  ' });
    expect(res.body.data.user.name).toBe('Yasmine B.');
  });
});
