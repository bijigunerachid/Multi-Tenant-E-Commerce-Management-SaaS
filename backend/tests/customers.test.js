import { createTestApp, resetState } from './helpers/testApp.js';
import { createOrganization, organizationWithAllRoles, signIn } from './helpers/factories.js';

let ctx;
let org;
let owner;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await resetState(ctx);
  org = await organizationWithAllRoles(ctx.app, ctx.prisma);
  owner = org.members.OWNER.client;
});

const ADDRESS = { line1: '12 Rue Atlas', city: 'Casablanca', postalCode: '20000', country: 'ma' };
const create = (body) => owner.post('/customers', body);

describe('customer profiles', () => {
  test('creates a customer with a default address; email is normalised', async () => {
    const res = await create({
      name: ' Amina Haddad ',
      email: 'Amina@Example.COM',
      phone: '+212 600 000 000',
      address: ADDRESS,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Amina Haddad',
      email: 'amina@example.com',
      phone: '+212 600 000 000',
      archived: false,
      addresses: [
        expect.objectContaining({ line1: '12 Rue Atlas', country: 'MA', isDefault: true }),
      ],
    });
  });

  test('emails are unique per organization, optional, and free to repeat across organizations', async () => {
    await create({ name: 'A', email: 'same@example.com' });
    const dup = await create({ name: 'B', email: 'SAME@example.com' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.fieldErrors.email).toBeDefined();

    expect((await create({ name: 'Walk-in 1' })).status).toBe(201);
    expect((await create({ name: 'Walk-in 2', email: '' })).body.data.email).toBeNull();

    const other = await createOrganization(ctx.prisma);
    const otherClient = await signIn(ctx.app, other.owner);
    expect(
      (await otherClient.post('/customers', { name: 'A', email: 'same@example.com' })).status,
    ).toBe(201);
  });

  test('validates names, phones and countries', async () => {
    const res = await create({
      name: '',
      phone: 'call me',
      address: { ...ADDRESS, country: 'XX', city: '' },
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details.fieldErrors).sort()).toEqual(
      ['address.city', 'address.country', 'name', 'phone'].sort(),
    );
  });

  test('only real countries are accepted', async () => {
    for (const country of ['EU', 'UN', 'ZZ', 'XX', 'MAR']) {
      const res = await create({ name: 'A', address: { ...ADDRESS, country } });
      expect({ country, status: res.status }).toEqual({ country, status: 400 });
    }
    expect((await create({ name: 'A', address: { ...ADDRESS, country: 'fr' } })).status).toBe(201);
  });

  test('a partial update changes only the fields sent', async () => {
    const c = (await create({ name: 'Amina', email: 'a@example.com', notes: 'Prefers WhatsApp' }))
      .body.data;
    const res = await owner.patch(`/customers/${c.id}`, { phone: '0600000000' });
    expect(res.body.data).toMatchObject({
      name: 'Amina',
      email: 'a@example.com',
      phone: '0600000000',
      notes: 'Prefers WhatsApp',
    });

    const cleared = await owner.patch(`/customers/${c.id}`, { email: '' });
    expect(cleared.body.data.email).toBeNull();
  });

  test('archives, restores and deletes; the audit log keeps no personal data', async () => {
    const c = (await create({ name: 'Amina', email: 'a@example.com', address: ADDRESS })).body.data;
    expect(
      (await owner.patch(`/customers/${c.id}/status`, { archived: true })).body.data.archived,
    ).toBe(true);
    expect((await owner.get('/customers')).body.data).toHaveLength(0);
    expect((await owner.get('/customers?status=archived')).body.data).toHaveLength(1);
    expect(
      (await owner.patch(`/customers/${c.id}/status`, { archived: false })).body.data.archived,
    ).toBe(false);

    expect((await owner.delete(`/customers/${c.id}`)).status).toBe(204);
    expect(await ctx.prisma.address.count()).toBe(0);
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'customer.deleted' } });
    expect(audit.entityId).toBe(c.id);
    expect(JSON.stringify(audit)).not.toMatch(/Amina|a@example\.com/);
  });
});

