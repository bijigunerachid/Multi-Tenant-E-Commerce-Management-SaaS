import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createPrismaClient } from './config/database.js';
import { createMailer } from './services/mailer.js';
import { createEmailWorker } from './jobs/emailWorker.js';
import { createEmailQueue } from './jobs/emailQueue.js';
import { createNotificationWorker } from './jobs/notifications.js';
import { createSubscriptionWorker } from './jobs/subscriptions.js';

// Background worker process: sends queued emails, delivers notifications and expires trials.
// Run it next to the API (`npm run worker`). It needs the same DATABASE_URL, REDIS_URL and
// mail settings.

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL });
const prisma = createPrismaClient({ databaseUrl: env.DATABASE_URL });
await prisma.$connect();

const worker = createEmailWorker({ prisma, mailer: createMailer({ env }), logger, env });
// Notification emails are queued like any other email.
const emails = createEmailQueue({ prisma, logger, env });
const notifications = createNotificationWorker({ prisma, emails, logger, env });
const subscriptions = createSubscriptionWorker({ prisma, logger });
await Promise.all([worker.waitUntilReady(), emails.queue.waitUntilReady(), notifications.start()]);
subscriptions.start();
logger.info(
  { transport: env.MAIL_TRANSPORT, notificationPollMs: env.NOTIFICATION_POLL_MS },
  'Worker started',
);

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
  // Lets the running jobs finish; unfinished jobs stay in the queue for the next start.
  await Promise.allSettled([worker.close(), notifications.close(), subscriptions.close()]);
  await emails.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
