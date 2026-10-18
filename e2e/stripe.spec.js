import { expect, test } from '@playwright/test';
import { registerAndOnboard, uniqueEmail } from './helpers.js';

// Live check against Stripe test mode (E2E_STRIPE=1, see playwright.config.js): a real
// Checkout with a test card, real webhooks forwarded by `stripe listen`, and the Customer
// Portal. Skipped in normal runs and in CI, which have no Stripe account.
test.skip(process.env.E2E_STRIPE !== '1', 'needs Stripe test mode (E2E_STRIPE=1)');
test.setTimeout(180_000);

test('an owner buys a plan with Stripe Checkout and manages it in the Customer Portal', async ({
  page,
}) => {
  await registerAndOnboard(page, {
    name: 'Amina Haddad',
    email: uniqueEmail('payer'),
    organization: 'Atlas Outfitters',
  });
  await page.goto('/settings/billing');
  await page.getByRole('button', { name: 'Choose Scale' }).click();

  // Stripe-hosted Checkout, in test mode.
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  await expect(page.getByText(/Vendora Scale/).first()).toBeVisible({ timeout: 30_000 });
  // With several payment methods enabled, the card form sits in an accordion.
  const cardChoice = page.getByTestId('card-accordion-item-button');
  if (await cardChoice.isVisible().catch(() => false)) await cardChoice.click();
  await page.locator('#cardNumber').fill('4242 4242 4242 4242');
  await page.locator('#cardExpiry').fill('12 / 34');
  await page.locator('#cardCvc').fill('123');
  await page.locator('#billingName').fill('Amina Haddad');
  const postalCode = page.locator('#billingPostalCode');
  if (await postalCode.isVisible().catch(() => false)) await postalCode.fill('10001');
  await page.getByTestId('hosted-payment-submit-button').click();

  // Back in Vendora: the page waits for the webhook before saying the plan is active.
  await page.waitForURL(/\/settings\/billing\?checkout=success/, { timeout: 60_000 });
  await expect(page.getByText('Your plan is active. Thank you!')).toBeVisible({
    timeout: 60_000,
  });
  const current = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Current plan' }) });
  await expect(current).toContainText('Scale');
  // The 14-day trial was kept: the first payment is when it ends.
  await expect(current).toContainText('Trial');
  await expect(page.getByRole('button', { name: /^Choose/ })).toHaveCount(0);
  // Stripe issues a 0.00 invoice for the trial period.
  await expect(page.getByRole('link', { name: /^View invoice/ }).first()).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: 'Manage billing' }).click();
  await page.waitForURL(/billing\.stripe\.com/, { timeout: 30_000 });
  await expect(page.getByText(/Vendora Scale/).first()).toBeVisible({ timeout: 30_000 });
});
