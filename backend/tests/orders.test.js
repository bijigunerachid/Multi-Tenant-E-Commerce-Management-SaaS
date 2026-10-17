import { createTestApp, resetState } from './helpers/testApp.js';
import { organizationWithAllRoles } from './helpers/factories.js';

let ctx;
let org;
let owner;
let shirt; // product with two variants
let mug; // product with one variant

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

beforeEach(async () => {
  await resetState(ctx);
  org = await organizationWithAllRoles(ctx.app, ctx.prisma);
  owner = org.members.OWNER.client;
  shirt = (
    await owner.post('/products', {
      name: 'Linen shirt',
      status: 'ACTIVE',
      variants: [
        { sku: 'SHIRT-M', options: { Size: 'M' }, price: '29.90' },
        { sku: 'SHIRT-L', options: { Size: 'L' }, price: '31.90' },
      ],
    })
  ).body.data;
  mug = (
    await owner.post('/products', {
      name: 'Ceramic mug',
      status: 'ACTIVE',
      variants: [{ sku: 'MUG-1', price: '9.50' }],
    })
  ).body.data;
});

const variant = (product, i = 0) => product.variants[i].id;
const receive = (variantId, quantity) =>
  owner.post('/inventory/receipts', { storeId: org.store.id, variantId, quantity });
const draft = (body) => owner.post('/orders', body);
const act = (orderId, action, client = owner) =>
  client.post(`/orders/${orderId}/transitions`, { action });
const level = (variantId) => ctx.prisma.inventoryLevel.findFirst({ where: { variantId } });

/** Invariant: every level's `reserved` equals the sum of its ACTIVE reservations. */
async function reservationsConsistent() {
  const rows = await ctx.prisma.$queryRaw`
    SELECT l.id FROM inventory_levels l
    LEFT JOIN inventory_reservations r ON r.inventory_level_id = l.id AND r.status = 'ACTIVE'
    GROUP BY l.id, l.reserved
    HAVING l.reserved <> COALESCE(SUM(r.quantity), 0)`;
  return rows.length === 0;
}

