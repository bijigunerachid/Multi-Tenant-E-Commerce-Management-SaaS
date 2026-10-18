/* eslint-disable no-console -- a command-line script: printing is its output. */
import { loadEnvFor } from '../config/env.js';
import { createPrismaClient } from '../config/database.js';

// Grants or revokes Vendora's platform administrator role. There is deliberately no API for
// this: only someone with access to the server (and its database credentials) can do it.
//
//   npm run admin -w backend -- grant someone@example.com
//   npm run admin -w backend -- revoke someone@example.com
//   npm run admin -w backend -- list
//   npm run admin -w backend -- reset-mfa someone@example.com
//
// The account must exist and be verified. Every change is written to the audit log.
// reset-mfa turns off a platform administrator's two-factor sign-in when they lost both their
// phone and their recovery codes: the admin screens refuse other admins' accounts, so the server
// is the only place to do it. Their sessions lose the admin area until they set it up again.

const [command, rawEmail] = process.argv.slice(2);
const usage = 'Usage: npm run admin -w backend -- grant|revoke|reset-mfa <email>, or: list';
// Only the database: the script runs on a server shell or in CI without the API's settings.
const env = loadEnvFor(['DATABASE_URL']);
const prisma = createPrismaClient({ databaseUrl: env.DATABASE_URL });

try {
  if (command === 'list') {
    const admins = await prisma.user.findMany({
      where: { platformRole: 'SUPER_ADMIN' },
      select: { email: true, name: true, status: true },
      orderBy: { email: 'asc' },
    });
    if (admins.length === 0) console.log('No platform administrators.');
    for (const a of admins)
      console.log(`  ${a.email}  ${a.name}${a.status === 'ACTIVE' ? '' : ` (${a.status})`}`);
  } else if ((command === 'grant' || command === 'revoke') && rawEmail) {
    const email = rawEmail.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No account uses ${email}.`);
    if (command === 'grant' && !user.emailVerifiedAt) {
      throw new Error(`${email} has not confirmed their email address yet.`);
    }
    const role = command === 'grant' ? 'SUPER_ADMIN' : 'NONE';
    if (user.platformRole === role) {
      console.log(
        `${email} ${role === 'NONE' ? 'is not' : 'is already'} a platform administrator.`,
      );
    } else {
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { platformRole: role } }),
        prisma.auditLog.create({
          data: {
            action: command === 'grant' ? 'platform.admin_granted' : 'platform.admin_revoked',
            entityType: 'User',
            entityId: user.id,
            metadata: { email, via: 'cli' },
          },
        }),
      ]);
      console.log(
        `${email} ${command === 'grant' ? 'is now' : 'is no longer'} a platform administrator.`,
      );
    }
  } else if (command === 'reset-mfa' && rawEmail) {
    const email = rawEmail.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No account uses ${email}.`);
    if (!user.mfaEnabledAt) {
      console.log(`${email} does not have two-factor sign-in on.`);
    } else {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null },
        }),
        prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
        prisma.auditLog.create({
          data: {
            action: 'platform.mfa_reset',
            entityType: 'User',
            entityId: user.id,
            metadata: { email, via: 'cli' },
          },
        }),
      ]);
      console.log(
        `Two-factor sign-in is off for ${email}. They can turn it on again from their profile.`,
      );
    }
  } else {
    console.error(usage);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
