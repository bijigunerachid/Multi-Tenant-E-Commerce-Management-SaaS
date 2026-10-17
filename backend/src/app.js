import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { resolveRequestId } from './middleware/requestId.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { sessionCookieSettings, sessionMiddleware } from './middleware/session.js';
import { csrfProtection } from './middleware/csrf.js';
import { configureRateLimits } from './middleware/rateLimit.js';
import { mountRoutes } from './utils/routes.js';
import { createSessionStore } from './modules/auth/sessionStore.js';
import { healthRouter } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { organizationRoutes } from './modules/organizations/organizations.routes.js';
import { invitationRoutes, memberRoutes } from './modules/members/members.routes.js';
import { storeRoutes } from './modules/stores/stores.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { categoryRoutes, productRoutes } from './modules/catalog/catalog.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { customerRoutes } from './modules/customers/customers.routes.js';
import { orderRoutes } from './modules/orders/orders.routes.js';
import { reportRoutes } from './modules/reports/reports.routes.js';
import { emailRoutes } from './modules/emails/emails.routes.js';

const MODULES = [
  authRoutes,
  organizationRoutes,
  memberRoutes,
  invitationRoutes,
  storeRoutes,
  auditRoutes,
  categoryRoutes,
  productRoutes,
  inventoryRoutes,
  customerRoutes,
  orderRoutes,
  reportRoutes,
  emailRoutes,
];

/**
 * Builds the Express application. Dependencies are passed in so tests can supply their own.
 */
export function createApp({ env, logger, prisma, redis, emails, storage }) {
  const app = express();
  configureRateLimits({ scale: env.RATE_LIMIT_SCALE });

  app.disable('x-powered-by');
  // Behind one reverse proxy in production (needed for correct client IPs in rate limiting).
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: resolveRequestId,
      autoLogging: { ignore: (req) => req.url.startsWith('/api/v1/health') },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const sessionStore = createSessionStore({
    redis,
    idleSeconds: env.SESSION_IDLE_MINUTES * 60,
    absoluteSeconds: env.SESSION_ABSOLUTE_DAYS * 24 * 60 * 60,
  });
  const deps = { env, logger, prisma, redis, emails, storage, sessionStore };

  const api = express.Router();
  api.use('/health', healthRouter({ prisma, redis }));
  api.use(sessionMiddleware({ sessionStore, ...sessionCookieSettings(env) }));
  api.use(csrfProtection({ allowedOrigins: env.CORS_ORIGINS }));

  const routeTable = [];
  for (const defineModule of MODULES) {
    const { basePath, routes } = defineModule(deps);
    api.use(basePath, mountRoutes({ basePath, routes, deps, routeTable }));
  }
  app.use('/api/v1', api);
  app.locals.routeTable = routeTable;

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
