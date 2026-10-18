import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((value) => value.split(',').map((origin) => origin.trim()))
    .pipe(z.array(z.url())),

  // Public address of the web app, used to build links in emails.
  APP_URL: z.url().default('http://localhost:5173'),

  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(30).default(7),

  // "memory" keeps sent emails in process (tests); "smtp" delivers to SMTP_URL (Mailpit locally).
  MAIL_TRANSPORT: z.enum(['smtp', 'memory']).default('smtp'),
  SMTP_URL: z.url({ protocol: /^smtps?$/ }).default('smtp://127.0.0.1:1025'),
  MAIL_FROM: z.string().min(3).default('Vendora <no-reply@vendora.local>'),

  // Background jobs (emails, notifications) run in a worker. "separate": run it with
  // `npm run worker` (production); "in-process": the API process runs it too (end-to-end
  // tests, single-process setups).
  JOB_WORKER: z.enum(['separate', 'in-process']).default('separate'),
  // First retry delay; each further retry waits twice as long (5 attempts in total).
  EMAIL_RETRY_DELAY_MS: z.coerce.number().int().min(10).max(3_600_000).default(30_000),
  // How often the worker delivers pending notifications (new orders, low stock).
  NOTIFICATION_POLL_MS: z.coerce.number().int().min(100).max(300_000).default(5_000),

  // Payments for Vendora plans. "none": plans cannot be bought (trials and limits still work).
  // "stripe": Stripe Checkout and Customer Portal; needs both Stripe values below.
  BILLING_PROVIDER: z.enum(['none', 'stripe']).default('none'),
  // A restricted key (rk_...) is recommended; see docs/architecture.md for its permissions.
  STRIPE_SECRET_KEY: z
    .string()
    .regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/, 'must be a Stripe secret or restricted key')
    .optional(),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_[A-Za-z0-9]+$/, 'must be a Stripe webhook signing secret')
    .optional(),

  // Encrypts authenticator secrets at rest: 32 random bytes, base64 (openssl rand -base64 32).
  // Required in production; development uses a fixed key.
  MFA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded')
    .optional(),

  // Local directory for uploaded files (development). Kept outside any web-served folder.
  UPLOAD_DIR: z.string().min(1).default('uploads'),

  // Multiplies every rate limit. Only for automated test servers that legitimately make many
  // requests from one address; must stay 1 in production (enforced below).
  RATE_LIMIT_SCALE: z.coerce.number().int().min(1).max(1000).default(1),
});

function describeProblems(error) {
  return error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
}

/**
 * For command-line scripts: validates only the settings the script uses (always including
 * NODE_ENV), so a script that only talks to the database does not need Redis or CORS settings.
 */
export function loadEnvFor(names, source = process.env) {
  const result = envSchema
    .pick(Object.fromEntries(['NODE_ENV', ...names].map((n) => [n, true])))
    .safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${describeProblems(result.error)}`);
  }
  return Object.freeze(result.data);
}

/**
 * Validates process.env once at startup. A misconfigured server must refuse to start
 * instead of failing later on the first request that needs the missing value.
 */
export function loadEnv(source = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${describeProblems(result.error)}`);
  }
  const env = result.data;
  if (env.NODE_ENV === 'production' && env.RATE_LIMIT_SCALE !== 1) {
    throw new Error(
      'Invalid environment configuration:\n  RATE_LIMIT_SCALE: must be 1 in production',
    );
  }
  if (env.BILLING_PROVIDER === 'stripe' && (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET)) {
    throw new Error(
      'Invalid environment configuration:\n  BILLING_PROVIDER: stripe needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET',
    );
  }
  if (env.NODE_ENV !== 'production' && /_live_/.test(env.STRIPE_SECRET_KEY ?? '')) {
    throw new Error(
      'Invalid environment configuration:\n  STRIPE_SECRET_KEY: live keys are only accepted in production',
    );
  }
  if (env.NODE_ENV === 'production') {
    // Settings that work in development but are wrong for real users.
    const problems = [];
    if (!env.APP_URL.startsWith('https://')) problems.push('APP_URL: must use https in production');
    if (!env.CORS_ORIGINS.includes(new URL(env.APP_URL).origin)) {
      problems.push('CORS_ORIGINS: must include the origin of APP_URL');
    }
    if (env.MAIL_TRANSPORT !== 'smtp') {
      problems.push('MAIL_TRANSPORT: must be smtp in production (emails would never be sent)');
    }
    if (!env.MFA_ENCRYPTION_KEY) {
      problems.push('MFA_ENCRYPTION_KEY: set 32 random bytes, base64 (openssl rand -base64 32)');
    }
    if (!source.SMTP_URL) {
      problems.push('SMTP_URL: set your mail provider (the default is a local test inbox)');
    }
    if (problems.length) {
      throw new Error(`Invalid environment configuration:\n  ${problems.join('\n  ')}`);
    }
  }
  return Object.freeze(env);
}
