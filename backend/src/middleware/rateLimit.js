import { AppError } from '../utils/errors.js';

// Set once at startup from RATE_LIMIT_SCALE (1 in production; raised only for E2E servers).
let scale = 1;
export function configureRateLimits({ scale: value = 1 } = {}) {
  scale = value;
}

/**
 * Fixed-window rate limiter backed by Redis, so limits hold across API instances.
 * `key(req)` returns the bucket (for example the client IP, or IP + email) or null to skip.
 */
export function rateLimit({ redis, name, windowSeconds, max, key }) {
  return async function limit(req, res, next) {
    const bucket = key(req);
    if (bucket === null || bucket === undefined) return next();

    const redisKey = `rl:${name}:${bucket}`;
    const [[, count], [, ttl]] = await redis.multi().incr(redisKey).ttl(redisKey).exec();
    if (ttl === -1) await redis.expire(redisKey, windowSeconds);

    if (count > max * scale) {
      const retryAfter = ttl > 0 ? ttl : windowSeconds;
      res.setHeader('Retry-After', String(retryAfter));
      return next(
        new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait and try again.', {
          retryAfterSeconds: retryAfter,
        }),
      );
    }
    next();
  };
}
