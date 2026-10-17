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

  // Local directory for uploaded files (development). Kept outside any web-served folder.
  UPLOAD_DIR: z.string().min(1).default('uploads'),

  // Multiplies every rate limit. Only for automated test servers that legitimately make many
  // requests from one address; must stay 1 in production (enforced below).
  RATE_LIMIT_SCALE: z.coerce.number().int().min(1).max(1000).default(1),
});

/**
 * Validates process.env once at startup. A misconfigured server must refuse to start
 * instead of failing later on the first request that needs the missing value.
 */
export function loadEnv(source = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = result.data;
  if (env.NODE_ENV === 'production' && env.RATE_LIMIT_SCALE !== 1) {
    throw new Error(
      'Invalid environment configuration:\n  RATE_LIMIT_SCALE: must be 1 in production',
    );
  }
  if (env.NODE_ENV === 'production' && !env.APP_URL.startsWith('https://')) {
    throw new Error('Invalid environment configuration:\n  APP_URL: must use https in production');
  }
  return Object.freeze(env);
}
