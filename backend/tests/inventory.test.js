import { createTestApp, resetState } from './helpers/testApp.js';
import { organizationWithAllRoles, productInput } from './helpers/factories.js';
import { applyStockChange } from '../src/modules/inventory/inventory.service.js';

let ctx;
let org;
let owner;
let store;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await resetState(ctx);
  org = await organizationWithAllRoles(ctx.app, ctx.prisma);
  owner = org.members.OWNER.client;
  store = org.store;
});

async function createProduct(overrides = {}) {
  return (await owner.post('/products', productInput(overrides))).body.data;
}
const receive = (client, variantId, quantity, extra = {}) =>
  client.post('/inventory/receipts', { storeId: store.id, variantId, quantity, ...extra });
const adjust = (client, variantId, body) =>
  client.post('/inventory/adjustments', { storeId: store.id, variantId, ...body });

describe('receiving and adjusting stock', () => {
  test('receipts create the level on first use, then add to it, each with a movement', async () => {
    const [variant] = (await createProduct()).variants;

    const first = await receive(owner, variant.id, 10, { note: 'PO-1001' });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ onHand: 10, reserved: 0, available: 10, status: 'OK' });

    const second = await receive(owner, variant.id, 5);
    expect(second.body.data.onHand).toBe(15);

    const history = await owner.get(`/inventory/movements?variantId=${variant.id}`);
    expect(history.body.data.map((m) => [m.type, m.onHandDelta, m.onHandAfter])).toEqual([
      ['RECEIPT', 5, 15],
      ['RECEIPT', 10, 10],
    ]);
    expect(history.body.data[1]).toMatchObject({
      note: 'PO-1001',
      actor: { name: org.members.OWNER.user.name },
    });
  });

  test('a negative adjustment cannot take stock below zero, and nothing is recorded when it fails', async () => {
    const [variant] = (await createProduct()).variants;
    await receive(owner, variant.id, 3);

    const ok = await adjust(owner, variant.id, { change: -2, reason: 'DAMAGED' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ onHand: 1, available: 1 });

    const tooMuch = await adjust(owner, variant.id, { change: -2, reason: 'LOST' });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { onHand: 1, reserved: 0, available: 1 },
    });
    expect(await ctx.prisma.inventoryMovement.count()).toBe(2);

    const noLevelYet = await adjust(owner, (await createProduct()).variants[0].id, {
      change: -1,
      reason: 'LOST',
    });
    expect(noLevelYet.status).toBe(409);
  });

  test('a stock count sets an absolute quantity and records the difference', async () => {
    const [variant] = (await createProduct()).variants;
    await receive(owner, variant.id, 12);

    const counted = await adjust(owner, variant.id, { setTo: 9, reason: 'COUNT_CORRECTION' });
    expect(counted.status).toBe(201);
    expect(counted.body.data.onHand).toBe(9);

    const unchanged = await adjust(owner, variant.id, { setTo: 9, reason: 'COUNT_CORRECTION' });
    expect(unchanged.status).toBe(409);
    expect(unchanged.body.error.code).toBe('NO_CHANGE');

    const movement = await ctx.prisma.inventoryMovement.findFirst({
      where: { type: 'ADJUSTMENT' },
    });
    expect(movement).toMatchObject({ onHandDelta: -3, onHandAfter: 9, reason: 'COUNT_CORRECTION' });
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'inventory.adjusted' } });
    expect(audit.metadata).toMatchObject({ delta: -3, reason: 'COUNT_CORRECTION', onHandAfter: 9 });
  });

  test('validates adjustments', async () => {
    const [variant] = (await createProduct()).variants;
    const both = await adjust(owner, variant.id, { change: 1, setTo: 4, reason: 'FOUND' });
    expect(both.body.error.details.fieldErrors.change).toBeDefined();

    const zero = await adjust(owner, variant.id, { change: 0, reason: 'FOUND' });
    expect(zero.status).toBe(400);

    const other = await adjust(owner, variant.id, { change: 1, reason: 'OTHER' });
    expect(other.body.error.details.fieldErrors.note).toBe('Explain the adjustment');

    const fractional = await receive(owner, variant.id, 1.5);
    expect(fractional.body.error.details.fieldErrors.quantity).toBeDefined();
  });

  test('an archived store cannot receive stock', async () => {
    const [variant] = (await createProduct()).variants;
    await ctx.prisma.store.update({ where: { id: store.id }, data: { status: 'ARCHIVED' } });
    const res = await receive(owner, variant.id, 1);
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.storeId).toMatch(/archived/);
  });
});

