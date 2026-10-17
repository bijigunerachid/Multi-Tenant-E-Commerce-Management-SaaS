// Sales fixtures shared by the dashboard and report tests: orders are created through the API
// (so stock, totals and history are real), then their timestamps are pinned for the scenario.

export async function product(client, name, sku, price, status = 'ACTIVE') {
  return (await client.post('/products', { name, status, variants: [{ sku, price }] })).body.data;
}

/** Creates an order through the API, runs the given actions, then pins its timestamps. */
export async function order(
  prisma,
  client,
  items,
  actions,
  { placedAt, shippedAt, discount = '0' } = {},
) {
  const created = await client.post('/orders', {
    items,
    discountTotal: discount,
    shippingTotal: '50', // never part of revenue
    taxRate: '0.2', // never part of revenue
  });
  const id = created.body.data.id;
  for (const action of actions) {
    const res =
      action === 'cancel'
        ? await client.post(`/orders/${id}/cancel`, { reason: 'test' })
        : await client.post(`/orders/${id}/transitions`, { action });
    if (res.status !== 200) throw new Error(`${action} failed: ${JSON.stringify(res.body)}`);
  }
  if (placedAt)
    await prisma.$executeRaw`UPDATE orders SET placed_at = ${new Date(placedAt)} WHERE id = ${id}::uuid`;
  if (shippedAt)
    await prisma.$executeRaw`UPDATE orders SET shipped_at = ${new Date(shippedAt)} WHERE id = ${id}::uuid`;
  return id;
}

export const SHIP = ['place', 'confirm', 'start', 'ship'];

/**
 * September 2026, Kolkata time (hand-calculated expectations below):
 *   O1  2 shirts @100 + 3 mugs @10 = 230, discount 30 → net 200   shipped Sep 10        ✔ revenue
 *   O2  1 shirt                     = 100                         shipped Oct 1 00:15   ✘ (next period)
 *   O3  5 mugs                      = 50                          shipped Sep 1 00:15   ✔ (18:45 UTC on Aug 31)
 *   O4  1 mug, delivered            = 10                          shipped Sep 15        ✔
 *   O5  5 mugs, cancelled                                                               ✘
 *   O6  4 shirts, pending (placed Sep 20)                                               ✘ revenue, ✔ orders, ✔ open
 *   O7  1 shirt                     = 100                         shipped Aug 20        previous period
 * Revenue 260 from 3 shipped orders → average 86.67. Previous period revenue 100 → +160 %.
 * Orders placed in September (not cancelled): O1, O2, O4, O6 = 4; in the previous period: O3, O7 = 2.
 */
export async function seedSeptember(prisma, client, store) {
  const shirt = await product(client, 'Linen shirt', 'SHIRT-1', '100.00');
  const mug = await product(client, 'Ceramic mug', 'MUG-1', '10.00');
  await product(client, 'Olive board', 'BOARD-1', '30.00'); // never stocked → out of stock
  await product(client, 'Unreleased', 'NEW-1', '5.00', 'DRAFT'); // not an active product
  const S = shirt.variants[0].id;
  const M = mug.variants[0].id;
  await client.post('/inventory/receipts', { storeId: store.id, variantId: S, quantity: 10 });
  await client.post('/inventory/receipts', { storeId: store.id, variantId: M, quantity: 20 });

  await order(
    prisma,
    client,
    [
      { variantId: S, quantity: 2 },
      { variantId: M, quantity: 3 },
    ],
    SHIP,
    {
      discount: '30',
      placedAt: '2026-09-09T10:00:00Z',
      shippedAt: '2026-09-10T12:00:00Z',
    },
  );
  await order(prisma, client, [{ variantId: S, quantity: 1 }], SHIP, {
    placedAt: '2026-09-30T10:00:00Z',
    shippedAt: '2026-09-30T18:45:00Z',
  });
  await order(prisma, client, [{ variantId: M, quantity: 5 }], SHIP, {
    placedAt: '2026-08-31T12:00:00Z',
    shippedAt: '2026-08-31T18:45:00Z',
  });
  await order(prisma, client, [{ variantId: M, quantity: 1 }], [...SHIP, 'deliver'], {
    placedAt: '2026-09-14T10:00:00Z',
    shippedAt: '2026-09-15T10:00:00Z',
  });
  await order(prisma, client, [{ variantId: M, quantity: 5 }], ['place', 'cancel'], {
    placedAt: '2026-09-05T10:00:00Z',
  });
  await order(prisma, client, [{ variantId: S, quantity: 4 }], ['place'], {
    placedAt: '2026-09-20T10:00:00Z',
  });
  await order(prisma, client, [{ variantId: S, quantity: 1 }], SHIP, {
    placedAt: '2026-08-19T10:00:00Z',
    shippedAt: '2026-08-20T10:00:00Z',
  });
  await order(prisma, client, [{ variantId: M, quantity: 1 }], []); // a draft: never counted
  return { shirt, mug };
}