describe('drafts', () => {
  test('prices, names and SKUs come from the catalog, and totals are computed by the server', async () => {
    const res = await draft({
      items: [
        { variantId: variant(shirt), quantity: 2, unitPrice: '0.01' }, // client price is ignored
        { variantId: variant(mug), quantity: 3 },
      ],
      discountTotal: '10',
      shippingTotal: '25.00',
      taxRate: '0.2',
      total: '1.00', // ignored too
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'DRAFT',
      number: null,
      allowedActions: ['place'],
      currency: 'USD',
      subtotal: '88.30', // 2 × 29.90 + 3 × 9.50
      discountTotal: '10.00',
      taxRate: '0.2',
      taxTotal: '15.66', // (88.30 − 10) × 0.2
      shippingTotal: '25.00',
      total: '118.96',
    });
    expect(res.body.data.items).toEqual([
      expect.objectContaining({
        productName: 'Linen shirt',
        variantName: 'M',
        sku: 'SHIRT-M',
        unitPrice: '29.90',
        quantity: 2,
        lineTotal: '59.80',
      }),
      expect.objectContaining({
        productName: 'Ceramic mug',
        variantName: 'Default',
        sku: 'MUG-1',
        unitPrice: '9.50',
        quantity: 3,
        lineTotal: '28.50',
      }),
    ]);
  });

  test('snapshots the customer and the chosen saved address', async () => {
    const customer = (
      await owner.post('/customers', {
        name: 'Amina Haddad',
        email: 'amina@example.com',
        phone: '0600',
        address: { line1: '12 Rue Atlas', city: 'Casablanca', country: 'MA' },
      })
    ).body.data;
    const res = await draft({
      customerId: customer.id,
      shippingAddressId: customer.addresses[0].id,
      items: [{ variantId: variant(mug), quantity: 1 }],
    });
    expect(res.body.data.customer).toEqual({
      id: customer.id,
      name: 'Amina Haddad',
      email: 'amina@example.com',
    });
    expect(res.body.data.shippingAddress).toMatchObject({
      recipientName: 'Amina Haddad',
      line1: '12 Rue Atlas',
      city: 'Casablanca',
      country: 'MA',
      phone: '0600',
    });

    // Renaming the customer later does not rewrite the order.
    await owner.patch(`/customers/${customer.id}`, { name: 'Amina H.' });
    expect((await owner.get(`/orders/${res.body.data.id}`)).body.data.customer.name).toBe(
      'Amina Haddad',
    );
  });

  test('rejects products that are not for sale, duplicates, foreign addresses and big discounts', async () => {
    const draftProduct = (
      await owner.post('/products', {
        name: 'Unreleased',
        status: 'DRAFT',
        variants: [{ sku: 'NEW-1', price: '5' }],
      })
    ).body.data;
    const a = (
      await owner.post('/customers', {
        name: 'A',
        address: { line1: 'x', city: 'x', country: 'MA' },
      })
    ).body.data;
    const b = (await owner.post('/customers', { name: 'B' })).body.data;

    const res = await draft({
      items: [
        { variantId: variant(draftProduct), quantity: 1 },
        { variantId: variant(mug), quantity: 1 },
        { variantId: variant(mug), quantity: 2 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors).toMatchObject({
      'items.0.variantId': 'This product is not for sale',
      'items.2.variantId': 'This product is already in the order',
    });

    const addr = await draft({
      customerId: b.id,
      shippingAddressId: a.addresses[0].id,
      items: [{ variantId: variant(mug), quantity: 1 }],
    });
    expect(addr.body.error.details.fieldErrors.shippingAddressId).toBeDefined();

    const discount = await draft({
      items: [{ variantId: variant(mug), quantity: 1 }],
      discountTotal: '9.51',
    });
    expect(discount.body.error.details.fieldErrors.discountTotal).toMatch(/cannot exceed/);
  });

  test('drafts can be edited (prices re-read) and deleted; placed orders cannot', async () => {
    const order = (await draft({ items: [{ variantId: variant(mug), quantity: 1 }] })).body.data;
    await owner.put(`/products/${mug.id}`, {
      name: 'Ceramic mug',
      status: 'ACTIVE',
      variants: [{ id: variant(mug), sku: 'MUG-1', price: '11.00' }],
    });

    const edited = await owner.put(`/orders/${order.id}`, {
      items: [{ variantId: variant(mug), quantity: 2 }],
    });
    expect(edited.body.data).toMatchObject({
      subtotal: '22.00',
      items: [expect.objectContaining({ unitPrice: '11.00', quantity: 2 })],
    });

    await receive(variant(mug), 5);
    await act(order.id, 'place');
    const editPlaced = await owner.put(`/orders/${order.id}`, {
      items: [{ variantId: variant(mug), quantity: 1 }],
    });
    expect(editPlaced.status).toBe(409);
    expect(editPlaced.body.error.code).toBe('ORDER_NOT_EDITABLE');
    expect((await owner.delete(`/orders/${order.id}`)).status).toBe(409);

    const other = (await draft({ items: [{ variantId: variant(mug), quantity: 1 }] })).body.data;
    expect((await owner.delete(`/orders/${other.id}`)).status).toBe(204);
    expect((await owner.get(`/orders/${other.id}`)).status).toBe(404);
  });
});

describe('lifecycle and stock', () => {
  test('place reserves, ship consumes, deliver completes; numbers are sequential; history is kept', async () => {
    await receive(variant(shirt), 10);
    await receive(variant(mug), 4);
    const order = (
      await draft({
        items: [
          { variantId: variant(shirt), quantity: 3 },
          { variantId: variant(mug), quantity: 4 },
        ],
      })
    ).body.data;

    const placed = await act(order.id, 'place');
    expect(placed.body.data).toMatchObject({
      status: 'PENDING',
      number: 1001,
      allowedActions: ['confirm', 'cancel'],
    });
    expect(placed.body.data.items.map((i) => i.reservation)).toEqual(['ACTIVE', 'ACTIVE']);
    expect(await level(variant(shirt))).toMatchObject({ onHand: 10, reserved: 3 });
    expect(await level(variant(mug))).toMatchObject({ onHand: 4, reserved: 4 });

    for (const [action, status] of [
      ['confirm', 'CONFIRMED'],
      ['start', 'PROCESSING'],
    ]) {
      expect((await act(order.id, action)).body.data.status).toBe(status);
    }
    const shipped = await act(order.id, 'ship');
    expect(shipped.body.data).toMatchObject({ status: 'SHIPPED', allowedActions: ['deliver'] });
    expect(shipped.body.data.shippedAt).not.toBeNull();
    expect(await level(variant(shirt))).toMatchObject({ onHand: 7, reserved: 0 });
    expect(await level(variant(mug))).toMatchObject({ onHand: 0, reserved: 0 });
    expect(shipped.body.data.items.map((i) => i.reservation)).toEqual(['CONSUMED', 'CONSUMED']);

    const delivered = await act(order.id, 'deliver');
    expect(delivered.body.data).toMatchObject({ status: 'DELIVERED', allowedActions: [] });
    expect(delivered.body.data.history.map((h) => [h.fromStatus, h.toStatus])).toEqual([
      ['DRAFT', 'PENDING'],
      ['PENDING', 'CONFIRMED'],
      ['CONFIRMED', 'PROCESSING'],
      ['PROCESSING', 'SHIPPED'],
      ['SHIPPED', 'DELIVERED'],
    ]);
    expect(delivered.body.data.history[0].actor.name).toBe(org.members.OWNER.user.name);

    const movements = await ctx.prisma.inventoryMovement.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(movements.map((m) => [m.type, m.onHandDelta, m.reservedDelta])).toEqual([
      ['RESERVE', 0, 3],
      ['RESERVE', 0, 4],
      ['FULFIL', -3, -3],
      ['FULFIL', -4, -4],
    ]);

    const second = (await draft({ items: [{ variantId: variant(shirt), quantity: 1 }] })).body.data;
    expect((await act(second.id, 'place')).body.data.number).toBe(1002);
    expect(await reservationsConsistent()).toBe(true);
  });

  test('cancelling releases reserved stock once, needs a reason, and is audited', async () => {
    await receive(variant(mug), 5);
    const order = (await draft({ items: [{ variantId: variant(mug), quantity: 2 }] })).body.data;
    await act(order.id, 'place');
    await act(order.id, 'confirm');

    expect((await owner.post(`/orders/${order.id}/cancel`, {})).status).toBe(400);
    const cancelled = await owner.post(`/orders/${order.id}/cancel`, {
      reason: 'Customer changed their mind',
    });
    expect(cancelled.body.data).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Customer changed their mind',
      allowedActions: [],
    });
    expect(cancelled.body.data.items[0].reservation).toBe('RELEASED');
    expect(await level(variant(mug))).toMatchObject({ onHand: 5, reserved: 0 });

    const again = await owner.post(`/orders/${order.id}/cancel`, { reason: 'Twice' });
    expect(again.status).toBe(409);
    expect(await level(variant(mug))).toMatchObject({ onHand: 5, reserved: 0 });

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'order.cancelled' } });
    expect(audit.metadata).toMatchObject({ number: 1001, from: 'CONFIRMED' });
    expect(await reservationsConsistent()).toBe(true);
  });

  test('invalid transitions are refused with the allowed actions', async () => {
    await receive(variant(mug), 5);
    const order = (await draft({ items: [{ variantId: variant(mug), quantity: 1 }] })).body.data;

    const confirmDraft = await act(order.id, 'confirm');
    expect(confirmDraft.status).toBe(409);
    expect(confirmDraft.body.error).toMatchObject({
      code: 'INVALID_TRANSITION',
      message: 'A draft order cannot be confirmed',
      details: { status: 'DRAFT', allowedActions: ['place'] },
    });

    await act(order.id, 'place');
    expect((await act(order.id, 'ship')).status).toBe(409);
    expect((await act(order.id, 'cancel')).status).toBe(400); // cancel has its own route

    await act(order.id, 'confirm');
    await act(order.id, 'start');
    await act(order.id, 'ship');
    const cancelShipped = await owner.post(`/orders/${order.id}/cancel`, { reason: 'Too late' });
    expect(cancelShipped.status).toBe(409);
    expect(cancelShipped.body.error.message).toBe('A shipped order cannot be cancelled');
  });

  test('placing with too little stock reserves nothing and does not use up an order number', async () => {
    await receive(variant(shirt), 10);
    await receive(variant(mug), 2);
    const order = (
      await draft({
        items: [
          { variantId: variant(shirt), quantity: 3 },
          { variantId: variant(mug), quantity: 3 },
        ],
      })
    ).body.data;

    const res = await act(order.id, 'place');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      message: 'Not enough stock for MUG-1: 2 available, 3 ordered',
      details: { fieldErrors: { 'items.1.quantity': 'Only 2 available' } },
    });
    expect((await owner.get(`/orders/${order.id}`)).body.data).toMatchObject({
      status: 'DRAFT',
      number: null,
    });
    expect(await level(variant(shirt))).toMatchObject({ reserved: 0 });
    expect(await ctx.prisma.inventoryReservation.count()).toBe(0);

    await owner.put(`/orders/${order.id}`, {
      items: [
        { variantId: variant(shirt), quantity: 3 },
        { variantId: variant(mug), quantity: 2 },
      ],
    });
    expect((await act(order.id, 'place')).body.data.number).toBe(1001);
  });
});