describe('concurrency', () => {
  test('20 simultaneous removals against 5 units: exactly 5 succeed and stock never goes negative', async () => {
    const [variant] = (await createProduct()).variants;
    await receive(owner, variant.id, 5);

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        adjust(owner, variant.id, { change: -1, reason: 'DAMAGED' }),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(15);
    const level = await ctx.prisma.inventoryLevel.findFirst({ where: { variantId: variant.id } });
    expect(level.onHand).toBe(0);
    expect(await ctx.prisma.inventoryMovement.count({ where: { type: 'ADJUSTMENT' } })).toBe(5);
  });

  test('20 simultaneous reservations against 5 units: exactly 5 are granted', async () => {
    const [variant] = (await createProduct()).variants;
    await receive(owner, variant.id, 5);
    const organizationId = org.organization.id;

    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        ctx.prisma.$transaction((tx) =>
          applyStockChange(tx, {
            organizationId,
            storeId: store.id,
            variantId: variant.id,
            reservedDelta: 1,
            type: 'RESERVE',
          }),
        ),
      ),
    );

    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(5);
    expect(
      attempts
        .filter((a) => a.status === 'rejected')
        .every((a) => a.reason.code === 'INSUFFICIENT_STOCK'),
    ).toBe(true);
    const level = await ctx.prisma.inventoryLevel.findFirst({ where: { variantId: variant.id } });
    expect(level).toMatchObject({ onHand: 5, reserved: 5 });

    // Reserved units cannot be removed by an adjustment or a count below the reservation.
    const removal = await adjust(owner, variant.id, { change: -1, reason: 'LOST' });
    expect(removal.status).toBe(409);
    const count = await adjust(owner, variant.id, { setTo: 4, reason: 'COUNT_CORRECTION' });
    expect(count.status).toBe(409);
    expect(count.body.error.details.message).toBe('5 units are reserved for orders');
  });

  test('the database itself refuses negative stock and edits to the movement history', async () => {
    const [variant] = (await createProduct()).variants;
    await receive(owner, variant.id, 2);

    await expect(
      ctx.prisma
        .$executeRaw`UPDATE inventory_levels SET on_hand = -1 WHERE variant_id = ${variant.id}::uuid`,
    ).rejects.toThrow(/inventory_levels_on_hand_check/);
    await expect(
      ctx.prisma
        .$executeRaw`UPDATE inventory_levels SET reserved = 3 WHERE variant_id = ${variant.id}::uuid`,
    ).rejects.toThrow(/inventory_levels_reserved_check/);
    await expect(
      ctx.prisma.$executeRaw`UPDATE inventory_movements SET on_hand_delta = 100`,
    ).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRaw`DELETE FROM inventory_movements`).rejects.toThrow(
      /append-only/,
    );
  });
});

