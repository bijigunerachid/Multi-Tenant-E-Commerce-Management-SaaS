import { UnrecoverableError, Worker } from 'bullmq';
import { EMAIL_QUEUE, createQueueConnection } from './emailQueue.js';

/**
 * SMTP errors that will not go away by retrying: a 5xx reply (for example 550, mailbox
 * unavailable) or an address the server rejects outright. Anything else (timeouts, refused
 * connections, 4xx replies) is treated as temporary and retried with backoff.
 */
export function isPermanentFailure(err) {
  return (err.responseCode >= 500 && err.responseCode < 600) || err.code === 'EENVELOPE';
}

const describe = (err) =>
  (err.responseCode ? `${err.responseCode} ${err.message}` : err.message || String(err)).slice(
    0,
    500,
  );

/**
 * Sends queued emails and records each attempt on the EmailDelivery row: SENT on success,
 * FAILED after the last attempt or a permanent error, otherwise still QUEUED with the error
 * of the latest attempt. The job carries only data; the delivery row is re-read by id and a
 * delivery that is no longer QUEUED is not sent again.
 */
export function createEmailProcessor({ prisma, mailer, logger }) {
  return async function processEmail(job) {
    const { deliveryId, message } = job.data;
    const delivery = await prisma.emailDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || delivery.status !== 'QUEUED') return 'skipped';

    try {
      await mailer.send(message);
    } catch (err) {
      const permanent = isPermanentFailure(err);
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const final = permanent || lastAttempt;
      await prisma.emailDelivery.update({
        where: { id: deliveryId },
        data: {
          attempts: { increment: 1 },
          lastError: describe(err),
          ...(final ? { status: 'FAILED', failedAt: new Date() } : {}),
        },
      });
      logger.warn(
        { err, deliveryId, kind: delivery.kind, attempt: job.attemptsMade + 1, final },
        'Email delivery attempt failed',
      );
      throw permanent ? new UnrecoverableError(describe(err)) : err;
    }

    await prisma.emailDelivery.update({
      where: { id: deliveryId },
      data: { attempts: { increment: 1 }, status: 'SENT', sentAt: new Date(), lastError: null },
    });
    return 'sent';
  };
}

/** Starts processing the email queue. `close()` finishes the current email, then disconnects. */
export function createEmailWorker({ prisma, mailer, logger, env, concurrency = 5 }) {
  const connection = createQueueConnection(env.REDIS_URL, { worker: true });
  const worker = new Worker(EMAIL_QUEUE, createEmailProcessor({ prisma, mailer, logger }), {
    connection,
    concurrency,
  });
  worker.on('error', (err) => logger.error({ err }, 'Email worker error'));
  return {
    worker,
    waitUntilReady: () => worker.waitUntilReady(),
    async close() {
      await worker.close();
      await connection.quit();
    },
  };
}
