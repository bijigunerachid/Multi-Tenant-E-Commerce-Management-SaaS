import { z } from 'zod';
import { paginationSchema, uuidSchema } from '../../utils/schemas.js';
import { createAdminService } from './admin.service.js';

// /admin: platform administration for Vendora staff (platformRole SUPER_ADMIN). These routes
// work across organizations, so they never use tenantDb; see admin.service.js.

const ADMIN = { platform: 'SUPER_ADMIN' };
const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'];

const reason = z
  .string({ error: 'Give a reason' })
  .trim()
  .min(5, 'Give a reason (at least 5 characters)')
  .max(500, 'Use at most 500 characters');
const params = z.object({ organizationId: uuidSchema });
const listQuery = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  subscription: z.enum(SUBSCRIPTION_STATUSES).optional(),
  plan: z.string().trim().max(40).optional(),
});
const subscriptionBody = z.object({
  plan: z.string().trim().min(1).max(40),
  status: z.enum(['TRIALING', 'ACTIVE', 'CANCELED']),
  trialEndsAt: z.iso.datetime({ offset: true, error: 'Enter a date and time' }).optional(),
  reason,
});
// Reading an organization's audit log requires saying why (it is recorded).
const auditQuery = paginationSchema.extend({ reason });

export function adminRoutes(deps) {
  const admin = createAdminService(deps);
  return {
    basePath: '/admin',
    routes: [
      {
        method: 'get',
        path: '/stats',
        access: ADMIN,
        handler: () => admin.stats(),
      },
      {
        method: 'get',
        path: '/organizations',
        access: ADMIN,
        validate: { query: listQuery },
        handler: async (req, res) => res.json(await admin.listOrganizations(req.valid.query)),
      },
      {
        method: 'get',
        path: '/organizations/:organizationId',
        access: ADMIN,
        validate: { params },
        handler: (req) => admin.getOrganization(req.valid.params.organizationId),
      },
      {
        method: 'post',
        path: '/organizations/:organizationId/suspend',
        access: ADMIN,
        validate: { params, body: z.object({ reason }) },
        handler: (req) =>
          admin.setStatus(req, req.valid.params.organizationId, {
            status: 'SUSPENDED',
            reason: req.valid.body.reason,
          }),
      },
      {
        method: 'post',
        path: '/organizations/:organizationId/reactivate',
        access: ADMIN,
        validate: { params, body: z.object({ reason }) },
        handler: (req) =>
          admin.setStatus(req, req.valid.params.organizationId, {
            status: 'ACTIVE',
            reason: req.valid.body.reason,
          }),
      },
      {
        method: 'put',
        path: '/organizations/:organizationId/subscription',
        access: ADMIN,
        validate: { params, body: subscriptionBody },
        handler: (req) =>
          admin.changeSubscription(req, req.valid.params.organizationId, req.valid.body),
      },
      {
        method: 'get',
        path: '/organizations/:organizationId/audit-logs',
        access: ADMIN,
        validate: { params, query: auditQuery },
        handler: async (req, res) =>
          res.json(await admin.auditLogs(req, req.valid.params.organizationId, req.valid.query)),
      },
    ],
  };
}
