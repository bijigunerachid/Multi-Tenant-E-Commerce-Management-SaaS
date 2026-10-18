import { loadEnv } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { createApp } from '../app.js';
import { buildOpenApi } from './openapi.js';

export const API_VERSION = 'v1';

/**
 * The OpenAPI document as written to docs/openapi.json. The app is built only to read its
 * route table: nothing connects, so placeholder settings and stand-in clients are enough.
 */
export function generateOpenApi() {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://openapi:openapi@localhost:5432/openapi',
    REDIS_URL: 'redis://localhost:6379',
    CORS_ORIGINS: 'http://localhost:5173',
  });
  const app = createApp({
    env,
    logger: createLogger({ level: 'silent' }),
    prisma: {},
    redis: {},
    emails: {},
    storage: {},
  });
  return `${JSON.stringify(buildOpenApi(app.locals.routeTable, { version: API_VERSION }), null, 2)}\n`;
}