describe('concurrency', () => {
  test('8 orders racing for the last 3 units: exactly 3 are placed, with unique numbers', async () => {
    await receive(variant(mug), 3);
    const drafts = [];
    for (let i = 0; i < 8; i += 1)
      drafts.push((await draft({ items: [{ variantId: variant(mug), quantity: 1 }] })).body.data);

    const results = await Promise.all(drafts.map((d) => act(d.id, 'place')));
    const placed = results.filter((r) => r.status === 200);
    expect(placed).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(placed.map((r) => r.body.data.number).sort()).toEqual([1001, 1002, 1003]);
    expect(await level(variant(mug))).toMatchObject({ onHand: 3, reserved: 3 });
    expect(await reservationsConsistent()).toBe(true);
  });

  test('the same draft placed twice at once is placed once: one number, one reservation, one history entry', async () => {
    await receive(variant(mug), 10);
    const order = (await draft({ items: [{ variantId: variant(mug), quantity: 2 }] })).body.data;

    const results = await Promise.all([
      act(order.id, 'place'),
      act(order.id, 'place'),
      act(order.id, 'place'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(
      results
        .filter((r) => r.status === 409)
        .every((r) => r.body.error.code === 'INVALID_TRANSITION'),
    ).toBe(true);

    expect(await level(variant(mug))).toMatchObject({ onHand: 10, reserved: 2 });
    expect(await ctx.prisma.inventoryReservation.count()).toBe(1);
    expect(await ctx.prisma.orderStatusHistory.count({ where: { orderId: order.id } })).toBe(1);
    const next = (await draft({ items: [{ variantId: variant(mug), quantity: 1 }] })).body.data;
    expect((await act(next.id, 'place')).body.data.number).toBe(1002); // no number was wasted
  });

  test('a status change clicked twice at once is recorded once', async () => {
    await receive(variant(mug), 2);
    const order = (await draft({ items: [{ variantId: variant(mug), quantity: 1 }] })).body.data;
    await act(order.id, 'place');

    const results = await Promise.all([act(order.id, 'confirm'), act(order.id, 'confirm')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const history = await ctx.prisma.orderStatusHistory.findMany({
      where: { orderId: order.id, toStatus: 'CONFIRMED' },
    });
    expect(history).toHaveLength(1);
  });

  test('the same order shipped twice at once is shipped once', async () => {
    await receive(variant(mug), 5);
    const order = (await draft({ items: [{ variantId: variant(mug), quantity: 2 }] })).body.data;
    for (const action of ['place', 'confirm', 'start']) await act(order.id, action);

    const results = await Promise.all([
      act(order.id, 'ship'),
      act(order.id, 'ship'),
      owner.post(`/orders/${order.id}/cancel`, { reason: 'race' }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const final = (await owner.get(`/orders/${order.id}`)).body.data;
    const lvl = await level(variant(mug));
    if (final.status === 'SHIPPED') expect(lvl).toMatchObject({ onHand: 3, reserved: 0 });
    else expect(lvl).toMatchObject({ onHand: 5, reserved: 0 });
    expect(
      await ctx.prisma.inventoryMovement.count({
        where: { orderId: order.id, type: { in: ['FULFIL', 'RELEASE'] } },
      }),
    ).toBe(1);
    expect(await reservationsConsistent()).toBe(true);
  });
});

describe('history protects records', () => {
  test('the database enforces totals and keeps status history append-only', async () => {
    await receive(variant(mug), 1);
    const order = (await draft({ items: [{ variantId: variant(mug), quantity: 1 }] })).body.data;
    await expect(
      ctx.prisma.$executeRaw`UPDATE orders SET total = 0.01 WHERE id = ${order.id}::uuid`,
    ).rejects.toThrow(/orders_total_check/);
    await expect(
      ctx.prisma
        .$executeRaw`UPDATE order_items SET line_total = 1 WHERE order_id = ${order.id}::uuid`,
    ).rejects.toThrow(/order_items_line_total_check/);
    await act(order.id, 'place');
    await expect(ctx.prisma.$executeRaw`DELETE FROM order_status_history`).rejects.toThrow(
      /append-only/,
    );
  });

  test('ordered products and customers with orders cannot be deleted; past orders keep their snapshot', async () => {
    const customer = (await owner.post('/customers', { name: 'Amina' })).body.data;
    await receive(variant(mug), 1);
    const order = (
      await draft({ customerId: customer.id, items: [{ variantId: variant(mug), quantity: 1 }] })
    ).body.data;
    await act(order.id, 'place');

    expect((await owner.delete(`/customers/${customer.id}`)).body.error.code).toBe(
      'CUSTOMER_HAS_ORDERS',
    );
    expect((await owner.delete(`/products/${mug.id}`)).body.error.code).toBe('PRODUCT_HAS_HISTORY');

    await owner.put(`/products/${mug.id}`, {
      name: 'Renamed mug',
      status: 'ACTIVE',
      variants: [{ id: variant(mug), sku: 'MUG-NEW', price: '99' }],
    });
    const after = (await owner.get(`/orders/${order.id}`)).body.data;
    expect(after.items[0]).toMatchObject({
      productName: 'Ceramic mug',
      sku: 'MUG-1',
      unitPrice: '9.50',
    });
    expect(after.total).toBe('9.50');
  });
});

describe('listing, search and export', () => {
  beforeEach(async () => {
    await receive(variant(shirt), 20);
    await receive(variant(mug), 20);
    const amina = (
      await owner.post('/customers', { name: 'Amina Haddad', email: 'amina@example.com' })
    ).body.data;
    const omar = (await owner.post('/customers', { name: 'Omar Idrissi' })).body.data;
    const a = (
      await draft({ customerId: amina.id, items: [{ variantId: variant(shirt), quantity: 1 }] })
    ).body.data;
    const b = (
      await draft({ customerId: omar.id, items: [{ variantId: variant(mug), quantity: 2 }] })
    ).body.data;
    await draft({ items: [{ variantId: variant(mug), quantity: 1 }] }); // stays a draft
    await act(a.id, 'place');
    await act(b.id, 'place');
    await owner.post(`/orders/${b.id}/cancel`, { reason: 'Out of budget' });
  });

  test('filters by status and searches by number, customer and SKU', async () => {
    const list = async (q) => (await owner.get(`/orders?${q}`)).body;
    expect((await list('')).meta.total).toBe(3);
    expect((await list('status=DRAFT')).data.map((o) => o.number)).toEqual([null]);
    expect((await list('search=%231001')).data.map((o) => o.customer.name)).toEqual([
      'Amina Haddad',
    ]);
    expect((await list('search=omar')).data.map((o) => o.status)).toEqual(['CANCELLED']);
    expect((await list('search=shirt-m')).data.map((o) => o.number)).toEqual([1001]);
    expect((await list('sort=-number')).data.map((o) => o.number)).toEqual([1002, 1001, null]);
    const today = new Date().toISOString().slice(0, 10);
    expect((await list(`from=${today}&to=${today}`)).meta.total).toBe(2); // drafts have no placed date
    expect((await owner.get('/orders?from=15-10-2026')).status).toBe(400);
  });

  test('exports orders as CSV and audits it', async () => {
    const res = await owner.agent
      .get('/api/v1/orders/export?status=CANCELLED')
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (c) => (data += c));
        r.on('end', () => cb(null, data));
      });
    expect(res.status).toBe(200);
    const lines = res.body
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toBe(
      'Number,Status,Placed,Customer,Email,Items,Subtotal,Discount,Tax,Shipping,Total,Currency',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(
      /^1002,CANCELLED,.*,Omar Idrissi,,2,19\.00,0\.00,0\.00,0\.00,19\.00,USD$/,
    );
    expect(
      (await ctx.prisma.auditLog.findFirst({ where: { action: 'order.exported' } })).metadata,
    ).toMatchObject({ rows: 1, status: 'CANCELLED' });
  });

  test('the product picker lists only sellable products with their available stock', async () => {
    await owner.post('/products', {
      name: 'Hidden draft',
      status: 'DRAFT',
      variants: [{ sku: 'HIDDEN-1', price: '1' }],
    });
    const res = await owner.get('/orders/sellable-variants?search=mug');
    expect(res.body.data).toEqual([
      {
        variantId: variant(mug),
        sku: 'MUG-1',
        productName: 'Ceramic mug',
        variantName: 'Default',
        price: '9.50',
        currency: 'USD',
        available: 20,
      },
    ]);
    expect((await owner.get('/orders/sellable-variants?search=hidden')).body.data).toEqual([]);
  });
});

describe('roles', () => {
  test('order managers run the whole lifecycle; inventory managers and analysts have no access', async () => {
    await receive(variant(mug), 3);
    const om = org.members.ORDER_MANAGER.client;
    const order = (await om.post('/orders', { items: [{ variantId: variant(mug), quantity: 1 }] }))
      .body.data;
    for (const action of ['place', 'confirm', 'start', 'ship', 'deliver']) {
      expect((await act(order.id, action, om)).status).toBe(200);
    }
    for (const role of ['INVENTORY_MANAGER', 'ANALYST']) {
      const client = org.members[role].client;
      expect((await client.get('/orders')).status).toBe(403);
      expect(
        (await client.post('/orders', { items: [{ variantId: variant(mug), quantity: 1 }] }))
          .status,
      ).toBe(403);
      expect((await client.get(`/orders/${order.id}`)).status).toBe(403);
    }
  });
});
