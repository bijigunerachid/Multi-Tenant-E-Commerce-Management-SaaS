import { expect, test } from '@playwright/test';
import {
  PASSWORD,
  apiFromPage,
  linkFromEmail,
  registerAndOnboard,
  uniqueEmail,
} from './helpers.js';

// A real 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('an owner builds a catalog: category, product with variants, image, search', async ({
  page,
}) => {
  await registerAndOnboard(page, {
    name: 'Amina Haddad',
    email: uniqueEmail('owner'),
    organization: 'Atlas Outfitters',
  });
  const nav = page.getByRole('navigation', { name: 'Main' });

  // Category
  await nav.getByRole('link', { name: 'Categories' }).click();
  await page.getByRole('button', { name: 'New category' }).first().click();
  const categoryDialog = page.getByRole('dialog', { name: 'New category' });
  await categoryDialog.getByLabel('Name').fill('Shirts');
  await categoryDialog.getByRole('button', { name: 'Create category' }).click();
  await expect(page.getByText('Shirts created.')).toBeVisible();

  // Product with two size variants
  await nav.getByRole('link', { name: 'Products' }).click();
  await expect(page.getByText('No products yet')).toBeVisible();
  await page.getByRole('link', { name: 'New product' }).first().click();
  await page.getByLabel('Product name').fill('Linen shirt');
  await page.getByLabel('Category').selectOption({ label: 'Shirts' });
  await page.getByLabel('Status').selectOption('ACTIVE');
  await page.getByRole('button', { name: /Add option/ }).click();
  await page.getByLabel('Option 1', { exact: true }).fill('Size');
  await page.getByLabel('Size, variant 1').fill('M');
  await page.getByLabel('SKU, variant 1').fill('shirt-m');
  await page.getByLabel('Price, variant 1').fill('29.90');
  await page.getByLabel('Cost, variant 1').fill('12');
  await page.getByRole('button', { name: 'Add variant' }).click();
  await page.getByLabel('Size, variant 2').fill('L');
  await page.getByLabel('SKU, variant 2').fill('shirt-l');
  await page.getByLabel('Price, variant 2').fill('31.90');
  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page.getByText('Product created. You can now add images.')).toBeVisible();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel('SKU, variant 1')).toHaveValue('SHIRT-M');

  // Image upload, then the image is served to the signed-in member
  await page
    .getByLabel('Choose an image to upload')
    .setInputFiles({ name: 'shirt.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Image uploaded.')).toBeVisible();
  const img = page.getByRole('img', { name: 'Linen shirt, image 1' });
  await expect(img).toBeVisible();
  expect(await img.evaluate((el) => el.complete && el.naturalWidth)).toBe(1);

  // A duplicate SKU on a second product is refused on the right row
  await page.goto('/products/new');
  await page.getByLabel('Product name').fill('Another shirt');
  await page.getByLabel('SKU, variant 1').fill('SHIRT-M');
  await page.getByLabel('Price, variant 1').fill('10');
  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page.getByText('This SKU is already used by another product')).toBeVisible();

  // Search by SKU from the list; the filter survives a reload
  await page.goto('/products');
  await page.getByPlaceholder('Search by name or SKU').fill('shirt-l');
  await expect(page).toHaveURL(/search=shirt-l/);
  await page.reload();
  const row = page.getByRole('row', { name: /Linen shirt/ });
  await expect(row).toContainText('SHIRT-M, SHIRT-L');
  await expect(row).toContainText('Shirts');
  // The thumbnail is decorative (alt=""), so it is located directly rather than by role.
  const thumb = row.locator('img');
  await expect(thumb).toBeVisible();
  await expect.poll(() => thumb.evaluate((el) => el.complete && el.naturalWidth)).toBe(1);
});

test('an analyst can browse the catalog but the API refuses changes', async ({ browser }) => {
  const ownerPage = await (await browser.newContext()).newPage();
  await registerAndOnboard(ownerPage, {
    name: 'Owner',
    email: uniqueEmail('owner'),
    organization: 'Sahara Supply',
  });
  const created = await apiFromPage(ownerPage, 'POST', '/products', {
    name: 'Ceramic mug',
    status: 'ACTIVE',
    variants: [{ sku: 'MUG-1', price: '9.00' }],
  });
  expect(created.status).toBe(201);

  // An analyst joins the same organization through an invitation.
  const analystEmail = uniqueEmail('analyst');
  await apiFromPage(ownerPage, 'POST', '/members/invitations', {
    email: analystEmail,
    role: 'ANALYST',
  });
  const analystPage = await (await browser.newContext()).newPage();
  await analystPage.goto(
    await linkFromEmail(analystPage.request, analystEmail, '/invitations/accept'),
  );
  await analystPage.getByLabel('Full name').fill('Analyst');
  await analystPage.getByLabel('Choose a password').fill(PASSWORD);
  await analystPage.getByRole('button', { name: 'Create account and join' }).click();

  await analystPage
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Products' })
    .click();
  await expect(analystPage.getByRole('link', { name: 'Ceramic mug' })).toBeVisible();
  await expect(analystPage.getByRole('link', { name: 'New product' })).toHaveCount(0);

  await analystPage.getByRole('link', { name: 'Ceramic mug' }).click();
  await expect(analystPage.getByLabel('Product name')).toBeDisabled();

  const productId = created.body.data.id;
  const attempt = await apiFromPage(analystPage, 'PATCH', `/products/${productId}/status`, {
    status: 'ARCHIVED',
  });
  expect(attempt.status).toBe(403);
  const del = await apiFromPage(analystPage, 'DELETE', `/products/${productId}`);
  expect(del.status).toBe(403);
});
