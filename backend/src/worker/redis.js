import IORedis from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * BullMQ needs `maxRetriesPerRequest: null` (it blocks on locks) and no offline queue, so a Redis outage
 * fails fast instead of pretending the job was accepted. A second, plain client handles pub/sub + counters.
 */
const base = { host: config.redis.host, port: config.redis.port, db: config.redis.db,
  ...(config.redis.password ? { password: config.redis.password } : {}),
  ...(config.redis.username ? { username: config.redis.username } : {}),
  ...(config.redis.tls ? { tls: {} } : {}) };

export const queueConnection = { ...base, maxRetriesPerRequest: null, enableOfflineQueue: false, retryStrategy: (t) => Math.min(t * 300, 5000) };
export const redis = new IORedis({ ...queueConnection, maxRetriesPerRequest: 3 });
redis.on('error', (e) => logger.warn({ err: e.message }, 'redis error'));
redis.on('ready', () => logger.info({ host: base.host, port: base.port }, 'redis ready'));

export const redisSubscriber = () => {
  const sub = new IORedis({ ...base, maxRetriesPerRequest: 3 });
  sub.on('error', (e) => logger.warn({ err: e.message }, 'redis subscriber error'));
  return sub;
};
export async function pingRedis() {
  try { return (await redis.ping()) === 'PONG'; } catch { return false; }
}
export async function closeRedis() {
  try { await redis.quit(); } catch { redis.disconnect(); }
}
