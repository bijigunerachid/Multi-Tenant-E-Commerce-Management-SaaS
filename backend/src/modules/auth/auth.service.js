import { conflict, AppError, unauthorized, isUniqueViolation } from '../../utils/errors.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../utils/passwords.js';
import { recordAudit } from '../../utils/audit.js';
import { passwordResetMessage, verifyEmailMessage } from '../../services/emails.js';
import { subscriptionContext } from '../billing/subscription.js';
import { permissionsFor } from './permissions.js';

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: Boolean(user.emailVerifiedAt),
    platformRole: user.platformRole,
  };
}

/**
 * Picks the organization a user lands in: the preferred one if they still have active access
 * to it, otherwise their oldest active membership in an active organization, otherwise none.
 */
export async function pickActiveOrganizationId(prisma, userId, preferredId) {
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
    select: { organizationId: true },
    orderBy: { createdAt: 'asc' },
  });
  const ids = memberships.map((m) => m.organizationId);
  if (preferredId && ids.includes(preferredId)) return preferredId;
  return ids[0] ?? null;
}

/** The session payload the web app needs: who am I, where can I go, what can I do here. */
export async function describeSession(prisma, req) {
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: req.user.id, status: 'ACTIVE' },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          defaultCurrency: true,
          subscription: { include: { plan: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  let active = memberships.find(
    (m) =>
      m.organizationId === req.session.activeOrganizationId && m.organization.status === 'ACTIVE',
  );
  if (!active && req.session.activeOrganizationId) {
    await req.updateSession({ activeOrganizationId: null });
  }

  return {
    user: publicUser(req.user),
    organizations: memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      status: m.organization.status,
      role: m.role,
    })),
    activeOrganization: active
      ? {
          id: active.organization.id,
          name: active.organization.name,
          slug: active.organization.slug,
          role: active.role,
          defaultCurrency: active.organization.defaultCurrency,
          membershipId: active.id,
          permissions: permissionsFor(active.role),
          // Every member sees whether the organization is read-only; details are in Billing.
          subscription: (({ status, usable, planName, trialEndsAt }) => ({
            status,
            usable,
            planName,
            trialEndsAt,
          }))(subscriptionContext(active.organization.subscription)),
        }
      : null,
    csrfToken: req.session.csrfToken,
  };
}

async function issueToken(db, userId, purpose, ttlMs) {
  // Only the newest token of each purpose is valid.
  await db.authToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });
  const token = randomToken();
  await db.authToken.create({
    data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return token;
}

/**
 * Marks a token used and returns its user id, or throws. The conditional update makes
 * consumption atomic: two concurrent requests with the same token cannot both succeed.
 */
async function consumeToken(db, token, purpose) {
  const record = await db.authToken.findUnique({ where: { tokenHash: sha256(token) } });
  const invalid = new AppError(400, 'TOKEN_INVALID', 'This link is invalid or has expired');
  if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt < new Date()) {
    throw invalid;
  }
  const { count } = await db.authToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (count !== 1) throw invalid;
  return record.userId;
}

