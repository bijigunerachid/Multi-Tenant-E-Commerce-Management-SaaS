import { Prisma } from '@prisma/client';
import { createPoller } from './poller.js';
import { NOTIFICATION_TYPES } from '../modules/notifications/types.js';
import { rolesWith } from '../modules/auth/permissions.js';

/** An event that fails this many times is left aside (and logged) instead of retried forever. */
export const MAX_EVENT_ATTEMPTS = 5;
export const NOTIFICATION_RETENTION_DAYS = 90;
const EVENT_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const describeError = (err) => (err?.message || String(err)).slice(0, 500);

/**
 * Turns notification events (the outbox written by the business transaction) into one
 * Notification per recipient, and queues an email for recipients who asked for one.
 *
 * Each event is claimed and delivered in its own transaction (`FOR UPDATE SKIP LOCKED`), so
 * several workers can run at once without delivering an event twice, and one broken event
 * does not hold up the others. Notifications are unique per (event, member), so a retried
 * delivery cannot create duplicates. Emails are queued after the commit: a crash in between
 * loses the email copy, never the in-app notification.
 */
export function createNotificationDispatcher({ prisma, emails, logger, env }) {
  async function deliver(tx, event) {
    const definition = NOTIFICATION_TYPES[event.type];
    if (!definition) {
      logger.warn({ eventId: event.id, type: event.type }, 'Unknown notification type, skipped');
      return [];
    }
    const data = await definition.describe(tx, event);
    if (!data) return [];

    const members = await tx.organizationMembership.findMany({
      where: {
        organizationId: event.organizationId,
        status: 'ACTIVE',
        role: { in: rolesWith(definition.permission) },
        user: { status: 'ACTIVE' },
        ...(!definition.notifyActor && event.actorUserId
          ? { userId: { not: event.actorUserId } }
          : {}),
      },
      select: {
        id: true,
        emailNotifications: true,
        user: { select: { email: true, emailVerifiedAt: true } },
      },
    });
    if (members.length === 0) return [];

    await tx.notification.createMany({
      data: members.map((m) => ({
        organizationId: event.organizationId,
        membershipId: m.id,
        eventId: event.id,
        type: event.type,
        data,
        createdAt: event.createdAt,
      })),
      skipDuplicates: true,
    });

    // Email copies go only to verified addresses of members who turned them on.
    const recipients = members.filter(
      (m) => m.emailNotifications.includes(event.type) && m.user.emailVerifiedAt,
    );
    if (recipients.length === 0) return [];
    const organization = await tx.organization.findUnique({
      where: { id: event.organizationId },
      select: { name: true },
    });
    const message = definition.email({
      appUrl: env.APP_URL,
      organizationName: organization.name,
      data,
    });
    return recipients.map((m) => ({
      kind: definition.emailKind,
      to: m.user.email,
      message,
      organizationId: event.organizationId,
    }));
  }

  /** Claims and delivers the oldest pending event. Returns null when there is none left. */
  async function dispatchOne(skipIds) {
    let claimed = null;
    try {
      const outgoing = await prisma.$transaction(async (tx) => {
        const skip = skipIds.length
          ? Prisma.sql`AND id NOT IN (${Prisma.join(skipIds.map((id) => Prisma.sql`${id}::uuid`))})`
          : Prisma.empty;
        const [event] = await tx.$queryRaw`
          SELECT id, organization_id AS "organizationId", type, payload,
                 actor_user_id AS "actorUserId", created_at AS "createdAt"
          FROM notification_events
          WHERE processed_at IS NULL AND attempts < ${MAX_EVENT_ATTEMPTS} ${skip}
          ORDER BY created_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED`;
        if (!event) return null;
        claimed = event;
        const result = await deliver(tx, event);
        await tx.notificationEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), attempts: { increment: 1 }, lastError: null },
        });
        return result;
      });
      if (outgoing === null) return null;
      // enqueue() never throws; a failure is recorded on the email delivery.
      for (const email of outgoing) await emails.enqueue(email);
      return { id: claimed.id, ok: true };
    } catch (err) {
      // Nothing claimed means the database itself failed: let the job fail and retry later.
      if (!claimed) throw err;
      logger.error(
        { err, eventId: claimed.id, type: claimed.type },
        'Notification event failed to deliver',
      );
      await prisma.notificationEvent.update({
        where: { id: claimed.id },
        data: { attempts: { increment: 1 }, lastError: describeError(err) },
      });
      return { id: claimed.id, ok: false };
    }
  }

  return {
    /** Delivers every pending event. Returns how many were delivered and how many failed. */
    async dispatchPending() {
      const failed = [];
      let delivered = 0;
      for (;;) {
        const result = await dispatchOne(failed);
        if (result === null) return { delivered, failed: failed.length };
        if (result.ok) delivered += 1;
        else failed.push(result.id);
      }
    },

    /**
     * Deletes notifications older than 90 days, and delivered (or abandoned) events older
     * than 7 days. Events still pending are kept whatever their age.
     */
    async cleanup(now = new Date()) {
      const notifications = await prisma.notification.deleteMany({
        where: { createdAt: { lt: new Date(now - NOTIFICATION_RETENTION_DAYS * DAY_MS) } },
      });
      const events = await prisma.notificationEvent.deleteMany({
        where: {
          createdAt: { lt: new Date(now - EVENT_RETENTION_DAYS * DAY_MS) },
          OR: [{ processedAt: { not: null } }, { attempts: { gte: MAX_EVENT_ATTEMPTS } }],
        },
      });
      return { notifications: notifications.count, events: events.count };
    },
  };
}

/**
 * Runs the dispatcher every NOTIFICATION_POLL_MS, and the cleanup once a day.
 *
 * This is a polling loop in the worker rather than a BullMQ job scheduler on purpose: the
 * events are in PostgreSQL, so delivery does not depend on Redis at all. A scheduler is stored
 * in Redis and silently stops if Redis is flushed or restarts without persistence (the E2E
 * setup, which empties Redis, showed exactly that). Several workers can poll at once: the row
 * locks in dispatchOne() keep each event to one of them.
 */
export function createNotificationWorker({ prisma, emails, logger, env }) {
  const dispatcher = createNotificationDispatcher({ prisma, emails, logger, env });
  let lastCleanup = 0;
  const poller = createPoller({
    name: 'notifications',
    intervalMs: env.NOTIFICATION_POLL_MS,
    logger,
    run: async () => {
      await dispatcher.dispatchPending();
      if (Date.now() - lastCleanup >= DAY_MS) {
        lastCleanup = Date.now();
        await dispatcher.cleanup();
      }
    },
  });
  return {
    dispatcher,
    /** Starts polling, with a first pass right away for events left from before a restart. */
    async start() {
      poller.start();
    },
    /** Stops polling and waits for the pass in progress to finish. */
    close: () => poller.close(),
  };
}
