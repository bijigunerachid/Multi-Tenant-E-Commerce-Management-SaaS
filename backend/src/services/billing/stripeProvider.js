import Stripe from 'stripe';
import { randomBytes } from 'node:crypto';

// The Stripe implementation of the billing provider interface (see ./index.js). Everything
// Stripe-specific stays in this file: the rest of the API sees plain objects.
//
// - API version: pinned by the SDK version (stripe@22.6.2 → 2026-08-26.dahlia).
// - Payment methods are not listed (no payment_method_types), so the ones enabled in the
//   Stripe Dashboard are offered.
// - Webhooks are verified with the signing secret on the raw request body; nothing in a
//   webhook payload is trusted beyond the ids it carries. Subscriptions and invoices are read
//   back from the API, so events arriving out of order or replayed still give the current state.

export const PORTAL_CONFIGURATION_TAG = 'plans-v1';
/** Stripe lookup key of a plan's monthly price. */
export const priceLookupKey = (planCode) => `vendora_${planCode}_monthly`;

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
]);
const INVOICE_EVENTS = new Set([
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.voided',
  'invoice.marked_uncollectible',
]);

const seconds = (value) => (value ? new Date(value * 1000) : null);
const idOf = (value) => (typeof value === 'string' ? value : (value?.id ?? null));

/** Stripe amounts are in the currency's minor unit (cents); returns a decimal string. */
export function fromMinorUnits(amount, currency) {
  const digits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).resolvedOptions().maximumFractionDigits;
  return (amount / 10 ** digits).toFixed(digits);
}

export function createStripeProvider({ secretKey, webhookSecret, client }) {
  // Tests pass a stand-in client; webhook signatures are always checked with the real SDK.
  const stripe = client ?? new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  const webhooks = Stripe.webhooks;
  // Events from the other mode (a live event reaching a test setup, or the reverse) are ignored.
  const livemode = /^(sk|rk)_live_/.test(secretKey ?? '');
  let portalConfiguration; // cached id of Vendora's Customer Portal configuration

  function presentSubscription(sub) {
    const item = sub.items?.data?.[0];
    return {
      id: sub.id,
      customerId: idOf(sub.customer),
      organizationId: sub.metadata?.organizationId ?? null,
      status: sub.status,
      priceId: idOf(item?.price),
      trialEnd: seconds(sub.trial_end),
      // Since API 2025-03-31 the billing period is on the subscription item.
      currentPeriodEnd: seconds(item?.current_period_end),
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    };
  }

  function presentInvoice(inv) {
    return {
      id: inv.id,
      customerId: idOf(inv.customer),
      subscriptionId: idOf(inv.parent?.subscription_details?.subscription),
      number: inv.number ?? null,
      status: inv.status,
      currency: inv.currency.toUpperCase(),
      amountDue: fromMinorUnits(inv.amount_due, inv.currency),
      amountPaid: fromMinorUnits(inv.amount_paid, inv.currency),
      periodStart: seconds(inv.period_start),
      periodEnd: seconds(inv.period_end),
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdfUrl: inv.invoice_pdf ?? null,
      issuedAt: seconds(inv.status_transitions?.finalized_at ?? inv.created),
    };
  }

  return {
    name: 'stripe',

    async createCustomer({ organizationId, name, email }) {
      const customer = await stripe.customers.create(
        { name, email, metadata: { organizationId } },
        // One customer per organization, even if the first request is retried.
        { idempotencyKey: `vendora-customer-${organizationId}` },
      );
      return customer.id;
    },

    async createCheckoutSession({
      customerId,
      priceId,
      organizationId,
      trialEnd,
      successUrl,
      cancelUrl,
    }) {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: organizationId,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: {
          metadata: { organizationId },
          ...(trialEnd ? { trial_end: Math.floor(trialEnd.getTime() / 1000) } : {}),
        },
        metadata: { organizationId },
        success_url: successUrl,
        cancel_url: cancelUrl,
        // Tags Vendora's sessions in the Dashboard (Stripe asks for a random 8-letter suffix).
        integration_identifier: `vendora-plan-checkout-${randomLetters(8)}`,
      });
      return { id: session.id, url: session.url };
    },

    async createPortalSession({ customerId, returnUrl }) {
      // The configuration made by `npm run stripe:setup` lists Vendora's plans; without it the
      // account's default configuration is used.
      if (portalConfiguration === undefined) {
        const configurations = await stripe.billingPortal.configurations.list({
          active: true,
          limit: 100,
        });
        portalConfiguration =
          configurations.data.find((c) => c.metadata?.vendora === PORTAL_CONFIGURATION_TAG)?.id ??
          null;
      }
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
        ...(portalConfiguration ? { configuration: portalConfiguration } : {}),
      });
      return { url: session.url };
    },

    /**
     * Verifies the signature and returns what the event is about, or throws. Kinds:
     * checkout.completed, subscription.changed, invoice.changed, ignored.
     */
    parseWebhook(rawBody, signature) {
      const event = webhooks.constructEvent(rawBody, signature, webhookSecret);
      const object = event.data?.object ?? {};
      let kind = 'ignored';
      if (event.livemode !== livemode) {
        kind = 'ignored';
      } else if (event.type === 'checkout.session.completed' && object.mode === 'subscription') {
        kind = 'checkout.completed';
      } else if (SUBSCRIPTION_EVENTS.has(event.type)) {
        kind = 'subscription.changed';
      } else if (INVOICE_EVENTS.has(event.type)) {
        kind = 'invoice.changed';
      }
      return {
        id: event.id,
        type: event.type,
        kind,
        livemode: event.livemode,
        organizationId: kind === 'checkout.completed' ? (object.client_reference_id ?? null) : null,
        customerId: idOf(object.customer),
        subscriptionId:
          kind === 'subscription.changed' ? object.id : idOf(object.subscription) || null,
        invoiceId: kind === 'invoice.changed' ? object.id : null,
      };
    },

    async getSubscription(id) {
      return presentSubscription(await stripe.subscriptions.retrieve(id));
    },

    async getInvoice(id) {
      return presentInvoice(await stripe.invoices.retrieve(id));
    },
  };
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
function randomLetters(n) {
  return [...randomBytes(n)].map((b) => LETTERS[b % LETTERS.length]).join('');
}
