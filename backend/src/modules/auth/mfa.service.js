import { randomBytes } from 'node:crypto';
import { AppError, conflict, unauthorized } from '../../utils/errors.js';
import { recordAudit } from '../../utils/audit.js';
import { sha256 } from '../../utils/crypto.js';
import { verifyPassword } from '../../utils/passwords.js';
import { createSecretBox } from '../../utils/secretBox.js';
import { generateSecret, otpauthUrl, verifyTotp } from '../../utils/totp.js';
import { describeSession } from './auth.service.js';

// Two-factor sign-in with an authenticator app (docs/security.md, "Two-factor sign-in").
//
// - Setup: the password unlocks a new secret, shown once as a QR code; it becomes active only
//   when a code from the app confirms it. Secrets are encrypted at rest (utils/secretBox.js).
// - Sign-in: a correct password with two-factor on gives a pending session that opens nothing
//   (requireAuth refuses it) for 5 minutes; a valid code replaces it with a new, full session.
//   5 wrong codes end the pending session.
// - A code is accepted once: the last used 30-second step is stored and moved forward with a
//   conditional update, so even two requests racing with the same code cannot both pass.
// - 10 single-use recovery codes, stored as SHA-256 hashes, for a lost phone.

export const RECOVERY_CODE_COUNT = 10;
const MAX_FAILURES = 5;

const invalidCode = (field = 'code') =>
  new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid', {
    fieldErrors: { [field]: 'This code is not valid. Check your authenticator app and try again.' },
  });
const wrongPassword = () =>
  new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid', {
    fieldErrors: { password: 'Your password is incorrect' },
  });

/** "k7m2p-9xq4t": 50 random bits, easy to read and type. */
function newRecoveryCode() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const chars = [...randomBytes(10)].map((b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}
const normaliseRecoveryCode = (code) =>
  code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Accepts a code once: moves the user's last used step forward, or refuses. `user` may be a
 * stale copy (two requests racing with the same code both read the same row): the conditional
 * update in the database is what lets only one of them through.
 */
export async function consumeTotpCode({ prisma, box }, user, code) {
  const step = verifyTotp(box.open(user.mfaSecret), code, { notAfterStep: user.mfaLastStep });
  if (step === null) return false;
  const { count } = await prisma.user.updateMany({
    where: {
      id: user.id,
      OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }],
    },
    data: { mfaLastStep: step },
  });
  return count === 1;
}

