/* eslint-disable no-console -- a command-line script: printing is its output. */
import Stripe from 'stripe';
import { loadEnv } from '../config/env.js';
import { createPrismaClient } from '../config/database.js';
import { PORTAL_CONFIGURATION_TAG, priceLookupKey } from '../services/billing/stripeProvider.js';

// `npm run stripe:setup -w backend`: puts Vendora's plans on sale in the Stripe account of
// STRIPE_SECRET_KEY, and records each plan's price id in the database. Safe to run again:
// - one product per plan, with a fixed id (vendora_<code>);
// - one monthly price per plan, found by its lookup key. A plan whose price changed gets a
//   new price that takes over the lookup key (existing subscribers keep their old price);
// - one Customer Portal configuration, tagged in its metadata, listing the plans so customers
//   can switch between them, update their card, see invoices and cancel at period end.
// Needs write access to Products, Prices and Customer Portal (a restricted key can be used).

const env = loadEnv();
if (!env.STRIPE_SECRET_KEY) {
  console.error('Set STRIPE_SECRET_KEY in backend/.env first.');
  process.exit(1);
}
const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const prisma = createPrismaClient({ databaseUrl: env.DATABASE_URL });
const mode = env.STRIPE_SECRET_KEY.includes('_live_') ? 'LIVE' : 'test';
const cents = (decimal) => Math.round(Number(decimal) * 100);

async function ensureProduct(plan) {
  const id = `vendora_${plan.code}`;
  const data = { name: `Vendora ${plan.name}`, metadata: { plan: plan.code } };
  try {
    const product = await stripe.products.retrieve(id);
    if (product.name !== data.name || !product.active) {
      await stripe.products.update(id, { ...data, active: true });
    }
    return id;
  } catch (err) {
    if (err.code !== 'resource_missing') throw err;
    await stripe.products.create({ id, ...data });
    return id;
  }
}

async function ensurePrice(plan, productId) {
  const lookupKey = priceLookupKey(plan.code);
  const amount = cents(plan.priceMonthly);
  const currency = plan.currency.toLowerCase();
  const { data } = await stripe.prices.list({ lookup_keys: [lookupKey], active: true });
  const current = data[0];
  if (
    current &&
    current.unit_amount === amount &&
    current.currency === currency &&
    current.recurring?.interval === 'month' &&
    current.product === productId
  ) {
    return { id: current.id, created: false };
  }
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: amount,
    currency,
    recurring: { interval: 'month' },
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    metadata: { plan: plan.code },
  });
  return { id: price.id, created: true };
}

async function ensurePortal(products) {
  const settings = {
    business_profile: { headline: 'Manage your Vendora plan' },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        products,
      },
    },
    metadata: { vendora: PORTAL_CONFIGURATION_TAG },
  };
  const { data } = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const existing = data.find((c) => c.metadata?.vendora === PORTAL_CONFIGURATION_TAG);
  if (existing) {
    await stripe.billingPortal.configurations.update(existing.id, settings);
    return { id: existing.id, created: false };
  }
  const created = await stripe.billingPortal.configurations.create(settings);
  return { id: created.id, created: true };
}

try {
  console.log(`Stripe ${mode} mode.`);
  const plans = await prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { position: 'asc' },
  });
  const portalProducts = [];
  for (const plan of plans) {
    const productId = await ensureProduct(plan);
    const price = await ensurePrice(plan, productId);
    await prisma.subscriptionPlan.update({
      where: { id: plan.id },
      data: { providerPriceId: price.id },
    });
    portalProducts.push({ product: productId, prices: [price.id] });
    console.log(
      `  ${plan.name.padEnd(8)} ${plan.priceMonthly.toFixed(2)} ${plan.currency}/month  ${price.id}${price.created ? ' (new)' : ''}`,
    );
  }
  const portal = await ensurePortal(portalProducts);
  console.log(`  Customer Portal configuration ${portal.id}${portal.created ? ' (new)' : ''}`);
  console.log('Done. Plans are on sale once BILLING_PROVIDER=stripe and the webhook is set up.');
} finally {
  await prisma.$disconnect();
}
