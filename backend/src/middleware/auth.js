import { forbidden, unauthorized } from '../utils/errors.js';
import { tenantDb } from '../utils/tenantDb.js';
import { permissionsFor, roleHas } from '../modules/auth/permissions.js';
import {
  featureUnavailable,
  subscriptionContext,
  subscriptionInactive,
} from '../modules/billing/subscription.js';

/** Requires a valid session for an active user. Sets req.user. */
export function requireAuth({ prisma }) {
  return async function checkAuth(req, _res, next) {
    if (!req.session) return next(unauthorized());

    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!user || user.status !== 'ACTIVE') {
      await req.endSession();
      return next(unauthorized());
    }
    req.user = user;
    next();
  };
}

/**
 * Resolves the tenant for this request from the session (never from the request itself),
 * re-checking the membership and organization status every time, so removing a member or
 * suspending an organization takes effect on the very next request.
 *
 * Sets req.ctx = { userId, organizationId, membershipId, role, permissions, subscription } and
 * req.db = a Prisma client scoped to that organization.
 */
export function requireTenant({ prisma }) {
  return async function resolveTenant(req, _res, next) {
    const organizationId = req.session.activeOrganizationId;
    if (!organizationId) {
      return next(forbidden('NO_ACTIVE_ORGANIZATION', 'Choose or create an organization first'));
    }

    const membership = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId: req.user.id, organizationId } },
      include: {
        organization: {
          select: { status: true, subscription: { include: { plan: true } } },
        },
      },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      await req.updateSession({ activeOrganizationId: null });
      return next(
        forbidden('ORGANIZATION_ACCESS_REVOKED', 'You no longer have access to this organization'),
      );
    }
    if (membership.organization.status !== 'ACTIVE') {
      return next(forbidden('ORGANIZATION_SUSPENDED', 'This organization is suspended'));
    }

    req.ctx = Object.freeze({
      userId: req.user.id,
      organizationId,
      membershipId: membership.id,
      role: membership.role,
      permissions: permissionsFor(membership.role),
      subscription: subscriptionContext(membership.organization.subscription),
    });
    req.db = tenantDb(prisma, organizationId);
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Read-only mode: when the subscription has ended, changes are refused with 402. Reads still
 * work, so nothing is hidden from the organization. Routes marked `whenInactive: 'allow'`
 * (reducing usage, access and ownership changes, billing itself) stay open.
 */
export function requireUsableSubscription(req, _res, next) {
  if (SAFE_METHODS.has(req.method) || req.ctx.subscription.usable) return next();
  next(subscriptionInactive(req.ctx.subscription.status));
}

/** Refuses a route whose feature the organization's plan does not include (402). */
export function requireFeature(feature) {
  return function checkFeature(req, _res, next) {
    if (req.ctx.subscription.features[feature] === true) return next();
    next(featureUnavailable(feature, req.ctx.subscription.planName));
  };
}

export function authorize(permission) {
  return function checkPermission(req, _res, next) {
    if (!roleHas(req.ctx.role, permission)) return next(forbidden());
    next();
  };
}
