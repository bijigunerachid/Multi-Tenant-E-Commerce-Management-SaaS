import { loadEnv } from '../../src/config/env.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/config/database.js';
import { createRedisClient } from '../../src/config/redis.js';
import { createMailer } from '../../src/services/mailer.js';
import { createEmailQueue } from '../../src/jobs/emailQueue.js';
import { createEmailWorker } from '../../src/jobs/emailWorker.js';
import { createNotificationDispatcher } from '../../src/jobs/notifications.js';
import { createLocalStorage } from '../../src/services/storage.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/app.js';

/** Builds the real app against the test database and Redis. Call `close()` in afterAll. */
export async function createTestApp(overrides = {}) {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL });
  const prisma = overrides.prisma ?? createPrismaClient({ databaseUrl: env.DATABASE_URL });
  const redis = overrides.redis ?? createRedisClient({ redisUrl: env.REDIS_URL, logger });
  // Emails go through the real queue to an in-process worker with the memory transport.
  const mailer = createMailer({ env });
  const emails = createEmailQueue({ prisma, logger, env });
  const worker = createEmailWorker({ prisma, mailer, logger, env });
  // Notifications are delivered when a test calls notifications.dispatchPending(), so tests
  // decide when it happens (the scheduled worker is tested on its own).
  const notifications = createNotificationDispatcher({ prisma, emails, logger, env });
  // Each test file gets its own throwaway upload directory.
  const uploadDir = mkdtempSync(path.join(tmpdir(), 'vendora-uploads-'));
  const storage = createLocalStorage({ rootDir: uploadDir });
  // Connect up front, as server.js does, so the first request does not pay the connection cost.
  await Promise.all([
    overrides.prisma ? null : prisma.$connect(),
    overrides.redis ? null : redis.connect(),
    emails.queue.waitUntilReady(),
    worker.waitUntilReady(),
  ]);

  const app = createApp({ env, logger, prisma, redis, emails, storage });
  const close = async () => {
    rmSync(uploadDir, { recursive: true, force: true });
    await worker.close();
    await emails.close();
    await Promise.allSettled([
      overrides.prisma ? null : prisma.$disconnect(),
      overrides.redis ? null : redis.quit(),
    ]);
  };
  return {
    app,
    prisma,
    redis,
    mailer,
    emails,
    worker,
    notifications,
    storage,
    uploadDir,
    env,
    close,
  };
}

/** Empties every application table and the test Redis database. */
export async function resetState({ prisma, redis, mailer, emails }) {
  // Let emails queued by the previous test finish first, so none is sent mid-reset.
  if (emails) await emails.drain();
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      -- Plans are reference data created by a migration, not test data.
      AND tablename NOT IN ('_prisma_migrations', 'subscription_plans')`;
  if (tables.length) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  }
  await redis.flushdb();
  if (mailer) mailer.reset();
}
