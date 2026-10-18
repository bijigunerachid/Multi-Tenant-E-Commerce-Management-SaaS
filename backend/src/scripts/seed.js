/* eslint-disable no-console -- a command-line script: printing is its output. */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { createPrismaClient } from '../config/database.js';
import { createRedisClient } from '../config/redis.js';
import { createLocalStorage } from '../services/storage.js';
import { hashPassword } from '../utils/passwords.js';
import { createApp } from '../app.js';

// `npm run db:seed -w backend`: a demo shop to try Vendora with, in the development database.
// - Refuses to run in production.
// - Idempotent: if the demo organization exists, it changes nothing and says so.
// - Goes through the real API (validation, permissions, stock reservations, audit log), so the
//   data is exactly what using the app would produce. Only the demo users are created directly,
//   already verified, since there is no inbox to confirm them from.
// Password: SEED_PASSWORD if set, otherwise a random one printed at the end.

const DEMO_SLUG = 'demo-atlas-outfitters';
const OWNER_EMAIL = 'owner@demo.vendora.local';
const STAFF = [
  ['manager@demo.vendora.local', 'Youssef Benali', 'MANAGER'],
  ['stock@demo.vendora.local', 'Salma Idrissi', 'INVENTORY_MANAGER'],
  ['orders@demo.vendora.local', 'Karim Tazi', 'ORDER_MANAGER'],
];

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  console.error('The demo seed never runs in production.');
  process.exit(1);
}
const logger = createLogger({ level: 'warn' });
const prisma = createPrismaClient({ databaseUrl: env.DATABASE_URL });
const redis = createRedisClient({ redisUrl: env.REDIS_URL, logger });
const password = process.env.SEED_PASSWORD ?? randomBytes(9).toString('base64url');

