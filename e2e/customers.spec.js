import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { registerAndOnboard, uniqueEmail } from './helpers.js';

test('a customer is created, given addresses, and exported to CSV', async ({ page }) => {
  await registerAndOnboard(page, {
    name: 'Amina Haddad',
    email: uniqueEmail('owner'),
    organization: 'Atlas Outfitters',
  });
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Customers' })
    .click();
  await expect(page.getByText('No customers yet')).toBeVisible();

  // Create
  await page.getByRole('button', { name: 'New customer' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New customer' });
  await dialog.getByLabel('Name').fill('Haddad, Omar');
  await dialog.getByLabel('Email').fill('Omar@Example.com');
  await dialog.getByLabel('Phone').fill('+212 600 000 000');
  await dialog.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Haddad, Omar' })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue('omar@example.com');

  // Two addresses: the first becomes the default, then the default is switched
  for (const [label, line1, city] of [
    ['Home', '12 Rue Atlas', 'Casablanca'],
    ['Office', '1 Bd Zerktouni', 'Rabat'],
  ]) {
    await page.getByRole('button', { name: 'Add address' }).click();
    const form = page.getByRole('dialog', { name: 'Add address' });
    await form.getByLabel('Label').fill(label);
    await form.getByLabel('Street address').fill(line1);
    await form.getByLabel('City').fill(city);
    await form.getByLabel('Country').selectOption('MA');
    await form.getByRole('button', { name: 'Add address' }).click();
    await expect(page.getByText('Address added.')).toBeVisible();
  }
  // Matched on the street: "Home" is also the breadcrumb's first item.
  const home = page.getByRole('listitem').filter({ hasText: '12 Rue Atlas' });
  const office = page.getByRole('listitem').filter({ hasText: '1 Bd Zerktouni' });
  await expect(home).toContainText('Default');
  await office.getByRole('button', { name: 'Make default' }).click();
  await expect(office).toContainText('Default');
  await expect(home).not.toContainText('Default');

  // The list shows the default address's city
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Customers' })
    .click();
  await expect(page.getByRole('row', { name: /Haddad, Omar/ })).toContainText('Rabat, Morocco');

  // Export: a real file download with correct quoting
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^customers-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = (await readFile(await download.path(), 'utf8')).replace(/^\uFEFF/, '');
  const lines = csv.trim().split('\r\n');
  expect(lines[0]).toBe('Name,Email,Phone,City,Country,Status,Created,Orders,Spent');
  expect(lines[1]).toMatch(/,0,$/); // no orders yet, nothing spent
  expect(lines[1]).toMatch(/^"Haddad, Omar",omar@example\.com,'\+212 600 000 000,Rabat,MA,Active,/);
});