describe('listing', () => {
  beforeEach(async () => {
    await create({
      name: 'Amina Haddad',
      email: 'amina@example.com',
      phone: '0611111111',
      address: ADDRESS,
      notes: 'VIP',
    });
    await create({ name: 'Omar Idrissi', email: 'omar@example.com' });
    await create({ name: 'Yasmine Benali', phone: '0622222222' });
  });

  test('searches name, email and phone, sorts and paginates', async () => {
    const names = async (q) => (await owner.get(`/customers?${q}`)).body.data.map((c) => c.name);
    expect(await names('search=omar@')).toEqual(['Omar Idrissi']);
    expect(await names('search=0622')).toEqual(['Yasmine Benali']);
    expect(await names('search=AMINA')).toEqual(['Amina Haddad']);
    expect(await names('sort=-name')).toEqual(['Yasmine Benali', 'Omar Idrissi', 'Amina Haddad']);
    const page2 = await owner.get('/customers?pageSize=2&page=2');
    expect(page2.body.meta).toEqual({ page: 2, pageSize: 2, total: 3 });
  });

  test('list rows carry only what the table needs (no notes or full addresses)', async () => {
    const [amina] = (await owner.get('/customers?search=amina')).body.data;
    expect(amina).toEqual({
      id: expect.any(String),
      name: 'Amina Haddad',
      email: 'amina@example.com',
      phone: '0611111111',
      archived: false,
      location: { city: 'Casablanca', country: 'MA' },
      createdAt: expect.any(String),
      orderCount: 0,
      spent: [],
    });
  });
});

