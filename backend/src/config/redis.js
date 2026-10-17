import { Redis } from 'ioredis';

export function createRedisClient({ redisUrl, logger }) {
  const redis = new Redis(redisUrl, {
    // BullMQ requires this setting on connections it uses; keeping one convention avoids surprises.
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  redis.on('error', (error) => logger.error({ err: error }, 'Redis connection error'));
  return redis;
}