describe('stock overview', () => {
  async function seed() {
    const shirt = await createProduct({
      name: 'Alpha shirt',
      variants: [
        { sku: 'ALPHA-M', price: '20', cost: '8.50', lowStockThreshold: 3 },
        { sku: 'ALPHA-L', price: '20', cost: '8.50', lowStockThreshold: 3 },
      ],
    });
    const mug = await createProduct({
      name: 'Beta 100% mug',
      variants: [{ sku: 'BETA-1', price: '9', lowStockThreshold: 5 }],
    });
    const gone = await createProduct({
      name: 'Gamma board',
      variants: [{ sku: 'GAMMA-1', price: '30', cost: '12' }],
    });
    await receive(owner, shirt.variants[0].id, 10); // OK
    await receive(owner, shirt.variants[1].id, 2); // LOW (threshold 3)
    await receive(owner, mug.variants[0].id, 4); // LOW, no cost
    // GAMMA-1 never received: OUT
    return { shirt, mug, gone };
  }

  test('lists every variant with its stock status, including ones never stocked', async () => {
    await seed();
    const res = await owner.get('/inventory?sort=sku');
    expect(res.body.meta).toMatchObject({ total: 4, store: { id: store.id } });
    expect(res.body.data.map((r) => [r.sku, r.onHand, r.available, r.status])).toEqual([
      ['ALPHA-L', 2, 2, 'LOW'],
      ['ALPHA-M', 10, 10, 'OK'],
      ['BETA-1', 4, 4, 'LOW'],
      ['GAMMA-1', 0, 0, 'OUT'],
    ]);
    expect(res.body.data[1]).toMatchObject({
      unitCost: '8.50',
      stockValue: '85.00',
      currency: 'USD',
    });
    expect(res.body.data[2]).toMatchObject({ unitCost: null, stockValue: null });
  });

  test('filters by stock status and treats % in a search as a literal character', async () => {
    await seed();
    const skus = async (query) =>
      (await owner.get(`/inventory?sort=sku&${query}`)).body.data.map((r) => r.sku);
    expect(await skus('stock=low')).toEqual(['ALPHA-L', 'BETA-1']);
    expect(await skus('stock=out')).toEqual(['GAMMA-1']);
    expect(await skus('stock=attention')).toEqual(['ALPHA-L', 'BETA-1', 'GAMMA-1']);
    expect(await skus('stock=in')).toEqual(['ALPHA-M']);
    expect(await skus(`search=${encodeURIComponent('100%')}`)).toEqual(['BETA-1']);
    expect(await skus(`search=${encodeURIComponent('%')}`)).toEqual(['BETA-1']);
    expect(await skus('search=alpha&pageSize=1&page=2')).toEqual(['ALPHA-M']);
  });

  test('summarises units, alerts and valuation, and counts stock without a cost separately', async () => {
    await seed();
    const res = await owner.get('/inventory/summary');
    expect(res.body.data).toMatchObject({
      variantCount: 4,
      unitsOnHand: 16,
      unitsReserved: 0,
      lowStock: 2,
      outOfStock: 1,
      unitsWithoutCost: 1,
      valuation: [{ currency: 'USD', value: '102.00' }],
    });
  });

  test('stock levels of one variant across stores', async () => {
    const { shirt } = await seed();
    const res = await owner.get(`/inventory/variants/${shirt.variants[1].id}`);
    expect(res.body.data).toEqual([
      {
        store: { id: store.id, name: store.name },
        onHand: 2,
        reserved: 0,
        available: 2,
        status: 'LOW',
      },
    ]);
  });
});

describe('history protects catalog records', () => {
  test('a product with stock history cannot be deleted, and neither can its stocked variant', async () => {
    const product = await createProduct();
    await receive(owner, product.variants[0].id, 1);

    const del = await owner.delete(`/products/${product.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('PRODUCT_HAS_HISTORY');

    const dropVariant = await owner.put(`/products/${product.id}`, {
      name: product.name,
      variants: [{ id: product.variants[1].id, sku: product.variants[1].sku, price: '1' }],
    });
    expect(dropVariant.status).toBe(409);
    expect(dropVariant.body.error.code).toBe('VARIANT_HAS_HISTORY');

    const archived = await owner.patch(`/products/${product.id}/status`, { status: 'ARCHIVED' });
    expect(archived.status).toBe(200);
  });
});

describe('roles', () => {
  test('inventory managers adjust stock; order managers and analysts can only look', async () => {
    const [variant] = (await createProduct()).variants;
    expect((await receive(org.members.INVENTORY_MANAGER.client, variant.id, 3)).status).toBe(201);

    for (const role of ['ORDER_MANAGER', 'ANALYST']) {
      const client = org.members[role].client;
      expect((await receive(client, variant.id, 1)).status).toBe(403);
      expect((await adjust(client, variant.id, { change: -1, reason: 'LOST' })).status).toBe(403);
      expect((await client.get('/inventory')).status).toBe(200);
    }
    const level = await ctx.prisma.inventoryLevel.findFirst({ where: { variantId: variant.id } });
    expect(level.onHand).toBe(3);
  });
});
