import { z } from 'zod';
import { rateLimit } from '../../middleware/rateLimit.js';
import { createDashboardService } from './dashboard.service.js';
import { createReportService } from './reports.service.js';

const MAX_RANGE_DAYS = 366;
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), { error: 'Invalid date' });

const rangeQuery = z
  .object({
    from: date.optional(),
    to: date.optional(),
    // "Last N days" ending today in the organization's time zone (decided by the database).
    days: z.coerce.number().int().min(1).max(MAX_RANGE_DAYS).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.days && (q.from || q.to)) {
      ctx.addIssue({ code: 'custom', path: ['days'], message: 'Use either "days" or "from"/"to"' });
      return;
    }
    if (Boolean(q.from) !== Boolean(q.to)) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Give both "from" and "to", or neither',
      });
      return;
    }
    if (q.from && q.to) {
      const days = (new Date(q.to) - new Date(q.from)) / 86_400_000 + 1;
      if (days < 1)
        ctx.addIssue({ code: 'custom', path: ['to'], message: '"to" must be on or after "from"' });
      if (days > MAX_RANGE_DAYS) {
        ctx.addIssue({
          code: 'custom',
          path: ['from'],
          message: `Choose at most ${MAX_RANGE_DAYS} days`,
        });
      }
    }
  });

const filters = rangeQuery.and(
  z.object({ storeId: z.uuid({ error: 'Invalid store' }).optional() }),
);
const reportQueries = {
  sales: filters.and(z.object({ groupBy: z.enum(['day', 'week', 'month']).default('day') })),
  products: filters.and(
    z.object({
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
    }),
  ),
  // The stores report compares stores, so it takes no store filter.
  stores: rangeQuery,
};

export function reportRoutes(deps) {
  const dashboard = createDashboardService(deps);
  const reports = createReportService(deps);
  const exportLimit = rateLimit({
    redis: deps.redis,
    name: 'report-export',
    windowSeconds: 3600,
    max: 60,
    key: (req) => req.ctx?.organizationId,
  });

  return {
    basePath: '/reports',
    routes: [
      {
        method: 'get',
        path: '/dashboard',
        access: { permission: 'report:read' },
        validate: { query: rangeQuery },
        handler: (req) => dashboard.dashboard(req, req.valid.query),
      },
      ...Object.entries(reportQueries).flatMap(([report, query]) => [
        {
          method: 'get',
          path: `/${report}`,
          access: { permission: 'report:read' },
          validate: { query },
          handler: (req) => reports.get(req, report, req.valid.query),
        },
        {
          method: 'get',
          path: `/${report}/export`,
          access: { permission: 'report:export' },
          afterAuth: [exportLimit],
          validate: { query },
          handler: (req, res) => reports.exportCsv(req, res, report, req.valid.query),
        },
      ]),
    ],
  };
}
