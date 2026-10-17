import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createPrismaClient } from './config/database.js';
import { createMailer } from './services/mailer.js';
import { createEmailWorker } from './jobs/emailWorker.js';

// Background worker process: sends queued emails. Run it next to the API (`npm run worker`).
// It needs the same DATABASE_URL, REDIS_URL and mail settings as the API.

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL });
const prisma = createPrismaClient({ databaseUrl: env.DATABASE_URL });
await prisma.$connect();

const worker = createEmailWorker({ prisma, mailer: createMailer({ env }), logger, env });
await worker.waitUntilReady();
logger.info({ transport: env.MAIL_TRANSPORT }, 'Email worker started');

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Worker shutting down');
  const forceExit = setTimeout(() => {
    logger.error('Forced exit after 30 s');
    process.exit(1);
  }, 30_000);
  forceExit.unref();
  // Lets the email being sent finish; unfinished jobs stay in the queue for the next start.
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
