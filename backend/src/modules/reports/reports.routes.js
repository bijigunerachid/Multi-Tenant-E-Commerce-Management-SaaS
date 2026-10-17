import { z } from 'zod';
import { createDashboardService } from './dashboard.service.js';

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

export function reportRoutes(deps) {
  const dashboard = createDashboardService(deps);
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
    ],
  };
}
