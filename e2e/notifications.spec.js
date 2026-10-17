import { expect, test } from '@playwright/test';
import { apiFromPage, registerAndOnboard, uniqueEmail } from './helpers.js';

test('an order that brings stock down to its threshold notifies in the app and by email', async ({
  page,
}) => {
  const owner = uniqueEmail('owner');
  await registerAndOnboard(page, {
    name: 'Amina Haddad',
    email: owner,
    organization: 'Atlas Outfitters',
  });

  // Turn on the email copy of low-stock alerts.
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('No notifications yet')).toBeVisible();
  await page.getByRole('checkbox', { name: /Low stock/ }).check();
  await expect(page.getByText('Email settings saved.')).toBeVisible();

  // 6 in stock, threshold 5: an order for 2 leaves 4 available.
  const mug = await apiFromPage(page, 'POST', '/products', {
    name: 'Ceramic mug',
    status: 'ACTIVE',
    variants: [{ sku: 'MUG-NOTIFY', price: '12.00' }],
  });
  const variantId = mug.body.data.variants[0].id;
  const storeId = (await apiFromPage(page, 'GET', '/stores')).body.data[0].id;
  await apiFromPage(page, 'POST', '/inventory/receipts', { storeId, variantId, quantity: 6 });
  const order = await apiFromPage(page, 'POST', '/orders', {
    items: [{ variantId, quantity: 2 }],
  });
  const placed = await apiFromPage(page, 'POST', `/orders/${order.body.data.id}/transitions`, {
    action: 'place',
  });
  expect(placed.status).toBe(200);

  // The worker delivers it within a second; the bell checks again when the page reloads.
  await expect
    .poll(
      async () => (await apiFromPage(page, 'GET', '/notifications/unread-count')).body.data.count,
      { timeout: 15_000 },
    )
    .toBe(1);
  await page.reload();
  const bell = page.getByRole('button', { name: /^Notifications/ });
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread');

  await bell.click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  const alert = panel.getByRole('link', { name: /Low stock: MUG-NOTIFY/ });
  await expect(alert).toContainText('4 left at');
  // Placing the order is the owner's own action, so there is no "new order" notification.
  await expect(panel.getByRole('link', { name: /New order/ })).toHaveCount(0);
  await alert.click();

  await expect(page).toHaveURL(/\/inventory\?storeId=.+&search=MUG-NOTIFY/);
  await expect(page.getByRole('heading', { level: 1, name: 'Inventory' })).toBeVisible();
  await expect(bell).toHaveAccessibleName('Notifications');

  // The email copy went through the queue to the inbox.
  await expect
    .poll(
      async () => {
        const search = await page.request.get(`${process.env.MAILPIT_URL}/api/v1/search`, {
          params: { query: `to:"${owner}" subject:"Low stock"` },
        });
        const { messages = [] } = await search.json();
        return messages.map((m) => m.Subject);
      },
      { timeout: 15_000 },
    )
    .toEqual(['Low stock: MUG-NOTIFY in Atlas Outfitters']);
});
