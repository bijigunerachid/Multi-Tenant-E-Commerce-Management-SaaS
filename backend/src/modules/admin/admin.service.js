import { Prisma } from '@prisma/client';
import { AppError, conflict, notFound } from '../../utils/errors.js';
import { recordAudit } from '../../utils/audit.js';
import { formatMoney } from '../../utils/money.js';
import { usage } from '../billing/limits.js';
import { effectiveStatus } from '../billing/subscription.js';
import { presentInvoice } from '../billing/billing.service.js';

// Platform administration: Vendora staff looking after every organization.
// - Uses the unscoped client on purpose (it works across organizations); every query that is
//   about one organization filters on its id explicitly.
// - Every change is audited in the organization's own audit log, with the admin as actor and
//   the reason given, so the organization's owner can see what support did.
// - Reading an organization's audit log is itself audited, with its reason.
// - No impersonation: admins never act inside an organization as one of its members.

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_TRIAL_DAYS = 90;
const escapeLike = (value) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

// The effective subscription status in SQL: a trial past its end is expired.
const EFFECTIVE_STATUS = Prisma.sql`(CASE WHEN s.status = 'TRIALING' AND s.trial_ends_at <= now()
  THEN 'EXPIRED' ELSE s.status::text END)`;

const validation = (fieldErrors) =>
  new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid', { fieldErrors });

