import { expect, test } from '@playwright/test';

// Read-only checks of a deployed site: nothing is created, so they are safe on production.

test('the API is up and its dependencies are reachable', async ({ request }) => {
  const ready = await request.get('/api/v1/health/ready');
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({
    data: { status: 'ready', checks: { database: 'up', redis: 'up' } },
  });
});

test('pages are served with the security headers', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const headers = res.headers();
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['strict-transport-security']).toContain('max-age=');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['cache-control']).toBe('no-cache');
  // Any app address falls back to the web app.
  const deep = await request.get('/orders/does-not-matter');
  expect(deep.status()).toBe(200);
  expect(deep.headers()['content-type']).toContain('text/html');
});

test('the public plans are served', async ({ request }) => {
  const res = await request.get('/api/v1/plans');
  expect(res.status()).toBe(200);
  const { data } = await res.json();
  expect(data.length).toBeGreaterThan(0);
  for (const plan of data) expect(plan).toHaveProperty('priceMonthly');
});

test('the homepage, pricing and sign-in render without browser errors', async ({ page }) => {
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    // 401 from the session check of a signed-out visitor is expected.
    if (m.type() === 'error' && !/status of 401/.test(m.text())) problems.push(m.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  expect(problems).toEqual([]);
});
