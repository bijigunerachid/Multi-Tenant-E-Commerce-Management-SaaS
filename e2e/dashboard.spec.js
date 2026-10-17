import { expect, test } from '@playwright/test';
import { apiFromPage, registerAndOnboard, uniqueEmail } from './helpers.js';

async function ship(page, items, actions = ['place', 'confirm', 'start', 'ship']) {
  const order = await apiFromPage(page, 'POST', '/orders', {
    items,
    shippingTotal: '25',
    taxRate: '0.2',
  });
  for (const action of actions) {
    const res = await apiFromPage(page, 'POST', `/orders/${order.body.data.id}/transitions`, {
      action,
    });
    expect(res.status).toBe(200);
  }
}

test('the dashboard reflects the orders and stock behind it', async ({ page }) => {
  await registerAndOnboard(page, {
    name: 'Amina Haddad',
    email: uniqueEmail('owner'),
    organization: 'Atlas Outfitters',
  });
  const mug = await apiFromPage(page, 'POST', '/products', {
    name: 'Ceramic mug',
    status: 'ACTIVE',
    variants: [{ sku: 'MUG-01', price: '89.50' }],
  });
  const variantId = mug.body.data.variants[0].id;
  const storeId = (await apiFromPage(page, 'GET', '/stores')).body.data[0].id;
  await apiFromPage(page, 'POST', '/inventory/receipts', { storeId, variantId, quantity: 5 });

  // One shipped order (2 × 89.50 = 179.00 net; tax and shipping are not revenue)
  // and one pending order (placed, not shipped: counts as an order, not as revenue).
  await ship(page, [{ variantId, quantity: 2 }]);
  await ship(page, [{ variantId, quantity: 1 }], ['place']);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  const tile = (label) => page.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('..');
  await expect(tile('Revenue')).toContainText('179.00');
  await expect(tile('Orders placed')).toContainText('2');
  await expect(tile('Average order value')).toContainText('179.00');
  await expect(tile('Open orders')).toContainText('1');

  // Top products and the revenue table agree with the shipped order
  await expect(
    page.getByRole('img', { name: /Top 1 products by sales: Ceramic mug/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'View revenue as a table' }).click();
  await expect(page.getByRole('row').filter({ hasText: '179.00' })).toHaveCount(1);

  // 5 received − 2 shipped − 1 reserved = 2 available, at or below the default threshold of 5
  const alert = page.getByRole('listitem').filter({ hasText: 'MUG-01' });
  await expect(alert).toContainText('2 available');
  await expect(alert).toContainText('Low stock');

  // The recent orders list links to the pending order
  await expect(page.getByRole('link', { name: '#1002' })).toBeVisible();
});
