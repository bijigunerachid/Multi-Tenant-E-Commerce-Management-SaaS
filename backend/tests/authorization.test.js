import { randomUUID } from 'node:crypto';
import { createTestApp, resetState } from './helpers/testApp.js';
import { apiClient } from './helpers/client.js';
import { organizationWithAllRoles } from './helpers/factories.js';
import { ROLES, roleHas } from '../src/modules/auth/permissions.js';

/**
 * Generated from the live route table, so every route added later is covered automatically:
 * - every non-public route rejects anonymous callers with 401;
 * - every permission-protected route answers 403 to each role that lacks the permission,
 *   and does not answer 401/403 to each role that has it.
 * Requests use random IDs and empty bodies, so allowed calls end in 400/404 and change nothing.
 */

let ctx;
let org;

beforeAll(async () => {
  ctx = await createTestApp();
  await resetState(ctx);
  org = await organizationWithAllRoles(ctx.app, ctx.prisma);
});
afterAll(() => ctx.close());

const fillWithRandomIds = (path) => path.replace(/:(\w+)/g, () => randomUUID());

test('the route table is populated', () => {
  expect(ctx.app.locals.routeTable.length).toBeGreaterThan(20);
});

test('every non-public route rejects anonymous callers', async () => {
  const client = apiClient(ctx.app);
  const routes = ctx.app.locals.routeTable.filter((r) => r.access !== 'public');
  for (const route of routes) {
    const res = await client[route.method.toLowerCase()](fillWithRandomIds(route.path), {});
    expect({ route: `${route.method} ${route.path}`, status: res.status }).toEqual({
      route: `${route.method} ${route.path}`,
      status: 401,
    });
  }
});

describe.each(ROLES)('role %s', (role) => {
  test('gets 403 exactly on the routes whose permission it lacks', async () => {
    const client = org.members[role].client;
    const routes = ctx.app.locals.routeTable.filter((r) => r.access.permission);

    for (const route of routes) {
      const res = await client[route.method.toLowerCase()](fillWithRandomIds(route.path), {});
      const allowed = roleHas(role, route.access.permission);
      const outcome = {
        route: `${route.method} ${route.path}`,
        permission: route.access.permission,
        forbidden: res.status === 403 && res.body.error?.code === 'FORBIDDEN',
        unauthenticated: res.status === 401,
      };
      expect(outcome).toEqual({ ...outcome, forbidden: !allowed, unauthenticated: false });
    }
  });
});
