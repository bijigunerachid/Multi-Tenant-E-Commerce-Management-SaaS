import { AppError } from '../../utils/errors.js';
import { formatMoney } from '../../utils/money.js';

export const TRIAL_DAYS = 14;
/** New organizations try the middle plan, so they see what upgrading would give them. */
export const TRIAL_PLAN = 'growth';
const DAY_MS = 24 * 60 * 60 * 1000;

// Subscription states (docs/architecture.md, "Plans and limits"):
// - TRIALING, ACTIVE: full use within the plan's limits;
// - PAST_DUE: a payment failed; full use continues while the provider retries (grace period);
// - CANCELED, EXPIRED: read-only. Data stays visible and exportable, nothing can be changed
//   except what reduces usage or concerns access (see `whenInactive` on routes).
const USABLE = new Set(['TRIALING', 'ACTIVE', 'PAST_DUE']);

/**
 * The status that applies now. A trial past its end date is expired even before the hourly
 * job has written it, so access never depends on the job having run.
 */
export function effectiveStatus(subscription, now = new Date()) {
  if (!subscription) return 'EXPIRED';
  if (subscription.status === 'TRIALING' && subscription.trialEndsAt <= now) return 'EXPIRED';
  return subscription.status;
}

export const isUsable = (status) => USABLE.has(status);

/** What the request context carries about the organization's subscription. */
export function subscriptionContext(subscription, now = new Date()) {
  const status = effectiveStatus(subscription, now);
  return Object.freeze({
    status,
    usable: isUsable(status),
    planCode: subscription?.plan.code ?? null,
    planName: subscription?.plan.name ?? null,
    limits: subscription?.plan.limits ?? { stores: 0, members: 0, products: 0 },
    features: subscription?.plan.features ?? {},
    trialEndsAt: subscription?.trialEndsAt ?? null,
  });
}

/** Starts the trial of a new organization, inside its creation transaction. */
export async function startTrial(tx, organizationId, now = new Date()) {
  const plan = await tx.subscriptionPlan.findUniqueOrThrow({ where: { code: TRIAL_PLAN } });
  return tx.subscription.create({
    data: {
      organizationId,
      planId: plan.id,
      status: 'TRIALING',
      trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
    },
  });
}

export function presentPlan(plan) {
  return {
    code: plan.code,
    name: plan.name,
    priceMonthly: formatMoney(plan.priceMonthly),
    currency: plan.currency,
    limits: plan.limits,
    features: plan.features,
  };
}

/** 402 for a write while the subscription does not allow it. */
export const subscriptionInactive = (status) =>
  new AppError(
    402,
    'SUBSCRIPTION_INACTIVE',
    status === 'CANCELED'
      ? 'The subscription is canceled, so this organization is read-only. The owner can renew it in Billing.'
      : 'The trial has ended, so this organization is read-only. The owner can choose a plan in Billing.',
    { status },
  );

export const featureUnavailable = (feature, planName) =>
  new AppError(
    402,
    'PLAN_FEATURE_UNAVAILABLE',
    `${FEATURE_LABELS[feature] ?? feature} is not included in the ${planName ?? 'current'} plan.`,
    { feature },
  );

export const FEATURE_LABELS = { csvExport: 'CSV export' };
