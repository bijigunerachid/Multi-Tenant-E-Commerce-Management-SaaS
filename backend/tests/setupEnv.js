// Runs in every test worker before any test module is loaded.
// Tests must never touch the development database or Redis data.
for (const name of ['TEST_DATABASE_URL', 'TEST_REDIS_URL']) {
  if (!process.env[name]) throw new Error(`${name} is not set (see backend/.env.example)`);
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.REDIS_URL = process.env.TEST_REDIS_URL;
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
process.env.MAIL_TRANSPORT = 'memory';
// Retries a few milliseconds apart, so retry tests run fast.
process.env.EMAIL_RETRY_DELAY_MS = '20';
process.env.APP_URL = 'http://localhost:5173';
process.env.CORS_ORIGINS = 'http://localhost:5173';
