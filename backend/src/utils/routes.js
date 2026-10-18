import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import {
  authorize,
  requireAuth,
  requireFeature,
  requireTenant,
  requireUsableSubscription,
} from '../middleware/auth.js';
import { PERMISSIONS } from '../modules/auth/permissions.js';

/**
 * Routes are declared as data and mounted here, so access control cannot be forgotten:
 *
 *   {
 *     method: 'post', path: '/:memberId/deactivate',
 *     access: 'public' | 'authenticated' | { permission: 'member:manage' },
 *     rateLimit: [middleware...],      // optional, runs first
 *     whenInactive: 'allow',           // optional: stays writable when the subscription ended
 *     feature: 'csvExport',            // optional: refused (402) on plans without it
 *     afterAuth: [middleware...],      // optional, runs after authorization (req.ctx is set)
 *     validate: { params, query, body }, // Zod schemas, optional
 *     status: 201,                      // optional success status (default 200)
 *     handler: async (req, res) => data // returned value is sent as { data }; undefined → 204
 *   }
 *
 * Order: rate limit → authentication → tenant → permission → subscription (read-only mode,
 * plan feature) → afterAuth → validation → handler.
 * Authorization runs before validation, so an unauthorized caller learns nothing about
 * the expected input.
 *
 * Every mounted route is recorded in `routeTable` (used by the authorization test suite).
 */
export function mountRoutes({ basePath, routes, deps, routeTable }) {
  const router = Router();
  const authenticated = requireAuth(deps);
  const tenant = requireTenant(deps);

  for (const def of routes) {
    const chain = [...(def.rateLimit ?? [])];

    if (def.access === 'public') {
      // no authentication
    } else if (def.access === 'authenticated') {
      chain.push(authenticated);
    } else if (def.access?.permission && PERMISSIONS.includes(def.access.permission)) {
      chain.push(authenticated, tenant, authorize(def.access.permission));
      if (def.whenInactive !== 'allow') chain.push(requireUsableSubscription);
      if (def.feature) chain.push(requireFeature(def.feature));
    } else {
      throw new Error(
        `Route ${def.method.toUpperCase()} ${basePath}${def.path} has no valid access rule`,
      );
    }

    chain.push(...(def.afterAuth ?? []));
    if (def.validate) chain.push(validate(def.validate));

    chain.push(async (req, res) => {
      const data = await def.handler(req, res);
      if (res.headersSent) return;
      if (data === undefined) return res.status(204).end();
      res.status(def.status ?? 200).json({ data });
    });

    router[def.method](def.path, ...chain);
    routeTable?.push({
      method: def.method.toUpperCase(),
      path: `${basePath}${def.path === '/' ? '' : def.path}`,
      access: def.access,
      whenInactive: def.whenInactive ?? null,
      feature: def.feature ?? null,
    });
  }
  return router;
}
