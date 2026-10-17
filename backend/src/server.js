import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createPrismaClient } from './config/database.js';
import { createRedisClient } from './config/redis.js';
import { createMailer } from './services/mailer.js';
import { createLocalStorage } from './services/storage.js';
import { createApp } from './app.js';

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL });
const prisma = createPrismaClient({ databaseUrl: env.DATABASE_URL });
const redis = createRedisClient({ redisUrl: env.REDIS_URL, logger });
const mailer = createMailer({ env, logger });
const storage = createLocalStorage({ rootDir: env.UPLOAD_DIR });

await Promise.all([prisma.$connect(), redis.connect()]);

const app = createApp({ env, logger, prisma, redis, mailer, storage });
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening');
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
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
