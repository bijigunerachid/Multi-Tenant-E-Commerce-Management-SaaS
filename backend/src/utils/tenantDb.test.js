import { createTestApp, resetState } from '../../tests/helpers/testApp.js';
import { addMember, createOrganization } from '../../tests/helpers/factories.js';
import { TenantScopeViolation, tenantDb } from './tenantDb.js';

let ctx;
let A;
let B;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

beforeEach(async () => {
  await resetState(ctx);
  A = await createOrganization(ctx.prisma);
  B = await createOrganization(ctx.prisma);
  A.analyst = await addMember(ctx.prisma, A.organization.id, 'ANALYST');
  B.analyst = await addMember(ctx.prisma, B.organization.id, 'ANALYST');
});

describe('tenantDb', () => {
  test("reads only return the tenant's rows", async () => {
    const db = tenantDb(ctx.prisma, A.organization.id);

    const stores = await db.store.findMany();
    expect(stores.map((s) => s.id)).toEqual([A.store.id]);
    expect(await db.organizationMembership.count()).toBe(2);
    expect(await db.store.findUnique({ where: { id: B.store.id } })).toBeNull();
    expect(await db.store.findFirst({ where: { slug: B.store.slug } })).toMatchObject({
      id: A.store.id,
    });
  });

  test("updates and deletes cannot reach another tenant's rows", async () => {
    const db = tenantDb(ctx.prisma, A.organization.id);

    const many = await db.organizationMembership.updateMany({
      where: { id: B.analyst.membership.id },
      data: { role: 'MANAGER' },
    });
    expect(many.count).toBe(0);

    await expect(
      db.organizationMembership.update({
        where: { id: B.analyst.membership.id },
        data: { role: 'MANAGER' },
      }),
    ).rejects.toMatchObject({ code: 'P2025' });

    const stillAnalyst = await ctx.prisma.organizationMembership.findUnique({
      where: { id: B.analyst.membership.id },
    });
    expect(stillAnalyst.role).toBe('ANALYST');
  });

  test('creates are stamped with the tenant, and naming another tenant throws', async () => {
    const db = tenantDb(ctx.prisma, A.organization.id);

    const store = await db.store.create({
      data: { name: 'Second', slug: 'second', currency: 'USD', timezone: 'UTC' },
    });
    expect(store.organizationId).toBe(A.organization.id);

    await expect(
      db.store.create({
        data: {
          organizationId: B.organization.id,
          name: 'Sneaky',
          slug: 'sneaky',
          currency: 'USD',
          timezone: 'UTC',
        },
      }),
    ).rejects.toBeInstanceOf(TenantScopeViolation);

    await expect(
      db.store.findMany({ where: { organizationId: B.organization.id } }),
    ).rejects.toBeInstanceOf(TenantScopeViolation);
  });

  test('the Organization model is scoped to the tenant itself', async () => {
    const db = tenantDb(ctx.prisma, A.organization.id);

    expect((await db.organization.findMany()).map((o) => o.id)).toEqual([A.organization.id]);
    // Asking for another organization by id is a programming error, not an empty result.
    await expect(
      db.organization.findUnique({ where: { id: B.organization.id } }),
    ).rejects.toBeInstanceOf(TenantScopeViolation);
    await expect(
      db.organization.create({ data: { name: 'X', slug: 'x-org' } }),
    ).rejects.toBeInstanceOf(TenantScopeViolation);
  });

  test('scoping also applies inside interactive transactions', async () => {
    const db = tenantDb(ctx.prisma, A.organization.id);
    const ids = await db.$transaction(async (tx) => (await tx.store.findMany()).map((s) => s.id));
    expect(ids).toEqual([A.store.id]);
  });

  test('refuses to build without an organization id', () => {
    expect(() => tenantDb(ctx.prisma, undefined)).toThrow(TenantScopeViolation);
  });
});
