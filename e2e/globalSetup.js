import { execFileSync } from 'node:child_process';
import { Redis } from 'ioredis';

/**
 * Brings the E2E database to the latest migration and empties it, so every run starts from
 * a known state. Refuses to run against anything that is not an *_e2e database.
 */
export default async function globalSetup() {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!/\/vendora_e2e(\?|$)/.test(databaseUrl ?? '')) {
    throw new Error(`Refusing to reset a non-E2E database: ${databaseUrl}`);
  }
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  const prisma = ['node_modules/prisma/build/index.js'];

  execFileSync(
    process.execPath,
    [...prisma, 'migrate', 'deploy', '--schema', 'backend/prisma/schema.prisma'],
    { env, stdio: 'pipe' },
  );
  execFileSync(
    process.execPath,
    [...prisma, 'db', 'execute', '--schema', 'backend/prisma/schema.prisma', '--stdin'],
    {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      input: `DO $$ DECLARE t text; BEGIN
        SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') INTO t
        FROM pg_tables WHERE schemaname = 'public'
          AND tablename NOT IN ('_prisma_migrations', 'subscription_plans');
        IF t IS NOT NULL THEN EXECUTE 'TRUNCATE ' || t || ' RESTART IDENTITY CASCADE'; END IF;
      END $$;`,
    },
  );

  // Live Stripe run: put the plans on sale in this database too (idempotent in Stripe).
  if (process.env.E2E_STRIPE === '1') {
    execFileSync(process.execPath, ['backend/src/scripts/stripeSetup.js'], {
      env,
      stdio: 'pipe',
    });
  }

  const redis = new Redis(process.env.E2E_REDIS_URL);
  await redis.flushdb();
  await redis.quit();
}
