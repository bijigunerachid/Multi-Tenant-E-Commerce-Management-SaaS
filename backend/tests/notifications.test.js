import { createTestApp, resetState } from './helpers/testApp.js';
import { lastEmailTo, organizationWithAllRoles } from './helpers/factories.js';
import { product } from './helpers/sales.js';
import { MAX_EVENT_ATTEMPTS, createNotificationWorker } from '../src/jobs/notifications.js';

let ctx;
let org;
let shirtProduct;
let shirt; // its only variant, low-stock threshold 5 (the default)

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await resetState(ctx);
  org = await organizationWithAllRoles(ctx.app, ctx.prisma);
  shirtProduct = await product(org.members.OWNER.client, 'Linen shirt', 'SHIRT-1', '100');
  shirt = shirtProduct.variants[0];
});

const client = (role) => org.members[role].client;
const dispatch = () => ctx.notifications.dispatchPending();
const receive = (quantity) =>
  client('INVENTORY_MANAGER').post('/inventory/receipts', {
    storeId: org.store.id,
    variantId: shirt.id,
    quantity,
  });
const adjust = (change) =>
  client('INVENTORY_MANAGER').post('/inventory/adjustments', {
    storeId: org.store.id,
    variantId: shirt.id,
    change,
    reason: 'DAMAGED',
  });
async function placeOrder(role, items) {
  const draft = await client(role).post('/orders', { items });
  expect(draft.status).toBe(201);
  const placed = await client(role).post(`/orders/${draft.body.data.id}/transitions`, {
    action: 'place',
  });
  return { id: draft.body.data.id, placed };
}
/** Who holds a notification of this type, by role. */
async function recipients(type) {
  const rows = await ctx.prisma.notification.findMany({ where: { type } });
  const byMembership = Object.fromEntries(
    Object.entries(org.members).map(([role, m]) => [m.membership.id, role]),
  );
  return rows.map((r) => byMembership[r.membershipId]).sort();
}

describe('new-order notifications', () => {
  test('a placed order notifies the people who process orders, except whoever placed it', async () => {
    await receive(20);
    const { id, placed } = await placeOrder('ORDER_MANAGER', [
      { variantId: shirt.id, quantity: 2 },
    ]);
    expect(placed.status).toBe(200);

    // Nothing is delivered until the worker runs: the request only wrote the event.
    expect(await ctx.prisma.notification.count()).toBe(0);
    expect(await ctx.prisma.notificationEvent.count({ where: { type: 'order.placed' } })).toBe(1);

    expect(await dispatch()).toEqual({ delivered: 1, failed: 0 });
    expect(await recipients('order.placed')).toEqual(['MANAGER', 'OWNER']);

    const list = await client('OWNER').get('/notifications');
    expect(list.status).toBe(200);
    expect(list.body.meta).toMatchObject({ total: 1, unreadCount: 1 });
    expect(list.body.data[0]).toMatchObject({
      type: 'order.placed',
      readAt: null,
      data: {
        orderId: id,
        number: 1001,
        total: '200.00',
        currency: 'USD',
        itemCount: 2,
        storeName: 'Main store',
      },
    });
  });

  test('drafts, confirmations and shipping do not notify', async () => {
    await receive(20);
    const draft = await client('OWNER').post('/orders', {
      items: [{ variantId: shirt.id, quantity: 1 }],
    });
    expect(draft.status).toBe(201);
    await dispatch();
    expect(await ctx.prisma.notification.count()).toBe(0);

    const { id } = await placeOrder('OWNER', [{ variantId: shirt.id, quantity: 1 }]);
    for (const action of ['confirm', 'start', 'ship']) {
      await client('OWNER').post(`/orders/${id}/transitions`, { action });
    }
    await dispatch();
    expect(await ctx.prisma.notification.count()).toBe(2); // the placed order: manager and order manager
  });
});

