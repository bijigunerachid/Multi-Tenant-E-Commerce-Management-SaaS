import { createTestApp, resetState } from './helpers/testApp.js';
import {
  TINY_PNG,
  createOrganization,
  organizationWithAllRoles,
  productInput,
  signIn,
  uploadImage,
} from './helpers/factories.js';

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

describe('categories', () => {
  test('create, nest, rename and list with product counts', async () => {
    const apparel = await owner.post('/categories', { name: 'Apparel' });
    expect(apparel.status).toBe(201);
    expect(apparel.body.data).toMatchObject({ name: 'Apparel', slug: 'apparel', parentId: null });

    const shirts = await owner.post('/categories', {
      name: 'Shirts',
      parentId: apparel.body.data.id,
    });
    await owner.post('/products', productInput({ categoryId: shirts.body.data.id }));

    const renamed = await owner.patch(`/categories/${shirts.body.data.id}`, {
      name: 'Shirts & tops',
    });
    expect(renamed.body.data.name).toBe('Shirts & tops');

    const list = await owner.get('/categories');
    expect(list.body.data).toEqual([
      expect.objectContaining({ name: 'Apparel', childCount: 1, productCount: 0 }),
      expect.objectContaining({
        name: 'Shirts & tops',
        parentId: apparel.body.data.id,
        productCount: 1,
      }),
    ]);
  });

  test('rejects cycles and duplicate addresses', async () => {
    const a = await owner.post('/categories', { name: 'A' });
    const b = await owner.post('/categories', { name: 'B', parentId: a.body.data.id });

    const cycle = await owner.patch(`/categories/${a.body.data.id}`, { parentId: b.body.data.id });
    expect(cycle.status).toBe(400);
    expect(cycle.body.error.details.fieldErrors.parentId).toMatch(/inside itself/);

    const self = await owner.patch(`/categories/${a.body.data.id}`, { parentId: a.body.data.id });
    expect(self.status).toBe(400);

    const dup = await owner.post('/categories', { name: 'a' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.fieldErrors.slug).toBeDefined();
  });

  test('a category in use cannot be deleted; an empty one can', async () => {
    const used = await owner.post('/categories', { name: 'Used' });
    await owner.post('/products', productInput({ categoryId: used.body.data.id }));
    const blocked = await owner.delete(`/categories/${used.body.data.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CATEGORY_IN_USE');

    const empty = await owner.post('/categories', { name: 'Empty' });
    expect((await owner.delete(`/categories/${empty.body.data.id}`)).status).toBe(204);
  });
});

describe('products', () => {
  test('creates a product with variants; money is exact and in the organization currency', async () => {
    const res = await owner.post('/products', {
      name: 'Linen shirt',
      description: 'Breathable linen.',
      status: 'ACTIVE',
      variants: [
        { sku: ' shirt-m ', options: { size: 'M', color: 'Sand' }, price: 29.9, cost: '12' },
        { sku: 'SHIRT-L', name: 'Large', price: '0.10', lowStockThreshold: 2 },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Linen shirt', status: 'ACTIVE' });
    expect(res.body.data.variants).toEqual([
      expect.objectContaining({
        sku: 'SHIRT-M',
        name: 'M / Sand',
        price: '29.90',
        cost: '12.00',
        currency: 'USD',
        lowStockThreshold: 5,
      }),
      expect.objectContaining({
        sku: 'SHIRT-L',
        name: 'Large',
        price: '0.10',
        cost: null,
        lowStockThreshold: 2,
      }),
    ]);
  });

  test('validates input with field errors per variant row', async () => {
    const res = await owner.post('/products', {
      name: '',
      variants: [
        { sku: 'BAD SKU', price: '-1' },
        { sku: 'OK-1', price: '1.999' },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        'variants.0.sku': expect.any(String),
        'variants.0.price': expect.any(String),
        'variants.1.price': expect.any(String),
      }),
    );

    const none = await owner.post('/products', { name: 'Empty', variants: [] });
    expect(none.body.error.details.fieldErrors.variants).toBe('Add at least one variant');
  });

  test('SKUs are unique within an organization (case-insensitively) but may repeat across organizations', async () => {
    await owner.post('/products', productInput({ variants: [{ sku: 'MUG-1', price: '9' }] }));

    const clash = await owner.post(
      '/products',
      productInput({ variants: [{ sku: 'mug-1', price: '9' }] }),
    );
    expect(clash.status).toBe(409);
    expect(clash.body.error.details.fieldErrors['variants.0.sku']).toMatch(/already used/);

    const twice = await owner.post(
      '/products',
      productInput({
        variants: [
          { sku: 'A-1', price: '1' },
          { sku: 'a-1', price: '1' },
        ],
      }),
    );
    expect(twice.body.error.details.fieldErrors['variants.1.sku']).toMatch(/twice/);

    const other = await createOrganization(ctx.prisma);
    const otherClient = await signIn(ctx.app, other.owner);
    const elsewhere = await otherClient.post(
      '/products',
      productInput({ variants: [{ sku: 'MUG-1', price: '9' }] }),
    );
    expect(elsewhere.status).toBe(201);
  });

  test('PUT updates, adds and removes variants, and lets two variants swap SKUs', async () => {
    const created = (await owner.post('/products', productInput())).body.data;
    const [m, l] = created.variants;

    const res = await owner.put(`/products/${created.id}`, {
      name: 'Renamed shirt',
      status: 'ACTIVE',
      variants: [
        { id: m.id, sku: l.sku, options: m.options, price: '25.00' },
        { id: l.id, sku: m.sku, options: l.options, price: '27.00' },
        { sku: 'SHIRT-NEW-XL', options: { size: 'XL' }, price: '33.00' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed shirt');
    expect(res.body.data.variants.map((v) => [v.id ?? null, v.sku, v.price])).toEqual([
      [m.id, l.sku, '25.00'],
      [l.id, m.sku, '27.00'],
      [expect.any(String), 'SHIRT-NEW-XL', '33.00'],
    ]);

    const dropped = await owner.put(`/products/${created.id}`, {
      name: 'Renamed shirt',
      status: 'ACTIVE',
      variants: [{ id: m.id, sku: l.sku, price: '25.00' }],
    });
    expect(dropped.body.data.variants).toHaveLength(1);
  });

  test('a variant id from another product is rejected', async () => {
    const a = (await owner.post('/products', productInput())).body.data;
    const b = (await owner.post('/products', productInput())).body.data;
    const res = await owner.put(`/products/${a.id}`, {
      name: a.name,
      variants: [{ id: b.variants[0].id, sku: 'STOLEN-1', price: '1' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors['variants.0.id']).toBeDefined();
    const bAfter = await ctx.prisma.productVariant.findUnique({ where: { id: b.variants[0].id } });
    expect(bAfter.sku).toBe(b.variants[0].sku);
  });

  test('archiving sets the status and hides the product from the default list', async () => {
    const p = (await owner.post('/products', productInput())).body.data;
    const archived = await owner.patch(`/products/${p.id}/status`, { status: 'ARCHIVED' });
    expect(archived.body.data.status).toBe('ARCHIVED');

    expect((await owner.get('/products')).body.data).toHaveLength(0);
    expect((await owner.get('/products?status=ARCHIVED')).body.data).toHaveLength(1);
    expect((await owner.get('/products?status=ALL')).body.data).toHaveLength(1);

    const row = await ctx.prisma.product.findUnique({ where: { id: p.id } });
    expect(row.archivedAt).not.toBeNull();
  });

  test('lists with search (name or SKU), filters, sorting and pagination', async () => {
    const tees = await owner.post('/categories', { name: 'Tees' });
    await owner.post(
      '/products',
      productInput({
        name: 'Alpha tee',
        categoryId: tees.body.data.id,
        variants: [{ sku: 'TEE-ALPHA', price: '10' }],
      }),
    );
    await owner.post(
      '/products',
      productInput({
        name: 'Beta mug',
        variants: [
          { sku: 'MUG-BETA', price: '5' },
          { sku: 'MUG-BETA-2', price: '7.5' },
        ],
      }),
    );
    await owner.post(
      '/products',
      productInput({
        name: 'Gamma tee',
        categoryId: tees.body.data.id,
        variants: [{ sku: 'TEE-GAMMA', price: '12' }],
      }),
    );

    const bySku = await owner.get('/products?search=mug-beta');
    expect(bySku.body.data.map((p) => p.name)).toEqual(['Beta mug']);
    expect(bySku.body.data[0]).toMatchObject({
      variantCount: 2,
      priceMin: '5.00',
      priceMax: '7.50',
      currency: 'USD',
    });

    const inCategory = await owner.get(`/products?categoryId=${tees.body.data.id}&sort=name`);
    expect(inCategory.body.data.map((p) => p.name)).toEqual(['Alpha tee', 'Gamma tee']);

    const page2 = await owner.get('/products?sort=name&pageSize=2&page=2');
    expect(page2.body.meta).toEqual({ page: 2, pageSize: 2, total: 3 });
    expect(page2.body.data.map((p) => p.name)).toEqual(['Gamma tee']);

    const badSort = await owner.get('/products?sort=passwordHash');
    expect(badSort.status).toBe(400);
  });

  test('a product can be deleted, together with its variants and images', async () => {
    const p = (await owner.post('/products', productInput())).body.data;
    await uploadImage(owner, p.id);
    expect((await owner.delete(`/products/${p.id}`)).status).toBe(204);
    expect((await owner.get(`/products/${p.id}`)).status).toBe(404);
    expect(await ctx.prisma.productVariant.count({ where: { productId: p.id } })).toBe(0);
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'product.deleted' } });
    expect(audit.metadata.skus).toHaveLength(2);
  });

  test('a category from another organization cannot be assigned', async () => {
    const other = await createOrganization(ctx.prisma);
    const otherClient = await signIn(ctx.app, other.owner);
    const foreign = (await otherClient.post('/categories', { name: 'Theirs' })).body.data;

    const res = await owner.post('/products', productInput({ categoryId: foreign.id }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.categoryId).toBeDefined();
  });

  test('read-only roles can browse but not change the catalog', async () => {
    const p = (await owner.post('/products', productInput())).body.data;
    for (const role of ['INVENTORY_MANAGER', 'ORDER_MANAGER', 'ANALYST']) {
      const client = org.members[role].client;
      expect((await client.get(`/products/${p.id}`)).status).toBe(200);
      expect((await client.put(`/products/${p.id}`, productInput())).status).toBe(403);
      expect((await client.post('/categories', { name: 'Nope' })).status).toBe(403);
    }
    expect(
      (await org.members.MANAGER.client.patch(`/products/${p.id}/status`, { status: 'DRAFT' }))
        .status,
    ).toBe(200);
  });
});

describe('product images', () => {
  test('uploads a real image, serves it to members with safe headers, and deletes it', async () => {
    const p = (await owner.post('/products', productInput())).body.data;
    const up = await uploadImage(owner, p.id);
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({
      mimeType: 'image/png',
      sizeBytes: TINY_PNG.length,
      position: 0,
    });

    const file = await org.members.ANALYST.client.agent.get(up.body.data.url).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(file.body, TINY_PNG)).toBe(0);

    const detail = await owner.get(`/products/${p.id}`);
    expect(detail.body.data.images).toHaveLength(1);

    expect((await owner.delete(`/products/${p.id}/images/${up.body.data.id}`)).status).toBe(204);
    expect((await owner.agent.get(up.body.data.url)).status).toBe(404);
  });

  test('rejects files that are not really images, whatever their name says', async () => {
    const p = (await owner.post('/products', productInput())).body.data;
    const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(64, ' '));
    const res = await uploadImage(owner, p.id, html, 'innocent.png');
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.file).toMatch(/JPEG, PNG or WebP/);
    expect(await ctx.prisma.productImage.count()).toBe(0);
  });

  test('rejects files over 5 MB', async () => {
    const p = (await owner.post('/products', productInput())).body.data;
    const big = Buffer.concat([TINY_PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await uploadImage(owner, p.id, big);
    expect(res.status).toBe(413);
  });

  test('caps images at 10 per product', async () => {
    const p = (await owner.post('/products', productInput())).body.data;
    for (let i = 0; i < 10; i += 1) expect((await uploadImage(owner, p.id)).status).toBe(201);
    const eleventh = await uploadImage(owner, p.id);
    expect(eleventh.status).toBe(409);
    expect(eleventh.body.error.code).toBe('TOO_MANY_IMAGES');
  });

  test('an image is only reachable under its own product', async () => {
    const a = (await owner.post('/products', productInput())).body.data;
    const b = (await owner.post('/products', productInput())).body.data;
    const img = (await uploadImage(owner, a.id)).body.data;
    const wrongPath = `/products/${b.id}/images/${img.id}`;

    expect((await owner.agent.get(`/api/v1${wrongPath}/file`)).status).toBe(404);
    expect((await owner.patch(wrongPath, { altText: 'Moved?' })).status).toBe(404);
    expect((await owner.delete(wrongPath)).status).toBe(404);
    expect(await ctx.prisma.productImage.count({ where: { id: img.id, altText: null } })).toBe(1);
  });

  test('anonymous visitors and other organizations cannot fetch an image', async () => {
    const p = (await owner.post('/products', productInput())).body.data;
    const up = await uploadImage(owner, p.id);

    const { default: request } = await import('supertest');
    expect((await request(ctx.app).get(up.body.data.url)).status).toBe(401);

    const other = await createOrganization(ctx.prisma);
    const otherClient = await signIn(ctx.app, other.owner);
    expect((await otherClient.agent.get(up.body.data.url)).status).toBe(404);
  });
});
