import { presentPlan } from './subscription.js';
import { usage } from './limits.js';

// The organization's plan, status and usage, and the plans it could move to. Owners only
// (billing:read). Every member learns whether the organization is read-only from the session.

export function subscriptionRoutes() {
  return {
    basePath: '/subscriptions',
    routes: [
      {
        method: 'get',
        path: '/current',
        access: { permission: 'billing:read' },
        handler: async (req) => {
          const subscription = await req.db.organization
            .findFirstOrThrow({ select: { subscription: { include: { plan: true } } } })
            .then((o) => o.subscription);
          const ctx = req.ctx.subscription;
          return {
            status: ctx.status,
            usable: ctx.usable,
            plan: subscription ? presentPlan(subscription.plan) : null,
            trialEndsAt: ctx.trialEndsAt,
            currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
            usage: await usage(req.db, req.ctx.organizationId),
          };
        },
      },
      {
        method: 'get',
        path: '/plans',
        access: { permission: 'billing:read' },
        handler: async (req) => {
          const plans = await req.db.subscriptionPlan.findMany({
            where: { isActive: true },
            orderBy: { position: 'asc' },
          });
          return plans.map(presentPlan);
        },
      },
    ],
  };
}
