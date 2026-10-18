import { expect, test } from '@playwright/test';

// The public site, as a visitor sees it: the homepage at /, pricing from the real API, and the
// way into the app. Also checked at phone width.

test('a visitor reads the homepage and pricing, then starts a trial', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Know what’s on every shelf, in every store.' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  // The hero's one moment: a sale brings the pouf to low stock.
  const hero = page.getByRole('figure', { name: /^Example:/ });
  await expect(hero.getByText('Low stock')).toBeVisible({ timeout: 5_000 });
  await expect(hero).toContainText('Order #1042 placed');

  // Prices come from the API (the plans migration), not from the web app.
  const pricingSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Pay for the shop you run' }),
  });
  await expect(pricingSection.getByRole('listitem').filter({ hasText: 'Growth' })).toContainText(
    '$79.00',
  );

  await page
    .getByRole('navigation', { name: 'Site' })
    .getByRole('link', { name: 'Pricing' })
    .click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page).toHaveTitle('Pricing · Vendora');
  await expect(page.getByRole('listitem').filter({ hasText: 'The trial plan' })).toContainText(
    'Growth',
  );

  await page.getByRole('link', { name: 'Start your free trial' }).first().click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole('heading', { name: /Create your account/i })).toBeVisible();
});

test('the public pages fit a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/pricing']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const { contentWidth, visibleWidth } = await page.evaluate(() => ({
      contentWidth: document.documentElement.scrollWidth,
      visibleWidth: document.documentElement.clientWidth,
    }));
    expect({ path, contentWidth }).toEqual({ path, contentWidth: visibleWidth });
  }
  // The menu works on a phone.
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('link', { name: 'Start free trial' })).toBeVisible();
});
