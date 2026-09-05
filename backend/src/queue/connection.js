import IORedis from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';

const base = { ...config.redis, maxRetriesPerRequest: null, enableOfflineQueue: false,
  retryStrategy: (t) => Math.min(t * 300, 5000), tls: config.redis.tls ? {} : undefined };
/** BullQ requires maxRetriesPerRequest:null; the plain client is for cache/counters/advisory locks. */
export const queueConnection = base;
export const redis = new IORedis({ ...base, lazyConnect: false });
redis.on('error', (e) => logger.warn({ err: e.message }, 'redis error'));
redis.on('ready', () => logger.info({ host: base.host, port: base.port }, 'redis ready'));
export async function pingRedis() {
  try { return (await redis.ping()) === 'PONG'; } catch { return false; }
}
export async function quitRedis() { try { await redis.quit(); } catch { redis.disconnect(); } }
export const closeRedis = quitRedis;