describe('low-stock notifications', () => {
  test('fire when stock crosses the threshold and when it runs out, not on every change', async () => {
    await receive(10);
    await adjust(-4); // 6 left: still above the threshold of 5
    await dispatch();
    expect(await ctx.prisma.notification.count()).toBe(0);

    await adjust(-2); // 4 left: low
    await adjust(-1); // 3 left: still low, no new alert
    await dispatch();
    const low = await ctx.prisma.notification.findMany({ where: { type: 'inventory.low_stock' } });
    // Owners, managers and inventory managers, including the one who made the change.
    expect(await recipients('inventory.low_stock')).toEqual([
      'INVENTORY_MANAGER',
      'MANAGER',
      'OWNER',
    ]);
    expect(low[0].data).toMatchObject({
      status: 'LOW',
      available: 4,
      threshold: 5,
      sku: 'SHIRT-1',
      productName: 'Linen shirt',
      storeName: 'Main store',
    });

    await adjust(-3); // 0 left: out of stock
    await dispatch();
    const out = await ctx.prisma.notification.findMany({
      where: { type: 'inventory.low_stock', data: { path: ['status'], equals: 'OUT' } },
    });
    expect(out).toHaveLength(3);
    expect(out[0].data.available).toBe(0);

    // Restocking never notifies; falling again after recovering does.
    await receive(10);
    await dispatch();
    expect(await ctx.prisma.notification.count()).toBe(6);
  });

  test('stock reserved by an order counts, and shipping it does not alert twice', async () => {
    await receive(8);
    const { id } = await placeOrder('ORDER_MANAGER', [{ variantId: shirt.id, quantity: 4 }]);
    await dispatch();
    const alert = await ctx.prisma.notification.findFirst({
      where: { type: 'inventory.low_stock' },
    });
    expect(alert.data).toMatchObject({ status: 'LOW', available: 4 });

    for (const action of ['confirm', 'start', 'ship']) {
      await client('ORDER_MANAGER').post(`/orders/${id}/transitions`, { action });
    }
    await dispatch();
    expect(await ctx.prisma.notification.count({ where: { type: 'inventory.low_stock' } })).toBe(3);
  });

  test('a refused order leaves no notification behind, even for lines that were reserved', async () => {
    const mug = (await product(client('OWNER'), 'Mug', 'MUG-1', '10')).variants[0];
    await receive(6);
    // The shirt line would drop to 1 (low); the mug line has no stock, so placing fails.
    const { placed } = await placeOrder('OWNER', [
      { variantId: shirt.id, quantity: 5 },
      { variantId: mug.id, quantity: 1 },
    ]);
    expect(placed.status).toBe(409);
    expect(await ctx.prisma.notificationEvent.count()).toBe(0);
    expect(await dispatch()).toEqual({ delivered: 0, failed: 0 });
  });

  test('nothing is sent about an archived product', async () => {
    await receive(10);
    await adjust(-6);
    const archived = await client('OWNER').patch(`/products/${shirtProduct.id}/status`, {
      status: 'ARCHIVED',
    });
    expect(archived.status).toBe(200);
    expect(await dispatch()).toEqual({ delivered: 1, failed: 0 });
    expect(await ctx.prisma.notification.count()).toBe(0);
  });
});

describe('recipients', () => {
  test('deactivated members and disabled users are not notified', async () => {
    await ctx.prisma.organizationMembership.update({
      where: { id: org.members.MANAGER.membership.id },
      data: { status: 'DEACTIVATED' },
    });
    await ctx.prisma.user.update({
      where: { id: org.members.INVENTORY_MANAGER.user.id },
      data: { status: 'DISABLED' },
    });
    await client('OWNER').post('/inventory/receipts', {
      storeId: org.store.id,
      variantId: shirt.id,
      quantity: 10,
    });
    await client('OWNER').post('/inventory/adjustments', {
      storeId: org.store.id,
      variantId: shirt.id,
      change: -6,
      reason: 'DAMAGED',
    });
    await dispatch();
    expect(await recipients('inventory.low_stock')).toEqual(['OWNER']);
  });
});