export function createMfaService({ prisma, sessionStore, env }) {
  const box = createSecretBox(env.MFA_ENCRYPTION_KEY);

  const consumeTotp = (user, code) => consumeTotpCode({ prisma, box }, user, code);

  async function consumeRecoveryCode(user, code) {
    const { count } = await prisma.mfaRecoveryCode.updateMany({
      where: { userId: user.id, codeHash: sha256(normaliseRecoveryCode(code)), usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  async function issueRecoveryCodes(tx, userId) {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.mfaRecoveryCode.createMany({
      data: codes.map((c) => ({ userId, codeHash: sha256(normaliseRecoveryCode(c)) })),
    });
    return codes;
  }

  /** Password plus a current code (or a recovery code): needed to weaken two-factor sign-in. */
  async function confirmIdentity(user, { password, code }) {
    if (!(await verifyPassword(user.passwordHash, password))) throw wrongPassword();
    if (!user.mfaEnabledAt) return;
    const ok = /^\d{6}$/.test(code ?? '')
      ? await consumeTotp(user, code)
      : await consumeRecoveryCode(user, code ?? '');
    if (!ok) throw invalidCode();
  }

  return {
    async status(req) {
      const remaining = req.user.mfaEnabledAt
        ? await prisma.mfaRecoveryCode.count({ where: { userId: req.user.id, usedAt: null } })
        : 0;
      return {
        enabled: Boolean(req.user.mfaEnabledAt),
        enabledAt: req.user.mfaEnabledAt,
        recoveryCodesLeft: remaining,
      };
    },

    async setup(req, { password }) {
      if (req.user.mfaEnabledAt) {
        throw conflict('MFA_ALREADY_ENABLED', 'Two-factor sign-in is already on');
      }
      if (!(await verifyPassword(req.user.passwordHash, password))) throw wrongPassword();
      const secret = generateSecret();
      await prisma.user.update({
        where: { id: req.user.id },
        data: { mfaPendingSecret: box.seal(secret) },
      });
      return { secret, otpauthUrl: otpauthUrl({ secret, account: req.user.email }) };
    },

    async enable(req, { code }) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
      if (user.mfaEnabledAt) {
        throw conflict('MFA_ALREADY_ENABLED', 'Two-factor sign-in is already on');
      }
      if (!user.mfaPendingSecret) {
        throw conflict('MFA_SETUP_REQUIRED', 'Start the setup again: no secret is waiting');
      }
      const secret = box.open(user.mfaPendingSecret);
      const step = verifyTotp(secret, code);
      if (step === null) throw invalidCode();

      const codes = await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            mfaSecret: box.seal(secret),
            mfaPendingSecret: null,
            mfaEnabledAt: new Date(),
            mfaLastStep: step,
          },
        });
        return issueRecoveryCodes(tx, user.id);
      });
      // Other sessions were opened with the password alone: they end. This one just proved
      // the second factor.
      await sessionStore.destroyAllForUser(user.id, { exceptId: req.sessionId });
      await req.updateSession({ mfaVerifiedAt: Date.now() });
      await recordAudit(prisma, req, {
        action: 'auth.mfa_enabled',
        entityType: 'User',
        entityId: user.id,
      });
      return { recoveryCodes: codes };
    },

    async disable(req, input) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
      if (!user.mfaEnabledAt) throw conflict('MFA_NOT_ENABLED', 'Two-factor sign-in is not on');
      await confirmIdentity(user, input);
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null },
        }),
        prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
      ]);
      await req.updateSession({ mfaVerifiedAt: null });
      await recordAudit(prisma, req, {
        action: 'auth.mfa_disabled',
        entityType: 'User',
        entityId: user.id,
      });
    },

    async regenerateRecoveryCodes(req, input) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
      if (!user.mfaEnabledAt) throw conflict('MFA_NOT_ENABLED', 'Two-factor sign-in is not on');
      await confirmIdentity(user, input);
      const codes = await prisma.$transaction((tx) => issueRecoveryCodes(tx, user.id));
      await recordAudit(prisma, req, {
        action: 'auth.mfa_recovery_codes_regenerated',
        entityType: 'User',
        entityId: user.id,
      });
      return { recoveryCodes: codes };
    },

    /** Second sign-in step: the pending session plus a code gives a full, new session. */
    async verifyLogin(req, { code, recoveryCode }) {
      const pending = req.session;
      if (!pending?.mfaPending || pending.mfaPendingUntil < Date.now()) {
        if (pending?.mfaPending) await req.endSession();
        throw unauthorized('MFA_SESSION_EXPIRED', 'Sign in again: the code step has expired');
      }
      const user = await prisma.user.findUnique({ where: { id: pending.userId } });
      if (!user || user.status !== 'ACTIVE' || !user.mfaEnabledAt) {
        await req.endSession();
        throw unauthorized();
      }
      const ok = recoveryCode
        ? await consumeRecoveryCode(user, recoveryCode)
        : await consumeTotp(user, code);
      if (!ok) {
        const failures = (pending.mfaFailures ?? 0) + 1;
        await recordAudit(prisma, req, {
          action: 'auth.mfa_failed',
          entityType: 'User',
          entityId: user.id,
          actorUserId: user.id,
          metadata: { method: recoveryCode ? 'recovery_code' : 'totp', failures },
        });
        if (failures >= MAX_FAILURES) {
          await req.endSession();
          throw unauthorized('MFA_TOO_MANY_ATTEMPTS', 'Too many wrong codes. Sign in again.');
        }
        await req.updateSession({ mfaFailures: failures });
        throw invalidCode(recoveryCode ? 'recoveryCode' : 'code');
      }

      // A new session id once fully signed in (no fixation of the pending one).
      await req.startSession({
        userId: user.id,
        activeOrganizationId: pending.activeOrganizationId,
        mfaVerifiedAt: Date.now(),
      });
      req.user = user;
      await recordAudit(prisma, req, {
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
        metadata: { secondFactor: recoveryCode ? 'recovery_code' : 'authenticator' },
      });
      return describeSession(prisma, req);
    },
  };
}
