import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { apiFromPage, registerAndOnboard, uniqueEmail } from './helpers.js';

test('reports add up to the orders behind them and export as CSV', async ({ page }) => {
  await registerAndOnboard(page, {
    name: 'Amina Haddad',
    email: uniqueEmail('reports'),
    organization: 'Atlas Outfitters',
  });
  const storeId = (await apiFromPage(page, 'GET', '/stores')).body.data[0].id;
  const mug = await apiFromPage(page, 'POST', '/products', {
    name: 'Ceramic mug',
    status: 'ACTIVE',
    variants: [{ sku: 'MUG-01', price: '89.50' }],
  });
  const variantId = mug.body.data.variants[0].id;
  await apiFromPage(page, 'POST', '/inventory/receipts', { storeId, variantId, quantity: 5 });

  // 3 mugs = 268.50, minus a 18.50 discount = 250.00 net; 20 % tax = 50.00; shipping 25.00.
  const order = await apiFromPage(page, 'POST', '/orders', {
    items: [{ variantId, quantity: 3 }],
    discountTotal: '18.50',
    shippingTotal: '25',
    taxRate: '0.2',
  });
  for (const action of ['place', 'confirm', 'start', 'ship']) {
    const res = await apiFromPage(page, 'POST', `/orders/${order.body.data.id}/transitions`, {
      action,
    });
    expect(res.status).toBe(200);
  }

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Reports' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  await page.getByLabel('Group by').selectOption('month');
  const total = page.getByRole('row', { name: /^Total/ });
  await expect(total).toContainText('268.50'); // gross
  await expect(total).toContainText('18.50'); // discounts
  await expect(total).toContainText('250.00'); // net
  await expect(total).toContainText('325.00'); // total = 250 + 50 tax + 25 shipping

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^sales-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = (await readFile(await file.path(), 'utf8')).replace(/^\uFEFF/, '');
  expect(csv.split('\r\n')).toContain('Total,,1,3,268.50,18.50,250.00,50.00,25.00,325.00,MAD');

  const tabs = page.getByRole('navigation', { name: 'Reports' });
  await tabs.getByRole('link', { name: 'Products' }).click();
  await expect(page.getByRole('row', { name: /Ceramic mug/ })).toContainText('268.50');
  await tabs.getByRole('link', { name: 'Stores' }).click();
  await expect(page.getByRole('row', { name: /Atlas Outfitters main store/ })).toContainText(
    '250.00',
  );
});
