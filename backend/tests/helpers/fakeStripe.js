import Stripe from 'stripe';
import { createStripeProvider } from '../../src/services/billing/stripeProvider.js';

export const WEBHOOK_SECRET = 'whsec_testsecret123';

/**
 * A stand-in for the Stripe API client: records what Vendora asks for and serves the
 * subscriptions and invoices a test puts in `state`. Webhook signatures are made and checked
 * with the real SDK, so the provider's verification is the production code.
 */
export function createFakeStripe() {
  const calls = [];
  const state = { subscriptions: new Map(), invoices: new Map(), customers: 0 };
  const record = (name, params, options) => calls.push({ name, params, options });
  const missing = (kind, id) =>
    Object.assign(new Error(`No such ${kind}: '${id}'`), { type: 'StripeInvalidRequestError' });

  const client = {
    customers: {
      create: async (params, options) => {
        record('customers.create', params, options);
        state.customers += 1;
        return { id: `cus_test_${state.customers}` };
      },
    },
    checkout: {
      sessions: {
        create: async (params) => {
          record('checkout.sessions.create', params);
          return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' };
        },
      },
    },
    billingPortal: {
      configurations: { list: async () => ({ data: [] }) },
      sessions: {
        create: async (params) => {
          record('billingPortal.sessions.create', params);
          return { url: 'https://billing.stripe.com/p/session/test_1' };
        },
      },
    },
    subscriptions: {
      retrieve: async (id) => {
        record('subscriptions.retrieve', id);
        if (state.failNext) {
          const err = state.failNext;
          state.failNext = null;
          throw err;
        }
        if (!state.subscriptions.has(id)) throw missing('subscription', id);
        return structuredClone(state.subscriptions.get(id));
      },
    },
    invoices: {
      retrieve: async (id) => {
        record('invoices.retrieve', id);
        if (!state.invoices.has(id)) throw missing('invoice', id);
        return structuredClone(state.invoices.get(id));
      },
    },
  };

  const provider = createStripeProvider({
    secretKey: 'sk_test_fake',
    webhookSecret: WEBHOOK_SECRET,
    client,
  });

  /** A Stripe subscription object as the API returns it (API 2026-08-26.dahlia). */
  function setSubscription(id, { customer, organizationId, status, price, trialEnd, periodEnd }) {
    state.subscriptions.set(id, {
      id,
      object: 'subscription',
      customer,
      status,
      metadata: organizationId ? { organizationId } : {},
      cancel_at_period_end: false,
      trial_end: trialEnd ? Math.floor(trialEnd / 1000) : null,
      items: {
        data: [
          {
            price: { id: price },
            current_period_end: Math.floor((periodEnd ?? Date.now() + 30 * 86_400_000) / 1000),
          },
        ],
      },
    });
  }

  function setInvoice(id, { customer, subscription, amount, status = 'paid', number }) {
    state.invoices.set(id, {
      id,
      object: 'invoice',
      customer,
      number: number ?? `VEN-${id.slice(-4)}`,
      status,
      currency: 'usd',
      amount_due: amount,
      amount_paid: status === 'paid' ? amount : 0,
      period_start: 1_788_000_000,
      period_end: 1_790_592_000,
      created: 1_790_000_000,
      status_transitions: { finalized_at: 1_790_000_100 },
      hosted_invoice_url: `https://invoice.stripe.com/i/${id}`,
      invoice_pdf: `https://pay.stripe.com/invoice/${id}/pdf`,
      parent: subscription
        ? { type: 'subscription_details', subscription_details: { subscription } }
        : null,
    });
  }

  let eventCount = 0;
  /** A webhook body and a valid Stripe-Signature header for it. */
  function signedEvent(type, object, { id, livemode = false, secret = WEBHOOK_SECRET } = {}) {
    eventCount += 1;
    const payload = JSON.stringify({
      id: id ?? `evt_test_${eventCount}_${Date.now()}`,
      object: 'event',
      type,
      livemode,
      created: Math.floor(Date.now() / 1000),
      data: { object },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    return { payload, signature };
  }

  return { client, provider, calls, state, setSubscription, setInvoice, signedEvent };
}
