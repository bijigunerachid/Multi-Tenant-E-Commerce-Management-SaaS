import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';

export const PASSWORD = 'e2e-correct-horse-battery';

export function uniqueEmail(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}@e2e.example`;
}

/** Waits for the newest email to `to` in Mailpit and returns the link it contains for `path`. */
export async function linkFromEmail(request, to, path) {
  const base = process.env.MAILPIT_URL;
  let link = null;
  await expect
    .poll(
      async () => {
        const search = await request.get(`${base}/api/v1/search`, {
          params: { query: `to:"${to}"` },
        });
        const { messages = [] } = await search.json();
        if (messages.length === 0) return null;
        const message = await (
          await request.get(`${base}/api/v1/message/${messages[0].ID}`)
        ).json();
        link =
          message.Text.match(new RegExp(`https?://\\S+${path}\\?token=[A-Za-z0-9_-]+`))?.[0] ??
          null;
        return link;
      },
      { timeout: 15_000, message: `email to ${to} with a ${path} link` },
    )
    .not.toBeNull();
  // Links point at APP_URL; keep only path + query so the test's baseURL is used.
  const url = new URL(link);
  return url.pathname + url.search;
}

/** Registers through the UI, confirms the email from Mailpit, and creates an organization. */
export async function registerAndOnboard(page, { name, email, organization }) {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your organization' })).toBeVisible();

  await page.goto(await linkFromEmail(page.request, email, '/verify-email'));
  await expect(page.getByText('Email confirmed')).toBeVisible();
  await page.getByRole('link', { name: 'Continue to Vendora' }).click();

  await page.getByLabel('Business name').fill(organization);
  await page.getByLabel('First store name').fill(`${organization} main store`);
  await page.getByLabel('Currency').selectOption('MAD');
  await page.getByLabel('Time zone').selectOption('Africa/Casablanca');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { level: 1, name: organization })).toBeVisible();
}

/** Calls the API from inside the signed-in page, with its cookies and CSRF token. */
export async function apiFromPage(page, method, path, body) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const me = await fetch('/api/v1/auth/me', { credentials: 'same-origin' }).then((r) =>
        r.json(),
      );
      const res = await fetch(`/api/v1${path}`, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.data.csrfToken },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, path, body },
  );
}