describe('addresses', () => {
  test('one default address per customer, switched explicitly, promoted on delete', async () => {
    const c = (await create({ name: 'Amina', address: ADDRESS })).body.data;
    const home = c.addresses[0];

    const work = (
      await owner.post(`/customers/${c.id}/addresses`, {
        label: 'Work',
        line1: '1 Bd Zerktouni',
        city: 'Casablanca',
        country: 'MA',
      })
    ).body.data;
    expect(work.isDefault).toBe(false);

    const switched = await owner.patch(`/customers/${c.id}/addresses/${work.id}`, {
      isDefault: true,
    });
    expect(switched.body.data.isDefault).toBe(true);
    let detail = (await owner.get(`/customers/${c.id}`)).body.data;
    expect(detail.addresses.map((a) => [a.id, a.isDefault])).toEqual([
      [work.id, true],
      [home.id, false],
    ]);

    const unset = await owner.patch(`/customers/${c.id}/addresses/${work.id}`, {
      isDefault: false,
    });
    expect(unset.status).toBe(400);

    expect((await owner.delete(`/customers/${c.id}/addresses/${work.id}`)).status).toBe(204);
    detail = (await owner.get(`/customers/${c.id}`)).body.data;
    expect(detail.addresses).toEqual([expect.objectContaining({ id: home.id, isDefault: true })]);
  });

  test('the first address added becomes the default', async () => {
    const c = (await create({ name: 'No address yet' })).body.data;
    const first = await owner.post(`/customers/${c.id}/addresses`, ADDRESS);
    expect(first.body.data.isDefault).toBe(true);
  });

  test('an address is only reachable under its own customer', async () => {
    const a = (await create({ name: 'A', address: ADDRESS })).body.data;
    const b = (await create({ name: 'B' })).body.data;
    const path = `/customers/${b.id}/addresses/${a.addresses[0].id}`;
    expect((await owner.patch(path, { city: 'Moved' })).status).toBe(404);
    expect((await owner.delete(path)).status).toBe(404);
    expect((await ctx.prisma.address.findUnique({ where: { id: a.addresses[0].id } })).city).toBe(
      'Casablanca',
    );
  });

  test('the database refuses a second default address', async () => {
    const c = (await create({ name: 'Amina', address: ADDRESS })).body.data;
    const second = (await owner.post(`/customers/${c.id}/addresses`, ADDRESS)).body.data;
    await expect(
      ctx.prisma.address.update({ where: { id: second.id }, data: { defaultForCustomerId: c.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('CSV export', () => {
  test('exports matching customers with safe quoting and formula protection, and is audited', async () => {
    await create({
      name: 'Haddad, Amina',
      email: 'amina@example.com',
      phone: '+212600000000',
      address: ADDRESS,
    });
    await create({ name: '=HYPERLINK("http://evil.example","click")', email: 'x@example.com' });
    const archived = (await create({ name: 'Archived person' })).body.data;
    await owner.patch(`/customers/${archived.id}/status`, { archived: true });

    const res = await owner.agent
      .get('/api/v1/customers/export')
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (chunk) => (data += chunk));
        r.on('end', () => cb(null, data));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="customers-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const lines = res.body
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toBe('Name,Email,Phone,City,Country,Status,Created,Orders,Spent');
    expect(lines).toHaveLength(3); // header + 2 active customers
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^"Haddad, Amina",amina@example\.com,'\+212600000000,Casablanca,MA,Active,/,
      ),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^"'=HYPERLINK\(""http:\/\/evil\.example"",""click""\)",x@example\.com/,
      ),
    );

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'customer.exported' } });
    expect(audit.metadata).toMatchObject({ rows: 2, status: 'active' });
  });

  test('only owners and managers may export; analysts and inventory managers cannot see customers at all', async () => {
    expect((await org.members.MANAGER.client.agent.get('/api/v1/customers/export')).status).toBe(
      200,
    );
    expect(
      (await org.members.ORDER_MANAGER.client.agent.get('/api/v1/customers/export')).status,
    ).toBe(403);
    expect((await org.members.ORDER_MANAGER.client.get('/customers')).status).toBe(200);
    for (const role of ['ANALYST', 'INVENTORY_MANAGER']) {
      expect((await org.members[role].client.get('/customers')).status).toBe(403);
      expect((await org.members[role].client.agent.get('/api/v1/customers/export')).status).toBe(
        403,
      );
    }
  });
});

describe('purchase history', () => {
  async function setup() {
    const mug = (
      await owner.post('/products', {
        name: 'Ceramic mug',
        status: 'ACTIVE',
        variants: [{ sku: 'MUG-1', price: '10.00' }],
      })
    ).body.data;
    await owner.post('/inventory/receipts', {
      storeId: org.store.id,
      variantId: mug.variants[0].id,
      quantity: 100,
    });
    const amina = (await create({ name: 'Amina Haddad', email: 'amina@example.com' })).body.data;
    const order = async (quantity, steps) => {
      const o = (
        await owner.post('/orders', {
          customerId: amina.id,
          items: [{ variantId: mug.variants[0].id, quantity }],
        })
      ).body.data;
      for (const step of steps) {
        if (step === 'cancel') await owner.post(`/orders/${o.id}/cancel`, { reason: 'test' });
        else await owner.post(`/orders/${o.id}/transitions`, { action: step });
      }
      return o;
    };
    await order(3, ['place', 'confirm', 'start', 'ship', 'deliver']); // 30.00, counted
    await order(2, ['place']); // 20.00, counted (pending)
    await order(5, ['place', 'cancel']); // cancelled: not counted
    await order(9, []); // draft: not counted
    return amina;
  }

  test('counts placed, not-cancelled orders; drafts and cancellations are excluded', async () => {
    const amina = await setup();
    const res = await owner.get(`/customers/${amina.id}`);
    expect(res.body.data.stats).toMatchObject({
      orderCount: 2,
      spent: [{ currency: 'USD', total: '50.00', averageOrder: '25.00' }],
      cancelledCount: 1,
    });
    expect(
      new Date(res.body.data.stats.lastOrderAt) >= new Date(res.body.data.stats.firstOrderAt),
    ).toBe(true);

    const list = await owner.get('/customers?search=amina');
    expect(list.body.data[0]).toMatchObject({
      orderCount: 2,
      spent: [{ currency: 'USD', total: '50.00' }],
    });

    const history = await owner.get(`/orders?customerId=${amina.id}&sort=-createdAt`);
    expect(history.body.meta.total).toBe(4);
  });

  test('the CSV export includes order count and spending', async () => {
    await setup();
    const res = await owner.agent
      .get('/api/v1/customers/export')
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (chunk) => (data += chunk));
        r.on('end', () => cb(null, data));
      });
    const lines = res.body.split(/\r?\n/);
    const row = lines.find((line) => line.startsWith('Amina Haddad'));
    expect(row).toMatch(/,2,50\.00 USD$/);
  });

  test('a customer without orders has empty stats', async () => {
    const c = (await create({ name: 'New' })).body.data;
    const res = await owner.get(`/customers/${c.id}`);
    expect(res.body.data.stats).toEqual({
      orderCount: 0,
      spent: [],
      firstOrderAt: null,
      lastOrderAt: null,
      cancelledCount: 0,
    });
  });
});
