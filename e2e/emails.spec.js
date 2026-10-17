import { expect, test } from '@playwright/test';
import { apiFromPage, linkFromEmail, registerAndOnboard, uniqueEmail } from './helpers.js';

test('an invitation goes through the queue to the inbox and shows in the email log', async ({
  page,
}) => {
  await registerAndOnboard(page, {
    name: 'Amina Haddad',
    email: uniqueEmail('owner'),
    organization: 'Atlas Outfitters',
  });
  const invitee = uniqueEmail('new-hire');
  const invite = await apiFromPage(page, 'POST', '/members/invitations', {
    email: invitee,
    role: 'ANALYST',
  });
  expect(invite.status).toBe(201);

  // The worker sent it: the link arrives in Mailpit.
  expect(await linkFromEmail(page.request, invitee, '/invitations/accept')).toContain('token=');

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Email log' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Email log' })).toBeVisible();
  const entry = page.getByRole('listitem').filter({ hasText: invitee });
  await expect(entry).toContainText('Sent');
  await expect(entry).toContainText('Team invitation');
});
