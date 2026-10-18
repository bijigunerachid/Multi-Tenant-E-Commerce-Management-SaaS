import { AppError } from '../../utils/errors.js';

/**
 * What counts against each limit:
 * - stores: active stores (archived ones do not count);
 * - members: active members plus pending, unexpired invitations (an invitation takes a seat
 *   when it is sent, so accepting it can never go over);
 * - products: products that are not archived.
 * Counts use the unscoped client with an explicit organization filter, so they also work
 * outside a tenant request (accepting an invitation).
 */
const USAGE = {
  stores: (tx, organizationId) => tx.store.count({ where: { organizationId, status: 'ACTIVE' } }),
  members: async (tx, organizationId) => {
    const [members, invitations] = await Promise.all([
      tx.organizationMembership.count({ where: { organizationId, status: 'ACTIVE' } }),
      tx.invitation.count({
        where: { organizationId, pendingEmail: { not: null }, expiresAt: { gt: new Date() } },
      }),
    ]);
    return members + invitations;
  },
  products: (tx, organizationId) =>
    tx.product.count({ where: { organizationId, status: { not: 'ARCHIVED' } } }),
};
export const LIMITED_RESOURCES = Object.keys(USAGE);

const MESSAGES = {
  stores: (plan, max) =>
    `The ${plan} plan includes ${max} active ${max === 1 ? 'store' : 'stores'}. Archive a store or change plan to add another.`,
  members: (plan, max) =>
    `The ${plan} plan includes ${max} members, counting pending invitations. Deactivate a member, revoke an invitation or change plan.`,
  products: (plan, max) =>
    `The ${plan} plan includes ${max} products. Archive products or change plan to add more.`,
};

export async function usage(db, organizationId) {
  const counts = await Promise.all(LIMITED_RESOURCES.map((r) => USAGE[r](db, organizationId)));
  return Object.fromEntries(LIMITED_RESOURCES.map((r, i) => [r, counts[i]]));
}

/**
 * Serialises changes to one organization's usage of a resource until the transaction ends.
 * Also used by changes that lower usage and must not race (archiving the last store).
 */
export function lockUsage(tx, organizationId, resource) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`limit:${organizationId}:${resource}`}))`;
}

/**
 * Throws 402 PLAN_LIMIT_REACHED when adding `adding` more of `resource` would go over the
 * plan. Call it inside the transaction that adds them: it takes a transaction-level advisory
 * lock per organization and resource, so two requests racing for the last slot are
 * serialised and the second one sees the first one's row.
 */
export async function assertWithinLimit(
  tx,
  { organizationId, subscription },
  resource,
  adding = 1,
) {
  await lockUsage(tx, organizationId, resource);
  const max = subscription.limits[resource];
  const current = await USAGE[resource](tx, organizationId);
  if (current + adding > max) {
    throw new AppError(402, 'PLAN_LIMIT_REACHED', MESSAGES[resource](subscription.planName, max), {
      resource,
      limit: max,
      current,
      plan: subscription.planCode,
    });
  }
}
