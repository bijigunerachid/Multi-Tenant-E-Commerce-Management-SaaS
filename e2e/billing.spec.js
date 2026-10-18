import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { apiFromPage, registerAndOnboard, uniqueEmail } from './helpers.js';

// Ending a trial takes 14 days; the test moves its end date in the E2E database instead.
const prisma = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
test.afterAll(() => prisma.$disconnect());

test('a new organization trials Growth, adds a store, and becomes read-only when the trial ends', async ({
  page,
}) => {
  await registerAndOnboard(page, {
    name: 'Amina Haddad',
    email: uniqueEmail('owner'),
    organization: 'Atlas Outfitters',
  });

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Billing' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
  await expect(page.getByText('14 days left')).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Active stores' })).toHaveAttribute(
    'aria-valuenow',
    '1',
  );

  // Add a second store from the organization settings.
  await page.goto('/settings/organization');
  await page.getByRole('button', { name: 'Add store' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a store' });
  await dialog.getByLabel('Store name').fill('Harbour store');
  await dialog.getByLabel('Currency').selectOption('EUR');
  await dialog.getByRole('button', { name: 'Add store' }).click();
  await expect(page.getByText('Harbour store added.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Harbour store' })).toContainText(
    'EUR',
  );

  await page.goto('/settings/billing');
  await expect(page.getByRole('meter', { name: 'Active stores' })).toHaveAttribute(
    'aria-valuenow',
    '2',
  );

  // The trial ends: the organization turns read-only at once, without waiting for the job.
  const { activeOrganization } = (await apiFromPage(page, 'GET', '/auth/me')).body.data;
  await prisma.subscription.update({
    where: { organizationId: activeOrganization.id },
    data: { trialEndsAt: new Date(Date.now() - 60_000) },
  });
  await page.goto('/products');
  await expect(page.getByRole('alert')).toContainText('This organization is read-only');
  await expect(page.getByRole('alert')).toContainText('The trial has ended');
  const refused = await apiFromPage(page, 'POST', '/products', {
    name: 'Ceramic mug',
    status: 'ACTIVE',
    variants: [{ sku: 'MUG-RO', price: '12.00' }],
  });
  expect(refused.status).toBe(402);
  expect(refused.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
  // Reading still works.
  expect((await apiFromPage(page, 'GET', '/stores')).body.data).toHaveLength(2);
});
