import request from 'supertest';
import { createTestApp, resetState } from './helpers/testApp.js';
import {
  organizationWithAllRoles,
  productInput,
  setSubscription,
  signIn,
} from './helpers/factories.js';
import { createFakeStripe } from './helpers/fakeStripe.js';

const PRICES = {
  starter: 'price_test_starter',
  growth: 'price_test_growth',
  scale: 'price_test_scale',
};

let ctx;
let stripe;
let org;
let owner;

beforeAll(async () => {
  stripe = createFakeStripe();
  ctx = await createTestApp({ billing: stripe.provider });
  for (const [code, price] of Object.entries(PRICES)) {
    await ctx.prisma.subscriptionPlan.update({ where: { code }, data: { providerPriceId: price } });
  }
});
afterAll(async () => {
  // Plans are shared reference data: leave them as the migration made them.
  await ctx.prisma.subscriptionPlan.updateMany({ data: { providerPriceId: null } });
  await ctx.close();
});
beforeEach(async () => {
  await resetState(ctx);
  stripe.calls.length = 0;
  stripe.state.subscriptions.clear();
  stripe.state.invoices.clear();
  org = await organizationWithAllRoles(ctx.app, ctx.prisma);
  owner = org.members.OWNER.client;
});

const subscriptionRow = () =>
  ctx.prisma.subscription.findUnique({ where: { organizationId: org.organization.id } });
const deliver = ({ payload, signature }) =>
  request(ctx.app)
    .post('/api/v1/subscriptions/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', signature)
    .send(payload);

/** Links the organization to a Stripe customer, as a first checkout does. */
async function linkCustomer(customer = 'cus_test_1') {
  await ctx.prisma.subscription.update({
    where: { organizationId: org.organization.id },
    data: { provider: 'stripe', providerCustomerId: customer },
  });
  return customer;
}
/** The organization completes Checkout for `plan`: Stripe sends checkout.session.completed. */
async function completeCheckout(plan = 'growth', status = 'active') {
  const customer = await linkCustomer();
  stripe.setSubscription('sub_test_1', {
    customer,
    organizationId: org.organization.id,
    status,
    price: PRICES[plan],
  });
  return deliver(
    stripe.signedEvent('checkout.session.completed', {
      id: 'cs_test_1',
      object: 'checkout.session',
      mode: 'subscription',
      client_reference_id: org.organization.id,
      customer,
      subscription: 'sub_test_1',
      payment_status: 'paid',
    }),
  );
}

