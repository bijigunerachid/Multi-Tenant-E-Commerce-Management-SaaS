import { expect, test } from '@playwright/test';
import { apiFromPage, registerAndOnboard, uniqueEmail } from './helpers.js';

async function stockOf(page, sku) {
  const res = await apiFromPage(page, 'GET', `/inventory?search=${encodeURIComponent(sku)}`);
  const row = res.body.data.find((r) => r.sku === sku);
  return { onHand: row.onHand, reserved: row.reserved, available: row.available };
}

test('an order is placed, fulfilled and delivered; another is cancelled; stock follows', async ({
  page,
}) => {
  await registerAndOnboard(page, {
    name: 'Amina Haddad',
    email: uniqueEmail('owner'),
    organization: 'Atlas Outfitters',
  });
  const product = await apiFromPage(page, 'POST', '/products', {
    name: 'Ceramic mug',
    status: 'ACTIVE',
    variants: [{ sku: 'MUG-01', price: '89.50' }],
  });
  const storeId = (await apiFromPage(page, 'GET', '/stores')).body.data[0].id;
  await apiFromPage(page, 'POST', '/inventory/receipts', {
    storeId,
    variantId: product.body.data.variants[0].id,
    quantity: 5,
  });
  await apiFromPage(page, 'POST', '/customers', {
    name: 'Omar Idrissi',
    email: 'omar@example.com',
    address: { label: 'Home', line1: '12 Rue Atlas', city: 'Rabat', country: 'MA' },
  });

  // Create and place an order from the UI
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Orders' })
    .click();
  await page.getByRole('link', { name: 'New order' }).first().click();
  await page.getByLabel('Add a product').fill('mug');
  await page.getByRole('button', { name: /Ceramic mug/ }).click();
  await page.getByLabel('Quantity of MUG-01').fill('3');
  await page.getByLabel('Find a customer').fill('omar');
  await page.getByRole('button', { name: /Omar Idrissi/ }).click();
  await page
    .getByLabel('Ship to')
    .selectOption({ label: 'Home: 12 Rue Atlas, Rabat, Morocco (default)' });
  await page.getByLabel('Shipping').fill('25');
  await page.getByLabel('Tax rate (%)').fill('20');
  await page.getByRole('button', { name: 'Save and place order' }).click();

  await expect(page.getByText('Order #1001 placed. Stock is reserved.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Order #1001' })).toBeVisible();
  // 3 × 89.50 = 268.50; tax 20% = 53.70; shipping 25.00 → 347.20
  await expect(page.locator('dt', { hasText: /^Total$/ }).locator('..')).toContainText('347.20');
  await expect(page.getByText('Reserved', { exact: true })).toBeVisible();
  expect(await stockOf(page, 'MUG-01')).toEqual({ onHand: 5, reserved: 3, available: 2 });

  // Walk the lifecycle
  for (const [button, status] of [
    ['Confirm order', 'confirmed'],
    ['Start processing', 'processing'],
    ['Mark as shipped', 'shipped'],
  ]) {
    await page.getByRole('button', { name: button }).click();
    await expect(page.getByText(`Order #1001 is now ${status}.`)).toBeVisible();
  }
  expect(await stockOf(page, 'MUG-01')).toEqual({ onHand: 2, reserved: 0, available: 2 });
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark as delivered' }).click();
  await expect(page.getByText('Order #1001 is now delivered.')).toBeVisible();
  const history = page.getByRole('list').filter({ hasText: 'Delivered' });
  await expect(history.getByRole('listitem')).toHaveCount(5);

  // A second order is placed and then cancelled: its stock comes back
  await page.goto('/orders/new');
  await page.getByLabel('Add a product').fill('MUG-01');
  await page.getByRole('button', { name: /Ceramic mug/ }).click();
  await page.getByLabel('Quantity of MUG-01').fill('2');
  await page.getByRole('button', { name: 'Save and place order' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Order #1002' })).toBeVisible();
  expect(await stockOf(page, 'MUG-01')).toEqual({ onHand: 2, reserved: 2, available: 0 });

  await page.getByRole('button', { name: 'Cancel order' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel Order #1002?' });
  await dialog.getByLabel('Reason').fill('Customer changed their mind');
  await dialog.getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.getByText('Order #1002 cancelled. Reserved stock was released.')).toBeVisible();
  await expect(page.getByText('Customer changed their mind').first()).toBeVisible();
  expect(await stockOf(page, 'MUG-01')).toEqual({ onHand: 2, reserved: 0, available: 2 });

  // Ordering more than is available is refused when placing; the draft is kept
  await page.goto('/orders/new');
  await page.getByLabel('Add a product').fill('MUG-01');
  await page.getByRole('button', { name: /Ceramic mug/ }).click();
  await page.getByLabel('Quantity of MUG-01').fill('3');
  await expect(page.getByText('Only 2 available')).toBeVisible();
  await page.getByRole('button', { name: 'Save and place order' }).click();
  await expect(page.getByText('Not enough stock for MUG-01: 2 available, 3 ordered')).toBeVisible();
  expect(await stockOf(page, 'MUG-01')).toEqual({ onHand: 2, reserved: 0, available: 2 });

  // The list shows all three: delivered, cancelled, and the kept draft
  await page.goto('/orders');
  await expect(page.getByRole('row', { name: /#1001/ })).toContainText('Delivered');
  await expect(page.getByRole('row', { name: /#1002/ })).toContainText('Cancelled');
  await expect(page.getByRole('row', { name: /Draft/ })).toContainText('No customer');

  // The customer's page shows the delivered order in their spending (the draft has no customer,
  // and order #1002 had none either)
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Customers' })
    .click();
  await expect(page.getByRole('row', { name: /Omar Idrissi/ })).toContainText('347.20');
  await page.getByRole('link', { name: 'Omar Idrissi' }).click();
  await expect(page.getByText('Total spent').locator('..')).toContainText('347.20');
  await expect(page.getByRole('link', { name: '#1001' })).toBeVisible();

  // "New order" starts the form with this customer and their default address
  await page.getByRole('link', { name: 'New order' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New order' })).toBeVisible();
  await expect(page.getByText('omar@example.com')).toBeVisible();
  await expect(page.getByLabel('Ship to')).toHaveValue(/.+/);
});
