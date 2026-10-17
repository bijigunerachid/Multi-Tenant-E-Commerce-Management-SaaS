import { expect, test } from '@playwright/test';
import { PASSWORD, registerAndOnboard, uniqueEmail } from './helpers.js';

test('a new business registers, confirms its email, and creates its organization', async ({
  page,
}) => {
  const email = uniqueEmail('owner');
  await registerAndOnboard(page, { name: 'Amina Haddad', email, organization: 'Atlas Outfitters' });

  // The dashboard shows the new organization in its own time zone, with nothing sold yet.
  await expect(page.getByText(/Atlas Outfitters · .*\(Africa\/Casablanca\)/)).toBeVisible();
  await expect(page.getByText('No orders shipped in this period')).toBeVisible();
  // The first store from onboarding is listed in the organization settings.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Organization' })
    .click();
  await expect(page.getByText('Atlas Outfitters main store')).toBeVisible();
  await expect(page.getByText('MAD · Africa/Casablanca')).toBeVisible();

  // The session survives a reload (server-side session cookie), then sign out and back in.
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Organization settings' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.goto('/settings/profile');
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fprofile/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
});

test('wrong credentials show one generic message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(uniqueEmail('nobody'));
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect');
});
