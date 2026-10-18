import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createPrismaClient } from './config/database.js';
import { createRedisClient } from './config/redis.js';
import { createMailer } from './services/mailer.js';
import { createEmailQueue } from './jobs/emailQueue.js';
import { createEmailWorker } from './jobs/emailWorker.js';
import { createNotificationWorker } from './jobs/notifications.js';
import { createSubscriptionWorker } from './jobs/subscriptions.js';
import { createLocalStorage } from './services/storage.js';
import { createApp } from './app.js';

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL });
const prisma = createPrismaClient({ databaseUrl: env.DATABASE_URL });
const redis = createRedisClient({ redisUrl: env.REDIS_URL, logger });
const storage = createLocalStorage({ rootDir: env.UPLOAD_DIR });
const emails = createEmailQueue({ prisma, logger, env });
// Background jobs normally run in the separate worker process (src/worker.js).
const inProcess = env.JOB_WORKER === 'in-process';
const worker = inProcess
  ? createEmailWorker({ prisma, mailer: createMailer({ env }), logger, env })
  : null;
const notifications = inProcess ? createNotificationWorker({ prisma, emails, logger, env }) : null;
const subscriptions = inProcess ? createSubscriptionWorker({ prisma, logger }) : null;

await Promise.all([prisma.$connect(), redis.connect(), emails.queue.waitUntilReady()]);
await notifications?.start();
subscriptions?.start();

const app = createApp({ env, logger, prisma, redis, emails, storage });
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV, jobWorker: env.JOB_WORKER }, 'API listening');
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  // Stop accepting connections, let in-flight requests finish, then close dependencies.
  const forceExit = setTimeout(() => {
    logger.error('Forced exit after 10 s');
    process.exit(1);
  }, 10_000);
  forceExit.unref();
  server.close(async () => {
    // The workers finish the job they are running before closing.
    await Promise.allSettled([worker?.close(), notifications?.close(), subscriptions?.close()]);
    await Promise.allSettled([emails.close(), prisma.$disconnect(), redis.quit()]);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