describe('notification center', () => {
  beforeEach(async () => {
    await receive(20);
    await placeOrder('ORDER_MANAGER', [{ variantId: shirt.id, quantity: 1 }]);
    await placeOrder('ORDER_MANAGER', [{ variantId: shirt.id, quantity: 1 }]);
    await dispatch();
  });

  test('marks one or all as read, and counts what is unread', async () => {
    const owner = client('OWNER');
    expect((await owner.get('/notifications/unread-count')).body.data).toEqual({ count: 2 });

    const [newest, older] = (await owner.get('/notifications')).body.data;
    expect(newest.data.number).toBe(1002);
    const read = await owner.post(`/notifications/${older.id}/read`);
    expect(read.status).toBe(200);
    expect(read.body.data.readAt).not.toBeNull();
    // Reading it again keeps the first read time.
    const again = await owner.post(`/notifications/${older.id}/read`);
    expect(again.body.data.readAt).toBe(read.body.data.readAt);

    const unread = await owner.get('/notifications?unread=true');
    expect(unread.body.data.map((n) => n.id)).toEqual([newest.id]);
    expect(unread.body.meta).toMatchObject({ total: 1, unreadCount: 1 });

    expect((await owner.post('/notifications/read-all')).body.data).toEqual({ updated: 1 });
    expect((await owner.get('/notifications/unread-count')).body.data).toEqual({ count: 0 });
    // The manager's copies are separate and still unread.
    expect((await client('MANAGER').get('/notifications/unread-count')).body.data.count).toBe(2);
  });

  test("another member's notification cannot be read or marked", async () => {
    const managers = await client('MANAGER').get('/notifications');
    const theirs = managers.body.data[0].id;
    const res = await client('OWNER').post(`/notifications/${theirs}/read`);
    expect(res.status).toBe(404);
    expect((await ctx.prisma.notification.findUnique({ where: { id: theirs } })).readAt).toBeNull();
  });

  test('members whose role does not receive a type see none of it', async () => {
    for (const role of ['ANALYST', 'INVENTORY_MANAGER', 'ORDER_MANAGER']) {
      const res = await client(role).get('/notifications');
      expect({ role, total: res.body.meta.total }).toEqual({ role, total: 0 });
    }
    // A manager moved to analyst stops seeing what the old role brought.
    await ctx.prisma.organizationMembership.update({
      where: { id: org.members.MANAGER.membership.id },
      data: { role: 'ANALYST' },
    });
    const demoted = client('MANAGER');
    expect((await demoted.get('/notifications')).body.meta.total).toBe(0);
    expect((await demoted.get('/notifications/unread-count')).body.data.count).toBe(0);
    expect((await demoted.post('/notifications/read-all')).body.data.updated).toBe(0);
  });

  test('another organization sees none of it', async () => {
    const other = await organizationWithAllRoles(ctx.app, ctx.prisma);
    const res = await other.members.OWNER.client.get('/notifications');
    expect(res.body.meta).toMatchObject({ total: 0, unreadCount: 0 });
  });
});

