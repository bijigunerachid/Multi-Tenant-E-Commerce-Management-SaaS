/* eslint-disable no-console -- a command-line script: printing is its output. */
import { loadEnvFor } from '../config/env.js';
import { createPrismaClient } from '../config/database.js';

// Grants or revokes Vendora's platform administrator role. There is deliberately no API for
// this: only someone with access to the server (and its database credentials) can do it.
//
//   npm run admin -w backend -- grant someone@example.com
//   npm run admin -w backend -- revoke someone@example.com
//   npm run admin -w backend -- list
//
// The account must exist and be verified. Every change is written to the audit log.

const [command, rawEmail] = process.argv.slice(2);
const usage = 'Usage: npm run admin -w backend -- grant|revoke <email>, or: list';
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