export function createAuthService({ prisma, sessionStore, emails, env }) {
  async function sendVerificationEmail(user) {
    const token = await issueToken(prisma, user.id, 'EMAIL_VERIFY', EMAIL_VERIFY_TTL_MS);
    await emails.enqueue({
      kind: 'auth.verify_email',
      to: user.email,
      message: verifyEmailMessage({ appUrl: env.APP_URL, name: user.name, token }),
    });
  }

  return {
    async register(req, { name, email, password }) {
      const passwordHash = await hashPassword(password);
      let user;
      try {
        user = await prisma.user.create({ data: { name, email, passwordHash } });
      } catch (err) {
        if (isUniqueViolation(err, 'email')) {
          throw conflict('EMAIL_TAKEN', 'An account with this email already exists', {
            fieldErrors: { email: 'An account with this email already exists' },
          });
        }
        throw err;
      }
      req.user = user;
      await recordAudit(prisma, req, {
        action: 'auth.registered',
        entityType: 'User',
        entityId: user.id,
      });
      await sendVerificationEmail(user);
      await req.startSession({ userId: user.id, activeOrganizationId: null });
      return describeSession(prisma, req);
    },

    async login(req, { email, password }) {
      const user = await prisma.user.findUnique({ where: { email } });
      const valid = user
        ? await verifyPassword(user.passwordHash, password)
        : await verifyAgainstDummy(password);

      if (!user || !valid || user.status !== 'ACTIVE') {
        await recordAudit(prisma, req, {
          action: 'auth.login_failed',
          entityType: 'User',
          entityId: user?.id,
          metadata: { reason: !user ? 'unknown_email' : !valid ? 'wrong_password' : 'disabled' },
        });
        // One message for every failure, so the response does not reveal which accounts exist.
        throw unauthorized('INVALID_CREDENTIALS', 'Email or password is incorrect');
      }

      req.user = user;
      const activeOrganizationId = await pickActiveOrganizationId(
        prisma,
        user.id,
        user.lastActiveOrganizationId,
      );
      await req.startSession({ userId: user.id, activeOrganizationId });
      await recordAudit(prisma, req, {
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
      });
      return describeSession(prisma, req);
    },

    async logout(req) {
      if (req.session) {
        const userId = req.session.userId;
        await recordAudit(prisma, req, {
          action: 'auth.logout',
          entityType: 'User',
          entityId: userId,
          actorUserId: userId,
        });
      }
      await req.endSession();
    },

    async logoutEverywhere(req) {
      await sessionStore.destroyAllForUser(req.user.id);
      await recordAudit(prisma, req, {
        action: 'auth.logout_all',
        entityType: 'User',
        entityId: req.user.id,
      });
      await req.endSession();
    },

    async updateProfile(req, { name }) {
      req.user = await prisma.user.update({ where: { id: req.user.id }, data: { name } });
      return describeSession(prisma, req);
    },

    async changePassword(req, { currentPassword, newPassword }) {
      if (!(await verifyPassword(req.user.passwordHash, currentPassword))) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid', {
          fieldErrors: { currentPassword: 'Your current password is incorrect' },
        });
      }
      await prisma.user.update({
        where: { id: req.user.id },
        data: { passwordHash: await hashPassword(newPassword) },
      });
      // Anyone else holding a session (for example on a stolen laptop) is signed out.
      await sessionStore.destroyAllForUser(req.user.id, { exceptId: req.sessionId });
      await recordAudit(prisma, req, {
        action: 'auth.password_changed',
        entityType: 'User',
        entityId: req.user.id,
      });
    },

    async verifyEmail(req, { token }) {
      const userId = await prisma.$transaction(async (tx) => {
        const id = await consumeToken(tx, token, 'EMAIL_VERIFY');
        await tx.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
        return id;
      });
      await recordAudit(prisma, req, {
        action: 'auth.email_verified',
        entityType: 'User',
        entityId: userId,
        actorUserId: userId,
      });
    },

    async resendVerification(req) {
      if (req.user.emailVerifiedAt) {
        throw conflict('EMAIL_ALREADY_VERIFIED', 'Your email address is already confirmed');
      }
      await sendVerificationEmail(req.user);
    },

    async requestPasswordReset(req, { email }) {
      const user = await prisma.user.findUnique({ where: { email } });
      // Same response whether or not the account exists (no account enumeration).
      if (!user || user.status !== 'ACTIVE') return;
      const token = await issueToken(prisma, user.id, 'PASSWORD_RESET', PASSWORD_RESET_TTL_MS);
      await emails.enqueue({
        kind: 'auth.password_reset',
        to: user.email,
        message: passwordResetMessage({ appUrl: env.APP_URL, name: user.name, token }),
      });
      await recordAudit(prisma, req, {
        action: 'auth.password_reset_requested',
        entityType: 'User',
        entityId: user.id,
        actorUserId: user.id,
      });
    },

    async resetPassword(req, { token, password }) {
      const passwordHash = await hashPassword(password);
      const userId = await prisma.$transaction(async (tx) => {
        const id = await consumeToken(tx, token, 'PASSWORD_RESET');
        // Receiving the email proves control of the address, so it counts as verification.
        const user = await tx.user.findUniqueOrThrow({ where: { id } });
        await tx.user.update({
          where: { id },
          data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
        });
        return id;
      });
      await sessionStore.destroyAllForUser(userId);
      await recordAudit(prisma, req, {
        action: 'auth.password_reset',
        entityType: 'User',
        entityId: userId,
        actorUserId: userId,
      });
    },
  };
}
