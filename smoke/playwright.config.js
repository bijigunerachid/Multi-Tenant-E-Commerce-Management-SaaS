import { defineConfig, devices } from '@playwright/test';

// Smoke checks for a deployed Vendora: read-only, safe to run against production.
//   SMOKE_URL=https://app.example.com npm run smoke
// SMOKE_INSECURE=1 accepts a self-signed certificate (the local production stack on localhost).

const baseURL = process.env.SMOKE_URL;
if (!baseURL)
  throw new Error('Set SMOKE_URL to the site to check, for example https://app.example.com');

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: 1,
  workers: 1,
  reporter: [['list']],
  use: { baseURL, ignoreHTTPSErrors: process.env.SMOKE_INSECURE === '1' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
