import { loadEnv } from './env.js';

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

  test('refuses to start with a missing or invalid value and names it', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...valid, REDIS_URL: 'http://localhost' })).toThrow(/REDIS_URL/);
    expect(() => loadEnv({ ...valid, CORS_ORIGINS: 'not a url' })).toThrow(/CORS_ORIGINS/);
  });
});
