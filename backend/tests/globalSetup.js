import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Bring the test database up to the latest migration once per test run.
export default function globalSetup() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is not set (see backend/.env.example)');

  const backendDir = fileURLToPath(new URL('..', import.meta.url));
  execFileSync(process.execPath, ['../node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}
