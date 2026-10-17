import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createPrismaClient } from './config/database.js';
import { createRedisClient } from './config/redis.js';
import { createMailer } from './services/mailer.js';
import { createEmailQueue } from './jobs/emailQueue.js';
import { createEmailWorker } from './jobs/emailWorker.js';
import { createLocalStorage } from './services/storage.js';
import { createApp } from './app.js';

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL });
const prisma = createPrismaClient({ databaseUrl: env.DATABASE_URL });
const redis = createRedisClient({ redisUrl: env.REDIS_URL, logger });
const storage = createLocalStorage({ rootDir: env.UPLOAD_DIR });
const emails = createEmailQueue({ prisma, logger, env });
// Normally emails are sent by the separate worker process (src/worker.js).
const worker =
  env.EMAIL_WORKER === 'in-process'
    ? createEmailWorker({ prisma, mailer: createMailer({ env }), logger, env })
    : null;

await Promise.all([prisma.$connect(), redis.connect(), emails.queue.waitUntilReady()]);

const app = createApp({ env, logger, prisma, redis, emails, storage });
const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, emailWorker: env.EMAIL_WORKER },
    'API listening',
  );
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
    // The worker finishes the email it is sending before closing.
    await worker?.close();
    await Promise.allSettled([emails.close(), prisma.$disconnect(), redis.quit()]);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