describe('email copies', () => {
  test('are off by default, opt-in per type, and go only to members who asked', async () => {
    const owner = client('OWNER');
    expect((await owner.get('/notifications/preferences')).body.data).toEqual([
      { type: 'order.placed', email: false },
      { type: 'inventory.low_stock', email: false },
    ]);
    const saved = await owner.put('/notifications/preferences', {
      email: { 'order.placed': true },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual([
      { type: 'order.placed', email: true },
      { type: 'inventory.low_stock', email: false },
    ]);

    await receive(20);
    const { id } = await placeOrder('ORDER_MANAGER', [{ variantId: shirt.id, quantity: 3 }]);
    await dispatch();
    const email = await lastEmailTo(ctx, org.members.OWNER.user.email);
    expect(email.subject).toBe(`New order #1001 in ${org.organization.name}`);
    expect(email.text).toContain('3 items, 300.00 USD');
    expect(email.text).toContain(`/orders/${id}`);
    // The manager gets the in-app notification but did not ask for email.
    expect(await lastEmailTo(ctx, org.members.MANAGER.user.email)).toBeNull();

    const delivery = await ctx.prisma.emailDelivery.findFirst({
      where: { kind: 'notification.order_placed' },
    });
    expect(delivery).toMatchObject({ organizationId: org.organization.id, status: 'SENT' });
  });

  test('low-stock email names the product, the store and what is left', async () => {
    await client('INVENTORY_MANAGER').put('/notifications/preferences', {
      email: { 'inventory.low_stock': true },
    });
    await receive(10);
    await adjust(-10);
    await dispatch();
    const email = await lastEmailTo(ctx, org.members.INVENTORY_MANAGER.user.email);
    expect(email.subject).toBe(`Out of stock: SHIRT-1 in ${org.organization.name}`);
    expect(email.text).toContain('is out of stock at Main store');
  });

  test('unverified addresses get no email', async () => {
    await client('OWNER').put('/notifications/preferences', { email: { 'order.placed': true } });
    await ctx.prisma.user.update({
      where: { id: org.members.OWNER.user.id },
      data: { emailVerifiedAt: null },
    });
    await receive(20);
    await placeOrder('ORDER_MANAGER', [{ variantId: shirt.id, quantity: 1 }]);
    await dispatch();
    expect(await lastEmailTo(ctx, org.members.OWNER.user.email)).toBeNull();
    expect(await ctx.prisma.notification.count({ where: { type: 'order.placed' } })).toBe(2);
  });

  test('a member cannot turn on a type their role does not receive, or an unknown one', async () => {
    const analyst = client('ANALYST');
    expect((await analyst.get('/notifications/preferences')).body.data).toEqual([]);
    const res = await analyst.put('/notifications/preferences', {
      email: { 'order.placed': true },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors['email.order.placed']).toBeDefined();
    const unknown = await client('OWNER').put('/notifications/preferences', {
      email: { 'billing.everything': true },
    });
    expect(unknown.status).toBe(400);
    const membership = await ctx.prisma.organizationMembership.findUnique({
      where: { id: org.members.ANALYST.membership.id },
    });
    expect(membership.emailNotifications).toEqual([]);
  });
});

describe('delivery', () => {
  const event = (payload, type = 'order.placed') =>
    ctx.prisma.notificationEvent.create({
      data: { organizationId: org.organization.id, type, payload },
    });

  test('a broken event is retried a few times and does not block the others', async () => {
    const broken = await event({ orderId: 'not-a-uuid' });
    await receive(20);
    await placeOrder('ORDER_MANAGER', [{ variantId: shirt.id, quantity: 1 }]);

    expect(await dispatch()).toEqual({ delivered: 1, failed: 1 });
    expect(await ctx.prisma.notification.count({ where: { type: 'order.placed' } })).toBe(2);
    const failed = await ctx.prisma.notificationEvent.findUnique({ where: { id: broken.id } });
    expect(failed).toMatchObject({ attempts: 1, processedAt: null });
    expect(failed.lastError).toBeTruthy();

    for (let i = 1; i < MAX_EVENT_ATTEMPTS; i += 1) await dispatch();
    expect(
      (await ctx.prisma.notificationEvent.findUnique({ where: { id: broken.id } })).attempts,
    ).toBe(MAX_EVENT_ATTEMPTS);
    // Given up: it is no longer picked up.
    expect(await dispatch()).toEqual({ delivered: 0, failed: 0 });
  });

  test('an event without its ids is refused rather than matched to some other record', async () => {
    await receive(20);
    await placeOrder('ORDER_MANAGER', [{ variantId: shirt.id, quantity: 1 }]);
    await dispatch();
    await event({});
    expect(await dispatch()).toEqual({ delivered: 0, failed: 1 });
    expect(await ctx.prisma.notification.count()).toBe(2);
  });

  test('two dispatchers running at once deliver each event once', async () => {
    await receive(50);
    for (let i = 0; i < 4; i += 1) {
      await placeOrder('ORDER_MANAGER', [{ variantId: shirt.id, quantity: 1 }]);
    }
    const results = await Promise.all([dispatch(), dispatch(), dispatch()]);
    expect(results.reduce((sum, r) => sum + r.delivered, 0)).toBe(4);
    expect(await ctx.prisma.notification.count()).toBe(8);
  });

  test('cleanup removes old notifications and delivered events, and keeps pending ones', async () => {
    await receive(20);
    await placeOrder('ORDER_MANAGER', [{ variantId: shirt.id, quantity: 1 }]);
    await dispatch();
    const pending = await event({ orderId: '00000000-0000-4000-8000-000000000000' });
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await ctx.prisma.notification.updateMany({ data: { createdAt: old } });
    await ctx.prisma.notificationEvent.updateMany({ data: { createdAt: old } });

    expect(await ctx.notifications.cleanup()).toEqual({ notifications: 2, events: 1 });
    expect((await ctx.prisma.notificationEvent.findMany()).map((e) => e.id)).toEqual([pending.id]);
  });

  test('the worker delivers events on its own, without needing Redis', async () => {
    const worker = createNotificationWorker({
      prisma: ctx.prisma,
      emails: ctx.emails,
      logger: { error() {}, warn() {}, info() {} },
      env: { ...ctx.env, NOTIFICATION_POLL_MS: 100 },
    });
    try {
      await worker.start();
      await receive(20);
      await placeOrder('ORDER_MANAGER', [{ variantId: shirt.id, quantity: 1 }]);
      // Emptying Redis (as a restart without persistence would) must not stop delivery.
      await ctx.redis.flushdb();
      const deadline = Date.now() + 10_000;
      while ((await ctx.prisma.notification.count()) < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await ctx.prisma.notification.count()).toBe(2);
    } finally {
      await worker.close();
    }
  });
});
