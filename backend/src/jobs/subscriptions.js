import { createPoller } from './poller.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Marks trials past their end date as EXPIRED and audits each one. Requests already treat
 * such a trial as expired (effectiveStatus), so this only makes the stored state, reports and
 * the audit log agree; running it late or twice changes nothing.
 */
export async function expireTrials(prisma, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const expired = await tx.$queryRaw`
      UPDATE subscriptions SET status = 'EXPIRED', updated_at = now()
      WHERE status = 'TRIALING' AND trial_ends_at <= ${now}
      RETURNING id, organization_id AS "organizationId", trial_ends_at AS "trialEndsAt"`;
    if (expired.length) {
      await tx.auditLog.createMany({
        data: expired.map((s) => ({
          organizationId: s.organizationId,
          action: 'subscription.trial_expired',
          entityType: 'Subscription',
          entityId: s.id,
          metadata: { trialEndsAt: s.trialEndsAt },
        })),
      });
    }
    return expired.length;
  });
}

/** Runs expireTrials every hour in the worker. */
export function createSubscriptionWorker({ prisma, logger }) {
  const poller = createPoller({
    name: 'expire-trials',
    intervalMs: HOUR_MS,
    logger,
    run: async () => {
      const count = await expireTrials(prisma);
      if (count) logger.info({ count }, 'Trials expired');
    },
  });
  return { start: () => poller.start(), close: () => poller.close() };
}
