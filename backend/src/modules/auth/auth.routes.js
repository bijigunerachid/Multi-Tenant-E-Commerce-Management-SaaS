import { z } from 'zod';
import { rateLimit } from '../../middleware/rateLimit.js';
import { emailSchema, nameSchema, passwordSchema, tokenSchema } from '../../utils/schemas.js';
import { createAuthService, describeSession } from './auth.service.js';
import { createMfaService } from './mfa.service.js';

const totpCode = z
  .string({ error: 'Enter the 6-digit code' })
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app');
const recoveryCode = z.string().trim().min(10, 'Enter a recovery code').max(20);
const password = z.string({ error: 'Enter your password' }).min(1, 'Enter your password').max(128);
// Weakening two-factor sign-in needs the password and a current code (or a recovery code).
const confirmBody = z.object({
  password,
  code: z.string({ error: 'Enter a code' }).trim().min(6, 'Enter a code').max(20),
});

export function authRoutes(deps) {
  const { prisma, redis } = deps;
  const auth = createAuthService(deps);
  const mfa = createMfaService(deps);
  const byIp = (req) => req.ip;
  const byEmail = (req) =>
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : null;

  const limits = {
    loginIp: rateLimit({ redis, name: 'login-ip', windowSeconds: 900, max: 30, key: byIp }),
    loginEmail: rateLimit({ redis, name: 'login-email', windowSeconds: 900, max: 8, key: byEmail }),
    register: rateLimit({ redis, name: 'register-ip', windowSeconds: 3600, max: 10, key: byIp }),
    resetIp: rateLimit({ redis, name: 'reset-ip', windowSeconds: 900, max: 10, key: byIp }),
    resetEmail: rateLimit({
      redis,
      name: 'reset-email',
      windowSeconds: 3600,
      max: 3,
      key: byEmail,
    }),
    token: rateLimit({ redis, name: 'token-ip', windowSeconds: 900, max: 30, key: byIp }),
    mfaVerify: rateLimit({ redis, name: 'mfa-verify-ip', windowSeconds: 900, max: 30, key: byIp }),
    mfaManage: rateLimit({
      redis,
      name: 'mfa-manage',
      windowSeconds: 900,
      max: 10,
      key: (req) => req.session?.userId ?? req.ip,
    }),
    resend: rateLimit({
      redis,
      name: 'verify-resend',
      windowSeconds: 900,
      max: 3,
      key: (req) => req.session?.userId ?? req.ip,
    }),
  };

  return {
    basePath: '/auth',
    routes: [
      {
        method: 'post',
        path: '/register',
        access: 'public',
        rateLimit: [limits.register],
        validate: {
          body: z.object({ name: nameSchema, email: emailSchema, password: passwordSchema }),
        },
        status: 201,
        handler: (req) => auth.register(req, req.valid.body),
      },
      {
        method: 'post',
        path: '/login',
        access: 'public',
        rateLimit: [limits.loginIp, limits.loginEmail],
        validate: {
          body: z.object({
            email: emailSchema,
            password: z
              .string({ error: 'Enter your password' })
              .min(1, 'Enter your password')
              .max(128),
          }),
        },
        handler: (req) => auth.login(req, req.valid.body),
      },
      {
        method: 'post',
        path: '/mfa/verify',
        // Public: the pending session from the password step is not signed in yet.
        access: 'public',
        rateLimit: [limits.mfaVerify],
        validate: {
          body: z
            .object({ code: totpCode.optional(), recoveryCode: recoveryCode.optional() })
            .refine((b) => Boolean(b.code) !== Boolean(b.recoveryCode), {
              error: 'Enter either a code or a recovery code',
              path: ['code'],
            }),
        },
        handler: (req) => mfa.verifyLogin(req, req.valid.body),
      },
      {
        method: 'get',
        path: '/mfa',
        access: 'authenticated',
        handler: (req) => mfa.status(req),
      },
      {
        method: 'post',
        path: '/mfa/setup',
        access: 'authenticated',
        rateLimit: [limits.mfaManage],
        validate: { body: z.object({ password }) },
        handler: (req) => mfa.setup(req, req.valid.body),
      },
      {
        method: 'post',
        path: '/mfa/enable',
        access: 'authenticated',
        rateLimit: [limits.mfaManage],
        validate: { body: z.object({ code: totpCode }) },
        handler: (req) => mfa.enable(req, req.valid.body),
      },
      {
        method: 'post',
        path: '/mfa/disable',
        access: 'authenticated',
        rateLimit: [limits.mfaManage],
        validate: { body: confirmBody },
        handler: (req) => mfa.disable(req, req.valid.body),
      },
      {
        method: 'post',
        path: '/mfa/recovery-codes',
        access: 'authenticated',
        rateLimit: [limits.mfaManage],
        validate: { body: confirmBody },
        handler: (req) => mfa.regenerateRecoveryCodes(req, req.valid.body),
      },
      {
        method: 'post',
        path: '/logout',
        access: 'public',
        handler: (req) => auth.logout(req),
      },
      {
        method: 'post',
        path: '/logout-all',
        access: 'authenticated',
        handler: (req) => auth.logoutEverywhere(req),
      },
      {
        method: 'get',
        path: '/me',
        access: 'authenticated',
        handler: (req) => describeSession(prisma, req),
      },
      {
        method: 'patch',
        path: '/me',
        access: 'authenticated',
        validate: { body: z.object({ name: nameSchema }) },
        handler: (req) => auth.updateProfile(req, req.valid.body),
      },
      {
        method: 'post',
        path: '/password/change',
        access: 'authenticated',
        rateLimit: [limits.loginIp],
        validate: {
          body: z.object({
            currentPassword: z.string().min(1, 'Enter your current password').max(128),
            newPassword: passwordSchema,
          }),
        },
        handler: (req) => auth.changePassword(req, req.valid.body),
      },
      {
        method: 'post',
        path: '/email/verify',
        access: 'public',
        rateLimit: [limits.token],
        validate: { body: z.object({ token: tokenSchema }) },
        handler: (req) => auth.verifyEmail(req, req.valid.body),
      },
      {
        method: 'post',
        path: '/email/resend',
        access: 'authenticated',
        rateLimit: [limits.resend],
        status: 202,
        handler: async (req) => {
          await auth.resendVerification(req);
          return { sent: true };
        },
      },
      {
        method: 'post',
        path: '/password/forgot',
        access: 'public',
        rateLimit: [limits.resetIp, limits.resetEmail],
        validate: { body: z.object({ email: emailSchema }) },
        status: 202,
        handler: async (req) => {
          await auth.requestPasswordReset(req, req.valid.body);
          return { sent: true };
        },
      },
      {
        method: 'post',
        path: '/password/reset',
        access: 'public',
        rateLimit: [limits.token],
        validate: { body: z.object({ token: tokenSchema, password: passwordSchema }) },
        handler: (req) => auth.resetPassword(req, req.valid.body),
      },
    ],
  };
}
