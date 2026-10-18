import { Prisma } from '@prisma/client';
import { AppError, conflict, notFound } from '../../utils/errors.js';
import { recordAudit } from '../../utils/audit.js';
import { sendVerificationEmail } from '../auth/auth.service.js';

// Platform administration of user accounts (docs/architecture.md, "Platform administration").
// Every change needs a reason and is written to the audit log (organization: none, entity: the
// user). An admin cannot act on their own account or on another admin here: the admin role
// itself is managed only from the server's command line.

function presentUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    status: u.status,
    emailVerified: Boolean(u.emailVerifiedAt),
    platformRole: u.platformRole,
    mfaEnabled: Boolean(u.mfaEnabledAt),
    createdAt: u.createdAt,
  };
}

export function createAdminUserService({ prisma, sessionStore, emails, env }) {
  async function loadTarget(req, userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound('User not found');
    if (user.id === req.user.id) {
      throw conflict('CANNOT_CHANGE_SELF', 'Use your own profile for your account');
    }
    if (user.platformRole !== 'NONE') {
      throw conflict(
        'PLATFORM_ADMIN',
        'This is a platform administrator. Revoke the role from the server first (npm run admin -- revoke).',
      );
    }
    return user;
  }

  const audit = (req, user, action, metadata) =>
    recordAudit(prisma, req, {
      organizationId: null,
      action,
      entityType: 'User',
      entityId: user.id,
      metadata: { email: user.email, ...metadata },
    });

  return {
    async list({ search, status, page, pageSize }) {
      const where = {
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { _count: { select: { memberships: { where: { status: 'ACTIVE' } } } } },
        }),
        prisma.user.count({ where }),
      ]);
      const lastSignIns = rows.length
        ? await prisma.$queryRaw`
            SELECT actor_user_id AS "userId", MAX(created_at) AS "at" FROM audit_logs
            WHERE action = 'auth.login' AND actor_user_id IN (${Prisma.join(rows.map((r) => Prisma.sql`${r.id}::uuid`))})
            GROUP BY actor_user_id`
        : [];
      const lastSignIn = new Map(lastSignIns.map((r) => [r.userId, r.at]));
      return {
        data: rows.map((u) => ({
          ...presentUser(u),
          organizations: u._count.memberships,
          lastSignInAt: lastSignIn.get(u.id) ?? null,
        })),
        meta: { page, pageSize, total },
      };
    },

    async get(userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          memberships: {
            include: { organization: { select: { id: true, name: true, status: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!user) throw notFound('User not found');
      const [lastSignIn] = await prisma.$queryRaw`
        SELECT MAX(created_at) AS "at" FROM audit_logs
        WHERE action = 'auth.login' AND actor_user_id = ${userId}::uuid`;
      return {
        ...presentUser(user),
        lastSignInAt: lastSignIn?.at ?? null,
        memberships: user.memberships.map((m) => ({
          id: m.id,
          role: m.role,
          status: m.status,
          organization: m.organization,
        })),
      };
    },

    /** Disables the account and ends all its sessions; enabling lets it sign in again. */
    async setStatus(req, userId, { status, reason }) {
      const user = await loadTarget(req, userId);
      if (user.status === status) {
        throw conflict(
          status === 'DISABLED' ? 'ALREADY_DISABLED' : 'NOT_DISABLED',
          status === 'DISABLED'
            ? 'This account is already disabled'
            : 'This account is not disabled',
        );
      }
      await prisma.user.update({ where: { id: user.id }, data: { status } });
      const ended = status === 'DISABLED' ? await sessionStore.destroyAllForUser(user.id) : 0;
      await audit(req, user, status === 'DISABLED' ? 'admin.user_disabled' : 'admin.user_enabled', {
        reason,
        sessionsEnded: ended,
      });
      return this.get(user.id);
    },

    async signOutEverywhere(req, userId, { reason }) {
      const user = await loadTarget(req, userId);
      const ended = await sessionStore.destroyAllForUser(user.id);
      await audit(req, user, 'admin.user_signed_out', { reason, sessionsEnded: ended });
      return { sessionsEnded: ended };
    },

    async resendVerification(req, userId) {
      const user = await loadTarget(req, userId);
      if (user.emailVerifiedAt) {
        throw conflict('EMAIL_ALREADY_VERIFIED', 'This email address is already confirmed');
      }
      if (user.status !== 'ACTIVE') {
        throw new AppError(409, 'USER_DISABLED', 'Enable the account first');
      }
      await sendVerificationEmail({ prisma, emails, env }, user);
      await audit(req, user, 'admin.verification_resent', {});
      return { sent: true };
    },

    /** For a user who lost their phone and their recovery codes. */
    async resetMfa(req, userId, { reason }) {
      const user = await loadTarget(req, userId);
      if (!user.mfaEnabledAt) throw conflict('MFA_NOT_ENABLED', 'Two-factor sign-in is not on');
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null },
        }),
        prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
      ]);
      const ended = await sessionStore.destroyAllForUser(user.id);
      await audit(req, user, 'admin.user_mfa_reset', { reason, sessionsEnded: ended });
      return this.get(user.id);
    },

    /** Everything platform administrators did, and every grant or revoke of the role. */
    async activity({ action, page, pageSize }) {
      const where = action
        ? { action }
        : { OR: [{ action: { startsWith: 'admin.' } }, { action: { startsWith: 'platform.' } }] };
      const [rows, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.auditLog.count({ where }),
      ]);
      const userIds = [
        ...new Set(
          rows.flatMap((r) => [r.actorUserId, r.entityType === 'User' ? r.entityId : null]),
        ),
      ].filter(Boolean);
      const orgIds = [...new Set(rows.map((r) => r.organizationId).filter(Boolean))];
      const [users, orgs] = await Promise.all([
        prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        }),
        prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        }),
      ]);
      const userById = new Map(users.map((u) => [u.id, u]));
      const orgById = new Map(orgs.map((o) => [o.id, o]));
      return {
        data: rows.map((r) => ({
          id: r.id,
          action: r.action,
          reason: r.metadata?.reason ?? null,
          metadata: r.metadata,
          actor: r.actorUserId ? (userById.get(r.actorUserId) ?? { id: r.actorUserId }) : null,
          organization: r.organizationId ? (orgById.get(r.organizationId) ?? null) : null,
          user: r.entityType === 'User' ? (userById.get(r.entityId) ?? null) : null,
          ip: r.ip,
          createdAt: r.createdAt,
        })),
        meta: { page, pageSize, total },
      };
    },
  };
}
