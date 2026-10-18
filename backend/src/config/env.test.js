import { loadEnv, loadEnvFor } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5434/db',
  REDIS_URL: 'redis://:pass@localhost:6380/0',
  CORS_ORIGINS: 'http://localhost:5173, https://app.example.com',
};

describe('loadEnv', () => {
  test('applies defaults and splits CORS origins', () => {
    const env = loadEnv(valid);

    expect(env.PORT).toBe(4100);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  test('rate limits cannot be scaled up in production', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      APP_URL: 'https://app.example.com',
      SMTP_URL: 'smtps://user:pass@smtp.example.com:465',
    };
    expect(() => loadEnv({ ...production, RATE_LIMIT_SCALE: '20' })).toThrow(/RATE_LIMIT_SCALE/);
    expect(loadEnv(production).RATE_LIMIT_SCALE).toBe(1);
    expect(loadEnv({ ...valid, RATE_LIMIT_SCALE: '20' }).RATE_LIMIT_SCALE).toBe(20);
  });

  test('refuses to start with a missing or invalid value and names it', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...valid, REDIS_URL: 'http://localhost' })).toThrow(/REDIS_URL/);
    expect(() => loadEnv({ ...valid, CORS_ORIGINS: 'not a url' })).toThrow(/CORS_ORIGINS/);
  });

  test('production refuses settings that only make sense in development', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      APP_URL: 'https://app.example.com',
      SMTP_URL: 'smtps://user:pass@smtp.example.com:465',
    };
    expect(loadEnv(production).NODE_ENV).toBe('production');
    expect(() => loadEnv({ ...production, APP_URL: 'http://app.example.com' })).toThrow(
      /APP_URL: must use https/,
    );
    expect(() => loadEnv({ ...production, APP_URL: 'https://other.example.com' })).toThrow(
      /CORS_ORIGINS: must include the origin of APP_URL/,
    );
    expect(() => loadEnv({ ...production, MAIL_TRANSPORT: 'memory' })).toThrow(/MAIL_TRANSPORT/);
    expect(() => loadEnv({ ...production, SMTP_URL: undefined })).toThrow(/SMTP_URL/);
    // All problems are listed at once, so a deploy does not fail one setting at a time.
    expect(() => loadEnv({ ...production, MAIL_TRANSPORT: 'memory', SMTP_URL: undefined })).toThrow(
      /MAIL_TRANSPORT[\s\S]*SMTP_URL/,
    );
  });

  test('scripts check only the settings they use', () => {
    const databaseOnly = { DATABASE_URL: valid.DATABASE_URL };
    // No Redis or CORS settings, as in CI or on a server shell: fine for a database script.
    expect(loadEnvFor(['DATABASE_URL'], databaseOnly)).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: valid.DATABASE_URL,
    });
    expect(() => loadEnv(databaseOnly)).toThrow(/REDIS_URL/);
    expect(() => loadEnvFor(['DATABASE_URL'], {})).toThrow(/DATABASE_URL/);
    expect(() =>
      loadEnvFor(['DATABASE_URL', 'STRIPE_SECRET_KEY'], {
        ...databaseOnly,
        STRIPE_SECRET_KEY: 'pk_test_abc123',
      }),
    ).toThrow(/STRIPE_SECRET_KEY/);
  });

  test('Stripe billing needs both Stripe values, and live keys only run in production', () => {
    const key = 'sk_test_abc123';
    const webhook = 'whsec_abc123';
    expect(loadEnv(valid).BILLING_PROVIDER).toBe('none');
    expect(() => loadEnv({ ...valid, BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: key })).toThrow(
      /STRIPE_WEBHOOK_SECRET/,
    );
    const stripe = { ...valid, BILLING_PROVIDER: 'stripe', STRIPE_WEBHOOK_SECRET: webhook };
    expect(loadEnv({ ...stripe, STRIPE_SECRET_KEY: key }).BILLING_PROVIDER).toBe('stripe');
    expect(loadEnv({ ...stripe, STRIPE_SECRET_KEY: 'rk_test_abc123' }).BILLING_PROVIDER).toBe(
      'stripe',
    );
    expect(() => loadEnv({ ...stripe, STRIPE_SECRET_KEY: 'pk_test_abc123' })).toThrow(
      /STRIPE_SECRET_KEY/,
    );
    expect(() => loadEnv({ ...stripe, STRIPE_SECRET_KEY: 'sk_live_abc123' })).toThrow(/live keys/);
  });
});
