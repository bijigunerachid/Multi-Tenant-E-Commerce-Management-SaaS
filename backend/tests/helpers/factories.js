import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../src/utils/passwords.js';
import { apiClient } from './client.js';

export const PASSWORD = 'correct-horse-battery';
let passwordHash;

export async function createUser(prisma, overrides = {}) {
  passwordHash ??= await hashPassword(PASSWORD);
  const suffix = randomUUID().slice(0, 8);
  return prisma.user.create({
    data: {
      email: `user-${suffix}@example.com`,
      name: `User ${suffix}`,
      passwordHash,
      emailVerifiedAt: new Date(),
      ...overrides,
    },
  });
}

/** Creates an organization with its first store and an owner membership, directly in the DB. */
export async function createOrganization(prisma, { owner, name } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const ownerUser = owner ?? (await createUser(prisma));
  const organization = await prisma.organization.create({
    data: { name: name ?? `Org ${suffix}`, slug: `org-${suffix}` },
  });
  const store = await prisma.store.create({
    data: {
      organizationId: organization.id,
      name: 'Main store',
      slug: 'main-store',
      currency: 'USD',
      timezone: 'UTC',
    },
  });
  const ownerMembership = await prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: ownerUser.id, role: 'OWNER' },
  });
  return { organization, store, owner: ownerUser, ownerMembership };
}

export async function addMember(prisma, organizationId, role, { user, status = 'ACTIVE' } = {}) {
  const memberUser = user ?? (await createUser(prisma));
  const membership = await prisma.organizationMembership.create({
    data: { organizationId, userId: memberUser.id, role, status },
  });
  return { user: memberUser, membership };
}

/** Signs a user in through the API and returns a client holding the session. */
export async function signIn(app, user, password = PASSWORD) {
  const client = apiClient(app);
  const res = await client.post('/auth/login', { email: user.email, password });
  if (res.status !== 200) {
    throw new Error(`Sign-in failed for ${user.email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return client;
}

/**
 * An organization with one signed-in member per role. Returns
 * { organization, store, members: { OWNER: { user, membership, client }, ... } }.
 */
export async function organizationWithAllRoles(app, prisma) {
  const { organization, store, owner, ownerMembership } = await createOrganization(prisma);
  const members = { OWNER: { user: owner, membership: ownerMembership } };
  for (const role of ['MANAGER', 'INVENTORY_MANAGER', 'ORDER_MANAGER', 'ANALYST']) {
    members[role] = await addMember(prisma, organization.id, role);
  }
  for (const role of Object.keys(members)) {
    members[role].client = await signIn(app, members[role].user);
  }
  return { organization, store, members };
}

// A real 1×1 PNG.
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export function productInput(overrides = {}) {
  const suffix = randomUUID().slice(0, 6).toUpperCase();
  return {
    name: `Linen shirt ${suffix}`,
    status: 'ACTIVE',
    variants: [
      { sku: `SHIRT-${suffix}-M`, options: { size: 'M' }, price: '29.90', cost: '12.00' },
      { sku: `SHIRT-${suffix}-L`, options: { size: 'L' }, price: '31.90', cost: '12.50' },
    ],
    ...overrides,
  };
}

/** Uploads an image with the client's session and CSRF token. */
export function uploadImage(client, productId, buffer = TINY_PNG, filename = 'photo.png') {
  return client.agent
    .post(`/api/v1/products/${productId}/images`)
    .set('Origin', 'http://localhost:5173')
    .set('X-CSRF-Token', client.csrfToken)
    .attach('file', buffer, filename);
}

/** The text of the last email sent to `to`, and the token in its link. */
export function lastEmailTo(mailer, to) {
  const message = [...mailer.sent].reverse().find((m) => m.to === to);
  if (!message) return null;
  const token = message.text.match(/token=([A-Za-z0-9_-]+)/)?.[1] ?? null;
  return { ...message, token };
}