/** A minimal browser for the in-process API: session cookie, CSRF token and Origin. */
function apiClient(baseUrl) {
  let cookie = '';
  let csrf = '';
  return async function call(method, path, body) {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: env.CORS_ORIGINS[0],
        ...(cookie ? { cookie } : {}),
        ...(csrf && method !== 'GET' ? { 'x-csrf-token': csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const json = res.status === 204 ? null : await res.json();
    const token = json?.data?.csrfToken ?? json?.data?.session?.csrfToken;
    if (token) csrf = token;
    if (!res.ok) {
      throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json?.error ?? json)}`);
    }
    return json?.data;
  };
}

/** Demo users only: their password is (re)set on every run, so it is always the one printed. */
async function ensureUser(email, name) {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash, emailVerifiedAt: new Date() },
    update: { passwordHash, status: 'ACTIVE' },
  });
}

async function seed(api) {
  await api('POST', '/auth/login', { email: OWNER_EMAIL, password });
  const { organization } = await api('POST', '/organizations', {
    name: 'Atlas Outfitters',
    slug: DEMO_SLUG,
    storeName: 'Casablanca flagship',
    defaultCurrency: 'MAD',
    timezone: 'Africa/Casablanca',
  });
  const [flagship] = await api('GET', '/stores');
  const medina = await api('POST', '/stores', {
    name: 'Marrakech medina',
    currency: 'MAD',
    timezone: 'Africa/Casablanca',
  });

  for (const [email, , role] of STAFF) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.organizationMembership.create({
      data: { organizationId: organization.id, userId: user.id, role },
    });
  }

  const category = {};
  for (const name of ['Textiles', 'Ceramics', 'Leather', 'Lighting']) {
    category[name] = (await api('POST', '/categories', { name })).id;
  }
  const products = [
    [
      'Linen shirt',
      'Textiles',
      [
        ['SHIRT-LIN-S', 'S', '349.00', '140.00'],
        ['SHIRT-LIN-M', 'M', '349.00', '140.00'],
        ['SHIRT-LIN-L', 'L', '369.00', '150.00'],
      ],
    ],
    ['Berber wool blanket', 'Textiles', [['BLNK-WOOL', null, '1450.00', '620.00']]],
    [
      'Zellige mug',
      'Ceramics',
      [
        ['MUG-ZEL-BL', 'Cobalt', '89.50', '32.00'],
        ['MUG-ZEL-GR', 'Green', '89.50', '32.00'],
      ],
    ],
    ['Tagine, hand-painted', 'Ceramics', [['TAG-PAINT-M', null, '420.00', '170.00']]],
    [
      'Leather pouf',
      'Leather',
      [
        ['POUF-TAN', 'Tan', '1200.00', '480.00'],
        ['POUF-BRN', 'Brown', '1200.00', '480.00'],
      ],
    ],
    ['Brass lantern', 'Lighting', [['LANT-BR-S', null, '560.00', '210.00']]],
  ];
  const variants = {};
  for (const [name, cat, rows] of products) {
    const optioned = rows[0][1] !== null;
    const product = await api('POST', '/products', {
      name,
      status: 'ACTIVE',
      categoryId: category[cat],
      variants: rows.map(([sku, option, price, cost]) => ({
        sku,
        price,
        cost,
        ...(optioned ? { options: { [cat === 'Textiles' ? 'Size' : 'Color']: option } } : {}),
      })),
    });
    for (const v of product.variants) variants[v.sku] = v.id;
  }

  // Stock in both stores; a few lines kept near their low-stock threshold of 5.
  const stock = { flagship: { 'POUF-TAN': 7, 'LANT-BR-S': 6 }, medina: { 'BLNK-WOOL': 4 } };
  for (const [key, store] of [
    ['flagship', flagship],
    ['medina', medina],
  ]) {
    for (const [sku, variantId] of Object.entries(variants)) {
      await api('POST', '/inventory/receipts', {
        storeId: store.id,
        variantId,
        quantity: stock[key][sku] ?? (key === 'flagship' ? 40 : 18),
        note: 'Opening stock',
      });
    }
  }

  const customers = [];
  for (const [name, email, city] of [
    ['Amina Haddad', 'amina.haddad@example.com', 'Casablanca'],
    ['Omar El Fassi', 'omar.elfassi@example.com', 'Rabat'],
    ['Leila Chraibi', 'leila.chraibi@example.com', 'Marrakech'],
  ]) {
    customers.push(
      await api('POST', '/customers', {
        name,
        email,
        address: { line1: '12 Rue Atlas', city, country: 'MA' },
      }),
    );
  }

  const order = async (customer, items, actions, extra = {}) => {
    const draft = await api('POST', '/orders', {
      customerId: customer.id,
      shippingAddressId: customer.addresses[0].id,
      items: items.map(([sku, quantity]) => ({ variantId: variants[sku], quantity })),
      shippingTotal: '35.00',
      ...extra,
    });
    for (const action of actions) {
      if (action === 'cancel') {
        await api('POST', `/orders/${draft.id}/cancel`, { reason: 'Customer changed their mind' });
      } else {
        await api('POST', `/orders/${draft.id}/transitions`, { action });
      }
    }
  };
  const shipped = ['place', 'confirm', 'start', 'ship'];
  await order(
    customers[0],
    [
      ['SHIRT-LIN-M', 2],
      ['MUG-ZEL-BL', 4],
    ],
    [...shipped, 'deliver'],
  );
  await order(customers[1], [['POUF-TAN', 2]], shipped);
  await order(
    customers[2],
    [
      ['BLNK-WOOL', 1],
      ['LANT-BR-S', 1],
    ],
    shipped,
    { discountTotal: '100.00' },
  );
  await order(customers[0], [['TAG-PAINT-M', 1]], ['place', 'confirm']);
  await order(customers[1], [['MUG-ZEL-GR', 6]], ['place']);
  await order(customers[2], [['SHIRT-LIN-L', 1]], ['place', 'cancel']);
  await order(customers[1], [['LANT-BR-S', 2]], []);
}

try {
  const done = await prisma.organization.findUnique({ where: { slug: DEMO_SLUG } });
  if (done) {
    console.log(`The demo shop already exists. Sign in as ${OWNER_EMAIL}.`);
  } else {
    await ensureUser(OWNER_EMAIL, 'Nadia Alaoui');
    for (const [email, name] of STAFF) await ensureUser(email, name);
    const uploadDir = env.UPLOAD_DIR;
    mkdirSync(uploadDir, { recursive: true });
    await redis.connect();
    const app = createApp({
      env,
      logger,
      prisma,
      redis,
      // No email is sent while seeding.
      emails: { enqueue: async () => null },
      storage: createLocalStorage({ rootDir: uploadDir }),
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      await seed(apiClient(`http://127.0.0.1:${server.address().port}`));
    } finally {
      server.close();
    }
    console.log(
      'Demo shop created: Atlas Outfitters (2 stores, 11 variants, 3 customers, 7 orders).',
    );
    console.log(`Sign in at ${env.APP_URL}/login`);
    console.log(`  Owner:  ${OWNER_EMAIL}`);
    for (const [email, , role] of STAFF) console.log(`  ${role.padEnd(18)} ${email}`);
    console.log(
      process.env.SEED_PASSWORD
        ? '  Password: the value of SEED_PASSWORD'
        : `  Password: ${password}  (shown once; set SEED_PASSWORD to choose it)`,
    );
  }
} finally {
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
}
