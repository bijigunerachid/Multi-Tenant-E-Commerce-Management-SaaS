import { expect, test } from '@playwright/test';
import {
  PASSWORD,
  apiFromPage,
  linkFromEmail,
  registerAndOnboard,
  uniqueEmail,
} from './helpers.js';

test('an owner invites an employee, who gets only the access of their role', async ({
  browser,
}) => {
  // Owner sets up an organization and sends an invitation.
  const ownerPage = await (await browser.newContext()).newPage();
  await registerAndOnboard(ownerPage, {
    name: 'Amina Haddad',
    email: uniqueEmail('owner'),
    organization: 'Sahara Supply',
  });

  await ownerPage
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Employees' })
    .click();
  await ownerPage.getByRole('button', { name: 'Invite employee' }).click();
  const analystEmail = uniqueEmail('analyst');
  const dialog = ownerPage.getByRole('dialog', { name: 'Invite an employee' });
  await dialog.getByLabel('Email').fill(analystEmail);
  await dialog.getByLabel('Role').selectOption('ANALYST');
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(ownerPage.getByText(`Invitation sent to ${analystEmail}.`)).toBeVisible();
  await expect(ownerPage.getByText(analystEmail, { exact: true })).toBeVisible();

  // The employee opens the emailed link in their own browser and creates an account.
  const employeePage = await (await browser.newContext()).newPage();
  await employeePage.goto(
    await linkFromEmail(employeePage.request, analystEmail, '/invitations/accept'),
  );
  await expect(employeePage.getByRole('heading', { name: 'Join Sahara Supply' })).toBeVisible();
  await employeePage.getByLabel('Full name').fill('Omar Idrissi');
  await employeePage.getByLabel('Choose a password').fill(PASSWORD);
  await employeePage.getByRole('button', { name: 'Create account and join' }).click();
  await expect(
    employeePage.getByRole('heading', { level: 1, name: 'Sahara Supply' }),
  ).toBeVisible();
  await expect(employeePage.getByText('You are signed in as analyst.')).toBeVisible();

  // The analyst has no Employees link and the page explains why if opened directly.
  const nav = employeePage.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Employees' })).toHaveCount(0);
  await employeePage.goto('/employees');
  await expect(employeePage.getByText('You do not have access to this page')).toBeVisible();

  // Hiding buttons is not the protection: the API refuses the actions directly.
  const members = await apiFromPage(employeePage, 'GET', '/members');
  expect(members.status).toBe(403);
  const ownMembershipId = (await apiFromPage(employeePage, 'GET', '/auth/me')).body.data
    .activeOrganization.membershipId;
  const promote = await apiFromPage(employeePage, 'PATCH', `/members/${ownMembershipId}`, {
    role: 'MANAGER',
  });
  expect(promote.status).toBe(403);
  const invite = await apiFromPage(employeePage, 'POST', '/members/invitations', {
    email: uniqueEmail('x'),
    role: 'MANAGER',
  });
  expect(invite.status).toBe(403);

  // The owner sees the new member and can deactivate them; access ends immediately.
  await ownerPage.reload();
  const row = ownerPage.getByRole('row', { name: /Omar Idrissi/ });
  await expect(row).toContainText('Analyst');
  await row.getByRole('button', { name: 'Deactivate Omar Idrissi' }).click();
  await ownerPage
    .getByRole('dialog', { name: 'Deactivate Omar Idrissi?' })
    .getByRole('button', { name: 'Deactivate' })
    .click();
  await expect(ownerPage.getByText('Omar Idrissi no longer has access.')).toBeVisible();

  await employeePage.goto('/');
  await expect(
    employeePage.getByRole('heading', { name: 'Set up your organization' }),
  ).toBeVisible();
});

test('a user from another organization cannot reach its records', async ({ browser }) => {
  const aPage = await (await browser.newContext()).newPage();
  await registerAndOnboard(aPage, {
    name: 'Owner A',
    email: uniqueEmail('owner-a'),
    organization: 'Org Alpha',
  });
  const aSession = (await apiFromPage(aPage, 'GET', '/auth/me')).body.data;
  const aMembers = (await apiFromPage(aPage, 'GET', '/members')).body.data;

  const bPage = await (await browser.newContext()).newPage();
  await registerAndOnboard(bPage, {
    name: 'Owner B',
    email: uniqueEmail('owner-b'),
    organization: 'Org Beta',
  });

  // Guessing A's organization id does not let B switch into it.
  const sw = await apiFromPage(
    bPage,
    'POST',
    `/organizations/${aSession.activeOrganization.id}/switch`,
  );
  expect(sw.status).toBe(404);

  // A's member id used against B's own tenant routes is "not found".
  const change = await apiFromPage(bPage, 'PATCH', `/members/${aMembers[0].id}`, {
    role: 'ANALYST',
  });
  expect(change.status).toBe(404);
  const deactivate = await apiFromPage(bPage, 'POST', `/members/${aMembers[0].id}/deactivate`);
  expect(deactivate.status).toBe(404);

  // B's views only ever show B's organization.
  const current = await apiFromPage(bPage, 'GET', '/organizations/current');
  expect(current.body.data.name).toBe('Org Beta');
  await bPage.goto('/employees');
  await expect(bPage.getByText('Owner A')).toHaveCount(0);
});
