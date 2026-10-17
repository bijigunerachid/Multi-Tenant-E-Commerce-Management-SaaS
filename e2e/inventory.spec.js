import { expect, test } from '@playwright/test';
import { apiFromPage, registerAndOnboard, uniqueEmail } from './helpers.js';

test('stock is received, adjusted and traced, and cannot go below zero', async ({ page }) => {
  await registerAndOnboard(page, {
    name: 'Amina Haddad',
    email: uniqueEmail('owner'),
    organization: 'Atlas Outfitters',
  });
  const created = await apiFromPage(page, 'POST', '/products', {
    name: 'Ceramic mug',
    status: 'ACTIVE',
    variants: [{ sku: 'MUG-01', price: '89.50', cost: '30.00', lowStockThreshold: 5 }],
  });
  expect(created.status).toBe(201);

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Inventory' })
    .click();
  const row = page.getByRole('row', { name: /MUG-01/ });
  await expect(row).toContainText('Out of stock');

  // Receive 12 units
  await row.getByRole('button', { name: 'Receive stock for MUG-01' }).click();
  const receive = page.getByRole('dialog', { name: 'Receive stock: MUG-01' });
  await receive.getByLabel('Quantity received').fill('12');
  await receive.getByLabel('Note (optional)').fill('PO-1001');
  await receive.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByText('MUG-01: 12 on hand, 12 available.')).toBeVisible();
  await expect(row).toContainText('In stock');

  // Remove 8 damaged units → 4 left, at or below the threshold of 5
  await row.getByRole('button', { name: 'Adjust stock for MUG-01' }).click();
  const adjust = page.getByRole('dialog', { name: 'Adjust stock: MUG-01' });
  await adjust.getByLabel('Change (use - to remove)').fill('-8');
  await adjust.getByLabel('Reason').selectOption('DAMAGED');
  await adjust.getByLabel('Note').fill('Dropped pallet');
  await adjust.getByRole('button', { name: 'Save adjustment' }).click();
  await expect(page.getByText('MUG-01: 4 on hand, 4 available.')).toBeVisible();
  await expect(row).toContainText('Low stock');

  // The summary reflects the change: 4 units × 30.00 cost
  await expect(page.getByText('Units on hand').locator('..')).toContainText('4');
  await expect(page.getByText('Stock value (at cost)').locator('..')).toContainText('120.00');

  // Removing more than is on hand is refused, and nothing changes
  await row.getByRole('button', { name: 'Adjust stock for MUG-01' }).click();
  await adjust.getByLabel('Change (use - to remove)').fill('-5');
  await adjust.getByLabel('Reason').selectOption('LOST');
  await adjust.getByRole('button', { name: 'Save adjustment' }).click();
  await expect(adjust.getByRole('alert')).toContainText('Not enough stock for this change');
  await adjust.getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toContainText('Low stock');

  // History shows both movements, newest first, with reason, note and author
  await row.getByRole('link', { name: 'Movement history for MUG-01' }).click();
  await expect(page.getByRole('heading', { name: 'Movement history' })).toBeVisible();
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(3); // header + 2 movements
  await expect(rows.nth(1)).toContainText('Adjusted');
  await expect(rows.nth(1)).toContainText('-8');
  await expect(rows.nth(1)).toContainText('Dropped pallet');
  await expect(rows.nth(2)).toContainText('Received');
  await expect(rows.nth(2)).toContainText('+12');
  await expect(rows.nth(2)).toContainText('Amina Haddad');
});
