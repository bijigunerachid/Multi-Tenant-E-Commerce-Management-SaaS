import { AppError, conflict, isUniqueViolation } from '../../utils/errors.js';
import { recordAudit } from '../../utils/audit.js';
import { formatMoney } from '../../utils/money.js';

// Buying and managing a plan through the payment provider (docs/architecture.md, "Payments").
//
// The subscription changes only here, from verified webhooks: never from the browser coming
// back from Checkout. Each webhook is stored by event id and applied under a row lock, so a
// replay or a duplicate delivery is a no-op. The handler reads the subscription and invoice
// back from the provider, so events arriving out of order still leave the latest state.

const DAY_MS = 24 * 60 * 60 * 1000;
// Stripe Checkout needs a trial end at least 48 hours away; closer than that, no trial is kept.
const MIN_TRIAL_LEFT_MS = 2 * DAY_MS + 60 * 60 * 1000;

// Provider status → Vendora status. Not listed (incomplete, incomplete_expired): the first
// payment has not gone through, so the organization keeps what it had.
const STATUS = {
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  unpaid: 'CANCELED',
  canceled: 'CANCELED',
  paused: 'CANCELED',
};
const USABLE = new Set(['TRIALING', 'ACTIVE', 'PAST_DUE']);

const billingUnavailable = () =>
  new AppError(503, 'BILLING_UNAVAILABLE', 'Payments are not set up on this server yet.');

export function presentInvoice(inv) {
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    currency: inv.currency,
    amountDue: formatMoney(inv.amountDue),
    amountPaid: formatMoney(inv.amountPaid),
    periodStart: inv.periodStart,
    periodEnd: inv.periodEnd,
    hostedInvoiceUrl: inv.hostedInvoiceUrl,
    invoicePdfUrl: inv.invoicePdfUrl,
    issuedAt: inv.issuedAt,
  };
}