export function createAdminService({ prisma }) {
  async function loadOrganization(organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: { subscription: { include: { plan: true } } },
    });
    if (!organization) throw notFound('Organization not found');
    return organization;
  }

  function presentSubscription(sub) {
    if (!sub) return null;
    return {
      status: effectiveStatus(sub),
      storedStatus: sub.status,
      plan: {
        code: sub.plan.code,
        name: sub.plan.name,
        priceMonthly: formatMoney(sub.plan.priceMonthly),
      },
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      provider: sub.provider,
      providerCustomerId: sub.providerCustomerId,
      providerSubscriptionId: sub.providerSubscriptionId,
      billedByProvider:
        Boolean(sub.providerSubscriptionId) &&
        ['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(effectiveStatus(sub)),
    };
  }

  return {
    async stats() {
      const since = new Date(Date.now() - 30 * DAY_MS);
      const soon = new Date(Date.now() + 7 * DAY_MS);
      const [orgs, users, byStatus, byPlan, mrr, trialsEndingSoon, failedWebhooks] =
        await Promise.all([
          prisma.$queryRaw`
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
                   COUNT(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
                   COUNT(*) FILTER (WHERE created_at >= ${since})::int AS "createdLast30Days"
            FROM organizations`,
          prisma.$queryRaw`
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE created_at >= ${since})::int AS "createdLast30Days"
            FROM users`,
          prisma.$queryRaw`
            SELECT ${EFFECTIVE_STATUS} AS status, COUNT(*)::int AS count
            FROM subscriptions s GROUP BY 1`,
          prisma.$queryRaw`
            SELECT p.code, p.name, COUNT(*)::int AS count
            FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
            WHERE ${EFFECTIVE_STATUS} IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
            GROUP BY p.code, p.name, p.position ORDER BY p.position`,
          // Monthly recurring revenue: subscriptions paid through the provider. Complimentary
          // plans (ACTIVE without a provider subscription) and trials bring no revenue.
          prisma.$queryRaw`
            SELECT p.currency, SUM(p.price_monthly) AS amount, COUNT(*)::int AS subscriptions
            FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
            WHERE s.status IN ('ACTIVE', 'PAST_DUE') AND s.provider_subscription_id IS NOT NULL
            GROUP BY p.currency ORDER BY p.currency`,
          prisma.subscription.count({
            where: { status: 'TRIALING', trialEndsAt: { gt: new Date(), lte: soon } },
          }),
          prisma.webhookEvent.count({ where: { status: 'FAILED' } }),
        ]);
      return {
        organizations: orgs[0],
        users: users[0],
        subscriptionsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
        subscriptionsByPlan: byPlan,
        monthlyRecurringRevenue: mrr.map((r) => ({
          currency: r.currency,
          amount: formatMoney(r.amount),
          subscriptions: r.subscriptions,
        })),
        trialsEndingIn7Days: trialsEndingSoon,
        failedWebhooks,
      };
    },

    async listOrganizations({ search, status, subscription, plan, page, pageSize }) {
      const conditions = [Prisma.sql`TRUE`];
      if (status) conditions.push(Prisma.sql`o.status = ${status}::organization_status`);
      if (subscription) conditions.push(Prisma.sql`${EFFECTIVE_STATUS} = ${subscription}`);
      if (plan) conditions.push(Prisma.sql`p.code = ${plan}`);
      if (search) {
        const pattern = `%${escapeLike(search)}%`;
        conditions.push(Prisma.sql`(o.name ILIKE ${pattern} OR o.slug ILIKE ${pattern}
          OR EXISTS (SELECT 1 FROM organization_memberships m JOIN users u ON u.id = m.user_id
                     WHERE m.organization_id = o.id AND u.email ILIKE ${pattern}))`);
      }
      const where = Prisma.join(conditions, ' AND ');
      const from = Prisma.sql`
        FROM organizations o
        LEFT JOIN subscriptions s ON s.organization_id = o.id
        LEFT JOIN subscription_plans p ON p.id = s.plan_id`;
      const [rows, [{ total }]] = await Promise.all([
        prisma.$queryRaw`
          SELECT o.id, o.name, o.slug, o.status, o.created_at AS "createdAt",
                 p.code AS "planCode", p.name AS "planName", ${EFFECTIVE_STATUS} AS "subscriptionStatus",
                 s.trial_ends_at AS "trialEndsAt",
                 (SELECT COUNT(*)::int FROM organization_memberships m
                   WHERE m.organization_id = o.id AND m.status = 'ACTIVE') AS "memberCount",
                 (SELECT json_build_object('name', u.name, 'email', u.email)
                    FROM organization_memberships m JOIN users u ON u.id = m.user_id
                   WHERE m.organization_id = o.id AND m.role = 'OWNER' AND m.status = 'ACTIVE'
                   LIMIT 1) AS owner
          ${from}
          WHERE ${where}
          ORDER BY o.created_at DESC, o.id
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        prisma.$queryRaw`SELECT COUNT(*)::int AS total ${from} WHERE ${where}`,
      ]);
      return { data: rows, meta: { page, pageSize, total } };
    },

    async getOrganization(organizationId) {
      const organization = await loadOrganization(organizationId);
      const [members, counts, invoices, failedWebhooks] = await Promise.all([
        prisma.organizationMembership.findMany({
          where: { organizationId },
          include: { user: { select: { name: true, email: true, status: true } } },
          orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        }),
        usage(prisma, organizationId),
        prisma.billingInvoice.findMany({
          where: { organizationId },
          orderBy: { issuedAt: 'desc' },
          take: 5,
        }),
        prisma.webhookEvent.count({ where: { organizationId, status: 'FAILED' } }),
      ]);
      const [{ orders }] = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS orders FROM orders
        WHERE organization_id = ${organizationId}::uuid AND status <> 'DRAFT'`;
      return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        suspendedAt: organization.suspendedAt,
        suspendedReason: organization.suspendedReason,
        defaultCurrency: organization.defaultCurrency,
        timezone: organization.timezone,
        contactEmail: organization.contactEmail,
        createdAt: organization.createdAt,
        subscription: presentSubscription(organization.subscription),
        usage: { ...counts, orders },
        members: members.map((m) => ({
          id: m.id,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          status: m.status,
          userStatus: m.user.status,
          joinedAt: m.createdAt,
        })),
        recentInvoices: invoices.map(presentInvoice),
        failedWebhooks,
      };
    },

    async setStatus(req, organizationId, { status, reason }) {
      const organization = await loadOrganization(organizationId);
      if (organization.status === status) {
        throw conflict(
          status === 'SUSPENDED' ? 'ALREADY_SUSPENDED' : 'NOT_SUSPENDED',
          status === 'SUSPENDED'
            ? 'This organization is already suspended'
            : 'This organization is not suspended',
        );
      }
      await prisma.$transaction(async (tx) => {
        await tx.organization.update({
          where: { id: organizationId },
          data:
            status === 'SUSPENDED'
              ? { status, suspendedAt: new Date(), suspendedReason: reason }
              : { status, suspendedAt: null, suspendedReason: null },
        });
        await recordAudit(tx, req, {
          organizationId,
          action:
            status === 'SUSPENDED'
              ? 'admin.organization_suspended'
              : 'admin.organization_reactivated',
          entityType: 'Organization',
          entityId: organizationId,
          metadata: { reason },
        });
      });
      return this.getOrganization(organizationId);
    },

    /**
     * Moves an organization that does not pay through the provider to another plan or state:
     * extend a trial, give a complimentary plan (ACTIVE without a provider subscription), or
     * end access (CANCELED). Subscriptions billed by Stripe change in Stripe only, so Vendora
     * and the invoices never disagree.
     */
    async changeSubscription(req, organizationId, { plan: planCode, status, trialEndsAt, reason }) {
      const organization = await loadOrganization(organizationId);
      const current = organization.subscription;
      const view = presentSubscription(current);
      if (view?.billedByProvider) {
        throw conflict(
          'BILLED_BY_PROVIDER',
          'This organization pays through Stripe. Change its subscription in the Stripe Dashboard; Vendora follows through the webhook.',
        );
      }
      const plan = await prisma.subscriptionPlan.findUnique({ where: { code: planCode } });
      if (!plan) throw validation({ plan: 'Choose one of the plans' });
      if (status === 'TRIALING') {
        const end = trialEndsAt ? new Date(trialEndsAt) : null;
        if (!end || end <= new Date())
          throw validation({ trialEndsAt: 'Choose a date in the future' });
        if (end - Date.now() > MAX_TRIAL_DAYS * DAY_MS) {
          throw validation({
            trialEndsAt: `A trial can last at most ${MAX_TRIAL_DAYS} days from today`,
          });
        }
      }
      const data = {
        planId: plan.id,
        status,
        trialEndsAt: status === 'TRIALING' ? new Date(trialEndsAt) : (current?.trialEndsAt ?? null),
        // A complimentary or canceled plan has no billing period.
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      };
      await prisma.$transaction(async (tx) => {
        if (current) {
          await tx.subscription.update({ where: { id: current.id }, data });
        } else {
          await tx.subscription.create({ data: { organizationId, ...data } });
        }
        await recordAudit(tx, req, {
          organizationId,
          action: 'admin.subscription_changed',
          entityType: 'Subscription',
          entityId: current?.id ?? null,
          metadata: {
            reason,
            from: view
              ? { plan: view.plan.code, status: view.status, trialEndsAt: view.trialEndsAt }
              : null,
            to: { plan: plan.code, status, trialEndsAt: data.trialEndsAt },
          },
        });
      });
      return this.getOrganization(organizationId);
    },

    /** An organization's audit log, for support. The access is audited with its reason. */
    async auditLogs(req, organizationId, { reason, page, pageSize }) {
      await loadOrganization(organizationId);
      await recordAudit(prisma, req, {
        organizationId,
        action: 'admin.audit_viewed',
        entityType: 'Organization',
        entityId: organizationId,
        metadata: { reason, page },
      });
      const where = { organizationId };
      const [rows, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.auditLog.count({ where }),
      ]);
      const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))];
      const actors = await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      });
      const byId = new Map(actors.map((a) => [a.id, a]));
      return {
        data: rows.map((r) => ({
          id: r.id,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          metadata: r.metadata,
          actor: r.actorUserId ? (byId.get(r.actorUserId) ?? { id: r.actorUserId }) : null,
          ip: r.ip,
          createdAt: r.createdAt,
        })),
        meta: { page, pageSize, total },
      };
    },
  };
}
