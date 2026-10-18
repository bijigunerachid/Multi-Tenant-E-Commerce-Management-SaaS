import express from 'express';
import { z } from 'zod';
import { paginationSchema } from '../../utils/schemas.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { presentPlan } from './subscription.js';
import { usage } from './limits.js';
import { createBillingService } from './billing.service.js';

// The organization's plan, status, usage and invoices, and buying or managing a plan. Owners
// only (billing:read, billing:manage). Every member learns whether the organization is
// read-only from the session. Paying is allowed while read-only: it is how one gets out of it.

const checkoutBody = z.object({ plan: z.string().trim().min(1).max(40) });

export function subscriptionRoutes(deps) {
  const billing = createBillingService(deps);
  const checkoutLimit = rateLimit({
    redis: deps.redis,
    name: 'billing-checkout',
    windowSeconds: 3600,
    max: 20,
    key: (req) => req.ctx?.organizationId,
  });

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
            // Payments are possible on this server, and whether this organization already pays
            // through the provider (then plan changes go through "Manage billing").
            billingEnabled: billing.enabled,
            hasBillingAccount: Boolean(subscription?.providerCustomerId),
            billedByProvider:
              Boolean(subscription?.providerSubscriptionId) &&
              ['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(ctx.status),
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
          return plans.map((p) => ({ ...presentPlan(p), onSale: Boolean(p.providerPriceId) }));
        },
      },
      {
        method: 'get',
        path: '/invoices',
        access: { permission: 'billing:read' },
        validate: { query: paginationSchema },
        // Paginated lists send { data, meta } themselves.
        handler: async (req, res) => res.json(await billing.listInvoices(req, req.valid.query)),
      },
      {
        method: 'post',
        path: '/checkout',
        access: { permission: 'billing:manage' },
        whenInactive: 'allow',
        afterAuth: [checkoutLimit],
        validate: { body: checkoutBody },
        handler: (req) => billing.checkout(req, req.valid.body.plan),
      },
      {
        method: 'post',
        path: '/portal',
        access: { permission: 'billing:manage' },
        whenInactive: 'allow',
        handler: (req) => billing.portal(req),
      },
    ],
  };
}

/**
 * The payment provider's webhook: POST /api/v1/subscriptions/webhooks/stripe. Mounted before
 * the session and CSRF middleware (it carries no cookie; it is authenticated by its signature)
 * and fed the raw body, which the signature covers. Answers 2xx once the event is stored and
 * applied (or recognised as a duplicate), 400 for a bad signature, and 5xx so the provider
 * retries when applying failed.
 */
export function billingWebhookRouter(deps) {
  const billing = createBillingService(deps);
  const router = express.Router();
  router.post('/stripe', async (req, res) => {
    if (!billing.enabled || deps.billing.name !== 'stripe') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    }
    const result = await billing.handleWebhook(req.body, req.headers['stripe-signature']);
    res.json({ received: true, result });
  });
  return router;
}
