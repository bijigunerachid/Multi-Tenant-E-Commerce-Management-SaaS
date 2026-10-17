import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// End-to-end tests run the real API and web app against their own database (vendora_e2e)
// and Redis database (2), on their own ports, so they never touch development or unit-test
// data. Emails go to Mailpit, where the tests read verification and invitation links.

if (existsSync('backend/.env')) process.loadEnvFile('backend/.env');

const API_PORT = 4101;
const WEB_PORT = 5174;
const WEB_URL = `http://localhost:${WEB_PORT}`;

const replaceDatabase = (url, name) => url.replace(/\/[^/?]+(\?|$)/, `/${name}$1`);
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  replaceDatabase(process.env.TEST_DATABASE_URL ?? '', 'vendora_e2e');
export const E2E_REDIS_URL =
  process.env.E2E_REDIS_URL ?? (process.env.TEST_REDIS_URL ?? '').replace(/\/\d+$/, '/2');
process.env.E2E_DATABASE_URL = E2E_DATABASE_URL;
process.env.E2E_REDIS_URL = E2E_REDIS_URL;
process.env.MAILPIT_URL ??= 'http://127.0.0.1:8025';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/globalSetup.js',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node src/server.js',
      cwd: 'backend',
      url: `http://127.0.0.1:${API_PORT}/api/v1/health/ready`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        LOG_LEVEL: 'warn',
        DATABASE_URL: E2E_DATABASE_URL,
        REDIS_URL: E2E_REDIS_URL,
        CORS_ORIGINS: WEB_URL,
        APP_URL: WEB_URL,
        MAIL_TRANSPORT: 'smtp',
        SMTP_URL: process.env.E2E_SMTP_URL ?? 'smtp://127.0.0.1:1025',
        // Emails and notifications go through the real queues; the API process runs the worker.
        JOB_WORKER: 'in-process',
        NOTIFICATION_POLL_MS: '300',
        // The suite signs up more users from one address than the production limits allow.
        RATE_LIMIT_SCALE: '20',
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: 'frontend',
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...process.env, API_PROXY_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
});