describe('checkout', () => {
  test('creates a customer once and a subscription Checkout for the chosen plan', async () => {
    const res = await owner.post('/subscriptions/checkout', { plan: 'scale' });
    expect(res.status).toBe(200);
    expect(res.body.data.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    const customer = stripe.calls.find((c) => c.name === 'customers.create');
    expect(customer.params).toMatchObject({
      name: org.organization.name,
      email: org.members.OWNER.user.email,
      metadata: { organizationId: org.organization.id },
    });
    expect(customer.options.idempotencyKey).toBe(`vendora-customer-${org.organization.id}`);

    const session = stripe.calls.find((c) => c.name === 'checkout.sessions.create').params;
    expect(session).toMatchObject({
      mode: 'subscription',
      customer: 'cus_test_1',
      client_reference_id: org.organization.id,
      line_items: [{ price: PRICES.scale, quantity: 1 }],
      subscription_data: { metadata: { organizationId: org.organization.id } },
      success_url: `${ctx.env.APP_URL}/settings/billing?checkout=success`,
    });
    // Payment methods come from the Dashboard settings, never from a hard-coded list.
    expect(session).not.toHaveProperty('payment_method_types');
    expect(session.integration_identifier).toMatch(/^vendora-plan-checkout-[a-z]{8}$/);
    // 14 days of trial left: they are kept, billing starts when the trial ends.
    const trial = await subscriptionRow();
    expect(session.subscription_data.trial_end).toBe(Math.floor(trial.trialEndsAt / 1000));

    // Starting checkout changes nothing yet: only a verified webhook does.
    expect(trial).toMatchObject({ status: 'TRIALING', providerCustomerId: 'cus_test_1' });
    await owner.post('/subscriptions/checkout', { plan: 'scale' });
    expect(stripe.calls.filter((c) => c.name === 'customers.create')).toHaveLength(1);
  });

  test('an ended trial pays straight away, and checkout is open while read-only', async () => {
    await setSubscription(ctx.prisma, org.organization.id, { plan: 'growth', status: 'EXPIRED' });
    const res = await owner.post('/subscriptions/checkout', { plan: 'starter' });
    expect(res.status).toBe(200);
    const session = stripe.calls.find((c) => c.name === 'checkout.sessions.create').params;
    expect(session.subscription_data).not.toHaveProperty('trial_end');
  });

  test('refuses unknown plans, plans not on sale, and a second subscription', async () => {
    expect((await owner.post('/subscriptions/checkout', { plan: 'platinum' })).status).toBe(400);
    await ctx.prisma.subscriptionPlan.update({
      where: { code: 'starter' },
      data: { providerPriceId: null },
    });
    const notOnSale = await owner.post('/subscriptions/checkout', { plan: 'starter' });
    await ctx.prisma.subscriptionPlan.update({
      where: { code: 'starter' },
      data: { providerPriceId: PRICES.starter },
    });
    expect(notOnSale.status).toBe(503);

    await completeCheckout('growth');
    const again = await owner.post('/subscriptions/checkout', { plan: 'scale' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('MANAGE_IN_PORTAL');
  });

  test('the portal opens for an organization with a billing account', async () => {
    expect((await owner.post('/subscriptions/portal')).status).toBe(409);
    await linkCustomer();
    const res = await owner.post('/subscriptions/portal');
    expect(res.body.data.url).toMatch(/^https:\/\/billing\.stripe\.com\//);
    expect(stripe.calls.find((c) => c.name === 'billingPortal.sessions.create').params).toEqual({
      customer: 'cus_test_1',
      return_url: `${ctx.env.APP_URL}/settings/billing`,
    });
  });

  test('without a provider, buying answers 503 and the webhook does not exist', async () => {
    const off = await createTestApp({ prisma: ctx.prisma, redis: ctx.redis });
    try {
      const signedIn = await signIn(off.app, org.members.OWNER.user);
      const res = await signedIn.post('/subscriptions/checkout', { plan: 'growth' });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('BILLING_UNAVAILABLE');
      const hook = await request(off.app).post('/api/v1/subscriptions/webhooks/stripe').send('{}');
      expect(hook.status).toBe(404);
    } finally {
      await off.close();
    }
  });
});

describe('webhooks', () => {
  test('a forged or unsigned event is refused and changes nothing', async () => {
    const forged = stripe.signedEvent(
      'checkout.session.completed',
      { mode: 'subscription', client_reference_id: org.organization.id, subscription: 'sub_x' },
      { secret: 'whsec_attackerssecret' },
    );
    expect((await deliver(forged)).status).toBe(400);
    const unsigned = await request(ctx.app)
      .post('/api/v1/subscriptions/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(forged.payload);
    expect(unsigned.status).toBe(400);
    // A valid signature over a different body is refused too.
    const valid = stripe.signedEvent('customer.subscription.updated', { id: 'sub_test_1' });
    const tampered = await deliver({ payload: forged.payload, signature: valid.signature });
    expect(tampered.status).toBe(400);

    expect(await subscriptionRow()).toMatchObject({
      status: 'TRIALING',
      providerSubscriptionId: null,
    });
    expect(await ctx.prisma.webhookEvent.count()).toBe(0);
  });

  test('a completed checkout activates the plan the subscription is for, once', async () => {
    const res = await completeCheckout('scale');
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('processed');
    expect(await subscriptionRow()).toMatchObject({
      status: 'ACTIVE',
      provider: 'stripe',
      providerSubscriptionId: 'sub_test_1',
      cancelAtPeriodEnd: false,
    });
    const plan = await ctx.prisma.subscriptionPlan.findUnique({ where: { code: 'scale' } });
    expect((await subscriptionRow()).planId).toBe(plan.id);
    // The new limits apply at once.
    const current = await owner.get('/subscriptions/current');
    expect(current.body.data).toMatchObject({
      status: 'ACTIVE',
      plan: { code: 'scale' },
      billedByProvider: true,
    });
    const audits = await ctx.prisma.auditLog.findMany({
      where: { action: 'subscription.changed' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ from: 'TRIALING', to: 'ACTIVE', plan: 'scale' });
  });

  test('a replayed event is recognised and not applied twice', async () => {
    const event = stripe.signedEvent(
      'customer.subscription.updated',
      { id: 'sub_test_1', object: 'subscription' },
      { id: 'evt_replayed' },
    );
    await linkCustomer();
    stripe.setSubscription('sub_test_1', {
      customer: 'cus_test_1',
      organizationId: org.organization.id,
      status: 'active',
      price: PRICES.growth,
    });
    expect((await deliver(event)).body.result).toBe('processed');
    const replays = await Promise.all([deliver(event), deliver(event), deliver(event)]);
    expect(replays.map((r) => r.body.result)).toEqual(['duplicate', 'duplicate', 'duplicate']);
    expect(await ctx.prisma.webhookEvent.findMany()).toMatchObject([
      { eventId: 'evt_replayed', status: 'PROCESSED', attempts: 1 },
    ]);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'subscription.changed' } })).toBe(1);
  });

  test('a failed payment never activates: an incomplete first payment changes nothing', async () => {
    await linkCustomer();
    stripe.setSubscription('sub_test_1', {
      customer: 'cus_test_1',
      organizationId: org.organization.id,
      status: 'incomplete',
      price: PRICES.scale,
    });
    stripe.setInvoice('in_test_1', {
      customer: 'cus_test_1',
      subscription: 'sub_test_1',
      amount: 19900,
      status: 'open',
    });
    // The event claims success in its payload; the handler believes only the API.
    const res = await deliver(
      stripe.signedEvent('invoice.payment_failed', {
        id: 'in_test_1',
        object: 'invoice',
        customer: 'cus_test_1',
        status: 'paid',
      }),
    );
    expect(res.status).toBe(200);
    expect(await subscriptionRow()).toMatchObject({
      status: 'TRIALING',
      providerSubscriptionId: null,
    });
    expect(await ctx.prisma.billingInvoice.findFirst()).toMatchObject({
      status: 'open',
      amountDue: expect.anything(),
    });
  });

  test('a failed renewal makes it past due (still usable), and the end of retries read-only', async () => {
    await completeCheckout('growth');
    stripe.setSubscription('sub_test_1', {
      customer: 'cus_test_1',
      organizationId: org.organization.id,
      status: 'past_due',
      price: PRICES.growth,
    });
    stripe.setInvoice('in_test_2', {
      customer: 'cus_test_1',
      subscription: 'sub_test_1',
      amount: 7900,
      status: 'open',
    });
    await deliver(
      stripe.signedEvent('invoice.payment_failed', { id: 'in_test_2', object: 'invoice' }),
    );
    expect((await subscriptionRow()).status).toBe('PAST_DUE');
    expect((await owner.post('/products', productInput())).status).toBe(201);

    stripe.setSubscription('sub_test_1', {
      customer: 'cus_test_1',
      organizationId: org.organization.id,
      status: 'unpaid',
      price: PRICES.growth,
    });
    await deliver(
      stripe.signedEvent('customer.subscription.updated', {
        id: 'sub_test_1',
        object: 'subscription',
      }),
    );
    expect((await subscriptionRow()).status).toBe('CANCELED');
    const refused = await owner.post('/products', productInput());
    expect(refused.status).toBe(402);
    expect(refused.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
  });

  test('events out of order still leave the latest state', async () => {
    await completeCheckout('growth');
    // Stripe now says canceled; an older "active" update arrives after the deletion.
    stripe.setSubscription('sub_test_1', {
      customer: 'cus_test_1',
      organizationId: org.organization.id,
      status: 'canceled',
      price: PRICES.growth,
    });
    const deleted = stripe.signedEvent('customer.subscription.deleted', {
      id: 'sub_test_1',
      object: 'subscription',
      status: 'canceled',
    });
    const olderUpdate = stripe.signedEvent('customer.subscription.updated', {
      id: 'sub_test_1',
      object: 'subscription',
      status: 'active',
    });
    await deliver(deleted);
    await deliver(olderUpdate);
    expect((await subscriptionRow()).status).toBe('CANCELED');
  });

  test('an old subscription ending does not cancel the one that replaced it', async () => {
    await completeCheckout('growth');
    await ctx.prisma.subscription.update({
      where: { organizationId: org.organization.id },
      data: { providerSubscriptionId: 'sub_test_new' },
    });
    // sub_test_1 is the earlier subscription; Stripe reports it canceled.
    stripe.setSubscription('sub_test_1', {
      customer: 'cus_test_1',
      organizationId: org.organization.id,
      status: 'canceled',
      price: PRICES.growth,
    });
    await deliver(
      stripe.signedEvent('customer.subscription.deleted', {
        id: 'sub_test_1',
        object: 'subscription',
      }),
    );
    expect(await subscriptionRow()).toMatchObject({
      status: 'ACTIVE',
      providerSubscriptionId: 'sub_test_new',
    });
  });

  test("a subscription naming another organization cannot move this one's plan", async () => {
    const other = await organizationWithAllRoles(ctx.app, ctx.prisma);
    await linkCustomer();
    stripe.setSubscription('sub_test_1', {
      customer: 'cus_test_1',
      organizationId: other.organization.id,
      status: 'active',
      price: PRICES.scale,
    });
    const res = await deliver(
      stripe.signedEvent('customer.subscription.created', {
        id: 'sub_test_1',
        object: 'subscription',
      }),
    );
    expect(res.status).toBe(200);
    expect((await subscriptionRow()).status).toBe('TRIALING');
    const theirs = await ctx.prisma.subscription.findUnique({
      where: { organizationId: other.organization.id },
    });
    expect(theirs.status).toBe('TRIALING');
  });

  test('events from the other mode (live vs test) are ignored', async () => {
    await linkCustomer();
    stripe.setSubscription('sub_test_1', {
      customer: 'cus_test_1',
      organizationId: org.organization.id,
      status: 'active',
      price: PRICES.scale,
    });
    const res = await deliver(
      stripe.signedEvent(
        'customer.subscription.created',
        { id: 'sub_test_1', object: 'subscription' },
        { livemode: true },
      ),
    );
    expect(res.body.result).toBe('ignored');
    expect((await subscriptionRow()).status).toBe('TRIALING');
  });

  test('a processing failure answers 500 so Stripe retries, and the retry succeeds', async () => {
    await linkCustomer();
    stripe.setSubscription('sub_test_1', {
      customer: 'cus_test_1',
      organizationId: org.organization.id,
      status: 'active',
      price: PRICES.growth,
    });
    stripe.state.failNext = Object.assign(new Error('Stripe API unavailable'), { statusCode: 503 });
    const event = stripe.signedEvent('customer.subscription.created', {
      id: 'sub_test_1',
      object: 'subscription',
    });
    expect((await deliver(event)).status).toBe(500);
    expect(await ctx.prisma.webhookEvent.findFirst()).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lastError: 'Stripe API unavailable',
    });
    expect((await subscriptionRow()).status).toBe('TRIALING');

    expect((await deliver(event)).body.result).toBe('processed');
    expect(await ctx.prisma.webhookEvent.findFirst()).toMatchObject({
      status: 'PROCESSED',
      attempts: 2,
    });
    expect((await subscriptionRow()).status).toBe('ACTIVE');
  });
});

describe('billing history', () => {
  test('paid invoices are listed for the owner, in the organization only', async () => {
    await completeCheckout('growth');
    stripe.setInvoice('in_test_3', {
      customer: 'cus_test_1',
      subscription: 'sub_test_1',
      amount: 7900,
      number: 'VEN-0001',
    });
    await deliver(stripe.signedEvent('invoice.paid', { id: 'in_test_3', object: 'invoice' }));
    // The same invoice again (finalized, then paid) updates the one row.
    await deliver(stripe.signedEvent('invoice.finalized', { id: 'in_test_3', object: 'invoice' }));

    const res = await owner.get('/subscriptions/invoices');
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({
      number: 'VEN-0001',
      status: 'paid',
      currency: 'USD',
      amountDue: '79.00',
      amountPaid: '79.00',
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_test_3',
    });

    const other = await organizationWithAllRoles(ctx.app, ctx.prisma);
    expect((await other.members.OWNER.client.get('/subscriptions/invoices')).body.meta.total).toBe(
      0,
    );
    expect((await org.members.MANAGER.client.get('/subscriptions/invoices')).status).toBe(403);
  });
});