export function createBillingService({ prisma, billing: provider, env, logger }) {
  const loadSubscription = (db) =>
    db.organization
      .findFirstOrThrow({ select: { name: true, subscription: true } })
      .then((o) => ({ organizationName: o.name, subscription: o.subscription }));

  /** True when the provider already bills this organization (changes go through the portal). */
  const billedByProvider = (sub) => Boolean(sub?.providerSubscriptionId) && USABLE.has(sub.status);

  async function syncSubscription(tx, subscriptionId) {
    const remote = await provider.getSubscription(subscriptionId);
    const local =
      (await tx.subscription.findUnique({ where: { providerSubscriptionId: remote.id } })) ??
      (remote.customerId
        ? await tx.subscription.findFirst({ where: { providerCustomerId: remote.customerId } })
        : null);
    if (!local) {
      logger.warn(
        { subscriptionId: remote.id },
        'Webhook for a subscription Vendora does not know',
      );
      return null;
    }
    // The organization recorded with the subscription must be the one it is linked to here.
    if (remote.organizationId && remote.organizationId !== local.organizationId) {
      logger.error(
        { subscriptionId: remote.id, organizationId: local.organizationId },
        'Subscription metadata names another organization; ignored',
      );
      return null;
    }
    const status = STATUS[remote.status];
    if (!status) return local.organizationId;
    // An older subscription ending does not cancel the one that replaced it.
    if (
      local.providerSubscriptionId &&
      local.providerSubscriptionId !== remote.id &&
      USABLE.has(local.status) &&
      !USABLE.has(status)
    ) {
      return local.organizationId;
    }
    const plan = await tx.subscriptionPlan.findFirst({
      where: { providerPriceId: remote.priceId },
    });
    if (!plan) throw new Error(`No plan uses the price ${remote.priceId}`);

    const updated = await tx.subscription.update({
      where: { id: local.id },
      data: {
        planId: plan.id,
        status,
        // Kept after a trial ends so the history shows when it ended; required while trialing.
        trialEndsAt: status === 'TRIALING' ? remote.trialEnd : local.trialEndsAt,
        currentPeriodEnd: remote.currentPeriodEnd,
        cancelAtPeriodEnd: remote.cancelAtPeriodEnd,
        provider: provider.name,
        providerCustomerId: remote.customerId,
        providerSubscriptionId: remote.id,
      },
    });
    if (updated.status !== local.status || updated.planId !== local.planId) {
      await tx.auditLog.create({
        data: {
          organizationId: local.organizationId,
          action: 'subscription.changed',
          entityType: 'Subscription',
          entityId: local.id,
          metadata: { from: local.status, to: status, plan: plan.code, source: provider.name },
        },
      });
    }
    return local.organizationId;
  }

  async function syncInvoice(tx, invoiceId) {
    const inv = await provider.getInvoice(invoiceId);
    const local =
      (inv.subscriptionId &&
        (await tx.subscription.findUnique({
          where: { providerSubscriptionId: inv.subscriptionId },
        }))) ||
      (await tx.subscription.findFirst({ where: { providerCustomerId: inv.customerId } }));
    if (!local) return null;
    const data = {
      organizationId: local.organizationId,
      number: inv.number,
      status: inv.status,
      currency: inv.currency,
      amountDue: inv.amountDue,
      amountPaid: inv.amountPaid,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      hostedInvoiceUrl: inv.hostedInvoiceUrl,
      invoicePdfUrl: inv.invoicePdfUrl,
      issuedAt: inv.issuedAt,
    };
    await tx.billingInvoice.upsert({
      where: {
        provider_providerInvoiceId: { provider: provider.name, providerInvoiceId: inv.id },
      },
      create: { provider: provider.name, providerInvoiceId: inv.id, ...data },
      update: data,
    });
    // A failed or recovered payment changes the subscription too (past due / active).
    if (inv.subscriptionId) await syncSubscription(tx, inv.subscriptionId);
    return local.organizationId;
  }

  async function apply(tx, event) {
    if (event.kind === 'checkout.completed' || event.kind === 'subscription.changed') {
      return event.subscriptionId ? syncSubscription(tx, event.subscriptionId) : null;
    }
    if (event.kind === 'invoice.changed') return syncInvoice(tx, event.invoiceId);
    return null;
  }

  return {
    enabled: Boolean(provider),

    async checkout(req, planCode) {
      if (!provider) throw billingUnavailable();
      const plan = await prisma.subscriptionPlan.findFirst({
        where: { code: planCode, isActive: true },
      });
      if (!plan) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid', {
          fieldErrors: { plan: 'Choose one of the plans' },
        });
      }
      if (!plan.providerPriceId) {
        throw new AppError(503, 'BILLING_UNAVAILABLE', `The ${plan.name} plan is not on sale yet.`);
      }
      const { organizationName, subscription } = await loadSubscription(req.db);
      if (billedByProvider(subscription)) {
        throw conflict(
          'MANAGE_IN_PORTAL',
          'This organization already has a paid plan. Change it from "Manage billing".',
        );
      }

      let customerId = subscription.providerCustomerId;
      if (!customerId) {
        customerId = await provider.createCustomer({
          organizationId: req.ctx.organizationId,
          name: organizationName,
          email: req.user.email,
        });
        await req.db.subscription.update({
          where: { id: subscription.id },
          data: { provider: provider.name, providerCustomerId: customerId },
        });
      }
      // Choosing a plan during the trial keeps the days left; billing starts when it ends.
      const left = subscription.status === 'TRIALING' ? subscription.trialEndsAt - Date.now() : 0;
      const session = await provider.createCheckoutSession({
        customerId,
        priceId: plan.providerPriceId,
        organizationId: req.ctx.organizationId,
        trialEnd: left >= MIN_TRIAL_LEFT_MS ? subscription.trialEndsAt : null,
        successUrl: `${env.APP_URL}/settings/billing?checkout=success`,
        cancelUrl: `${env.APP_URL}/settings/billing?checkout=canceled`,
      });
      await recordAudit(req.db, req, {
        action: 'billing.checkout_started',
        entityType: 'Subscription',
        entityId: subscription.id,
        metadata: { plan: plan.code, checkoutSessionId: session.id },
      });
      return { url: session.url };
    },

    async portal(req) {
      if (!provider) throw billingUnavailable();
      const { subscription } = await loadSubscription(req.db);
      if (!subscription.providerCustomerId) {
        throw conflict('NO_BILLING_ACCOUNT', 'Choose a plan first.');
      }
      return provider.createPortalSession({
        customerId: subscription.providerCustomerId,
        returnUrl: `${env.APP_URL}/settings/billing`,
      });
    },

    async listInvoices(req, { page, pageSize }) {
      const [rows, total] = await Promise.all([
        req.db.billingInvoice.findMany({
          orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        req.db.billingInvoice.count(),
      ]);
      return { data: rows.map(presentInvoice), meta: { page, pageSize, total } };
    },

    /**
     * Handles one webhook delivery. Returns 'processed', 'duplicate' or 'ignored'; throws
     * AppError 400 for a bad signature, and any other error so the provider retries.
     */
    async handleWebhook(rawBody, signature) {
      let event;
      try {
        event = provider.parseWebhook(rawBody, signature);
      } catch (err) {
        logger.warn({ err: { message: err.message } }, 'Webhook signature rejected');
        throw new AppError(400, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature');
      }

      try {
        await prisma.webhookEvent.create({
          data: { provider: provider.name, eventId: event.id, type: event.type },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }

      try {
        return await prisma.$transaction(
          async (tx) => {
            // Serialises concurrent deliveries of the same event.
            const [row] = await tx.$queryRaw`
              SELECT id, status FROM webhook_events
              WHERE provider = ${provider.name} AND event_id = ${event.id}
              FOR UPDATE`;
            if (row.status === 'PROCESSED') return 'duplicate';
            const organizationId = await apply(tx, event);
            await tx.webhookEvent.update({
              where: { id: row.id },
              data: {
                status: 'PROCESSED',
                processedAt: new Date(),
                attempts: { increment: 1 },
                lastError: null,
                organizationId,
              },
            });
            return event.kind === 'ignored' ? 'ignored' : 'processed';
          },
          // The handler calls the provider's API inside the transaction.
          { timeout: 30_000, maxWait: 10_000 },
        );
      } catch (err) {
        logger.error({ err, eventId: event.id, type: event.type }, 'Webhook processing failed');
        await prisma.webhookEvent
          .update({
            where: { provider_eventId: { provider: provider.name, eventId: event.id } },
            data: {
              status: 'FAILED',
              attempts: { increment: 1 },
              lastError: (err.message || String(err)).slice(0, 500),
            },
          })
          .catch(() => {});
        throw err;
      }
    },
  };
}
