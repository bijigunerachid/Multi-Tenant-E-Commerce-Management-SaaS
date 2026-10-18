import { expect, test } from '@playwright/test';
import {
  PASSWORD,
  apiFromPage,
  enableTwoFactor,
  grantPlatformAdmin,
  nextCode,
  registerAndOnboard,
  uniqueEmail,
} from './helpers.js';

test('a platform admin suspends an organization, its owner is locked out, then it is restored', async ({
  browser,
}) => {
  const ownerPage = await (await browser.newContext()).newPage();
  await registerAndOnboard(ownerPage, {
    name: 'Amina Haddad',
    email: uniqueEmail('owner'),
    organization: 'Harbor Crafts',
  });

  const adminEmail = uniqueEmail('staff');
  const adminPage = await (await browser.newContext()).newPage();
  await registerAndOnboard(adminPage, {
    name: 'Sam Support',
    email: adminEmail,
    organization: 'Vendora Support',
  });
  // Not an admin yet: the area is closed, in the browser and in the API.
  await adminPage.goto('/admin');
  await expect(adminPage.getByText('You do not have access to this page')).toBeVisible();
  expect((await apiFromPage(adminPage, 'GET', '/admin/stats')).status).toBe(403);

  expect(grantPlatformAdmin(adminEmail)).toContain('is now a platform administrator');
  // The admin area needs two-factor sign-in: it says so until it is on.
  await adminPage.goto('/admin');
  await expect(adminPage.getByText('Turn on two-factor sign-in first')).toBeVisible();
  const secret = await enableTwoFactor(adminPage);

  // From now on, signing in takes the password and a code.
  await adminPage.getByRole('button', { name: 'Open user menu' }).click();
  await adminPage.getByRole('menuitem', { name: 'Sign out' }).click();
  await adminPage.getByLabel('Email').fill(adminEmail);
  await adminPage.getByLabel('Password').fill(PASSWORD);
  await adminPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(adminPage.getByRole('heading', { name: 'Two-factor sign-in' })).toBeVisible();
  await adminPage.getByLabel('Authentication code').fill(nextCode(secret));
  await adminPage.getByRole('button', { name: 'Verify and sign in' }).click();
  // Signed in: back in the app (on the page they left).
  await expect(adminPage.getByRole('navigation', { name: 'Main' })).toBeVisible();

  await adminPage.goto('/settings/profile');
  await adminPage.getByRole('button', { name: 'Open user menu' }).click();
  await adminPage.getByRole('menuitem', { name: 'Platform admin' }).click();
  await expect(adminPage.getByRole('heading', { level: 1, name: 'Platform' })).toBeVisible();

  await adminPage.getByLabel('Search organizations').fill('Harbor');
  await adminPage.getByRole('link', { name: /Harbor Crafts/ }).click();
  await expect(adminPage.getByRole('heading', { level: 1, name: 'Harbor Crafts' })).toBeVisible();

  // Suspend, with a reason.
  await adminPage.getByRole('button', { name: 'Suspend' }).click();
  const suspend = adminPage.getByRole('dialog', { name: 'Suspend Harbor Crafts?' });
  await suspend.getByLabel('Reason').fill('Chargeback dispute, ticket 77');
  await suspend.getByRole('button', { name: 'Suspend organization' }).click();
  await expect(adminPage.getByText('Harbor Crafts suspended.')).toBeVisible();
  await expect(adminPage.getByText('Chargeback dispute, ticket 77')).toBeVisible();

  const locked = await apiFromPage(ownerPage, 'GET', '/products');
  expect(locked.status).toBe(403);
  expect(locked.body.error.code).toBe('ORGANIZATION_SUSPENDED');
  await ownerPage.goto('/products');
  await expect(
    ownerPage.getByRole('heading', { name: 'Harbor Crafts is suspended' }),
  ).toBeVisible();

  // Reactivate, then read the audit log, which needs (and records) a reason.
  await adminPage.getByRole('button', { name: 'Reactivate' }).click();
  const reactivate = adminPage.getByRole('dialog', { name: 'Reactivate Harbor Crafts?' });
  await reactivate.getByLabel('Reason').fill('Dispute resolved');
  await reactivate.getByRole('button', { name: 'Reactivate organization' }).click();
  await expect(adminPage.getByText('Harbor Crafts reactivated.')).toBeVisible();
  expect((await apiFromPage(ownerPage, 'GET', '/products')).status).toBe(200);
  // Back in without choosing the organization again.
  await ownerPage.getByRole('button', { name: 'Check again' }).click();
  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible();

  await adminPage.getByLabel('Why do you need to read it?').fill('Checking the dispute history');
  await adminPage.getByRole('button', { name: 'Show audit log' }).click();
  await expect(adminPage.getByText('admin.organization_suspended')).toBeVisible();
  await expect(adminPage.getByText('admin.organization_reactivated')).toBeVisible();

  // The owner sees what support did, and why.
  const audit = await apiFromPage(ownerPage, 'GET', '/audit-logs');
  const support = audit.body.data.filter((r) => r.action.startsWith('admin.'));
  expect(support.map((r) => [r.action, r.metadata.reason])).toEqual([
    ['admin.audit_viewed', 'Checking the dispute history'],
    ['admin.organization_reactivated', 'Dispute resolved'],
    ['admin.organization_suspended', 'Chargeback dispute, ticket 77'],
  ]);

  // User management: the shop owner is disabled (signed out at once), then enabled again.
  const ownerEmail = await ownerPage.evaluate(() =>
    fetch('/api/v1/auth/me')
      .then((r) => r.json())
      .then((b) => b.data.user.email),
  );
  await adminPage
    .getByRole('navigation', { name: 'Admin' })
    .getByRole('link', { name: 'Users' })
    .click();
  await adminPage.getByLabel('Search users').fill(ownerEmail);
  await adminPage.getByRole('link', { name: /Amina Haddad/ }).click();
  await expect(adminPage.getByText(/owns Harbor Crafts/)).toBeVisible();
  await adminPage.getByRole('button', { name: 'Disable account' }).click();
  const disable = adminPage.getByRole('dialog', { name: 'Disable Amina Haddad?' });
  await disable.getByLabel('Reason').fill('Suspicious sign-ins, ticket 78');
  await disable.getByRole('button', { name: 'Disable account' }).click();
  await expect(adminPage.getByText('Account disabled.')).toBeVisible();
  // Signed out at once: the owner's next request is refused.
  const afterDisable = await ownerPage.evaluate(() =>
    fetch('/api/v1/products').then((r) => r.status),
  );
  expect(afterDisable).toBe(401);

  await adminPage.getByRole('button', { name: 'Enable account' }).click();
  const enable = adminPage.getByRole('dialog', { name: 'Enable Amina Haddad?' });
  await enable.getByLabel('Reason').fill('Owner confirmed by phone');
  await enable.getByRole('button', { name: 'Enable account' }).click();
  await expect(adminPage.getByText('Account enabled.')).toBeVisible();

  // Every step is in the platform activity log, with its reason.
  await adminPage
    .getByRole('navigation', { name: 'Admin' })
    .getByRole('link', { name: 'Activity' })
    .click();
  await expect(adminPage.getByText('“Suspicious sign-ins, ticket 78”')).toBeVisible();
  await expect(
    adminPage
      .getByRole('listitem')
      .filter({ hasText: 'Platform admin role granted (server)' })
      .first(),
  ).toBeVisible();
});
