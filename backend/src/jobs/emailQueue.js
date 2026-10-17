import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const EMAIL_QUEUE = 'emails';
export const EMAIL_ATTEMPTS = 5;

/**
 * Redis connection for BullMQ. Workers block on Redis and must retry forever; the producer
 * side fails fast instead (no offline queue), so a request is never left hanging when Redis
 * is down. BullMQ does not close connections it is given, so their owner quits them.
 */
export function createQueueConnection(redisUrl, { worker = false } = {}) {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    ...(worker ? {} : { enableOfflineQueue: false }),
  });
}

/**
 * Transactional email is queued, not sent during the request. `enqueue` records an
 * EmailDelivery row, then adds a job carrying the rendered message. The message (which can
 * hold a one-time link) lives only in the job, and jobs are removed once sent or failed for
 * good, so the link is never stored at rest. Delivery is at least once: a crash between
 * sending and recording it can send the same email twice, never zero times.
 */
export function createEmailQueue({ prisma, logger, env }) {
  const connection = createQueueConnection(env.REDIS_URL);
  const queue = new Queue(EMAIL_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: EMAIL_ATTEMPTS,
      backoff: { type: 'exponential', delay: env.EMAIL_RETRY_DELAY_MS },
      removeOnComplete: true,
      removeOnFail: true,
    },
  });

  return {
    queue,

    /**
     * kind: what the email is for (e.g. "member.invitation"); message: { subject, text, html };
     * organizationId: the organization it belongs to, or null for account emails.
     * Never throws: a request must not fail because its email could not be queued. That case
     * is recorded as a failed delivery and logged.
     */
    async enqueue({ kind, to, message, organizationId = null }) {
      const delivery = await prisma.emailDelivery.create({
        data: { kind, toAddress: to, subject: message.subject.slice(0, 300), organizationId },
      });
      try {
        await queue.add(
          kind,
          { deliveryId: delivery.id, message: { to, ...message } },
          { jobId: delivery.id },
        );
      } catch (err) {
        logger.error({ err, deliveryId: delivery.id, kind }, 'Could not queue email');
        await prisma.emailDelivery
          .update({
            where: { id: delivery.id },
            data: {
              status: 'FAILED',
              failedAt: new Date(),
              lastError: `Could not be queued: ${err.message}`.slice(0, 500),
            },
          })
          .catch((updateErr) => logger.error({ err: updateErr }, 'Could not record email failure'));
      }
      return delivery;
    },

    /** Resolves once no email job is waiting, delayed or running (used by tests). */
    async drain({ timeoutMs = 15_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
        if (Object.values(counts).every((n) => n === 0)) return;
        if (Date.now() > deadline)
          throw new Error(`Email queue not drained: ${JSON.stringify(counts)}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },

    async close() {
      await queue.close();
      await connection.quit();
    },
  };
}
