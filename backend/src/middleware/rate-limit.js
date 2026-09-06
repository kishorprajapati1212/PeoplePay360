import { config } from '../config.js';
import { redis } from '../queue/connection.js';
import { AppError } from '../lib/shared/index.js';
/** Fixed-window limiter in Redis. Cheap, and it also protects the login path from stuffing. */
export function rateLimit({ perMinute = config.rate.perMinute, key = (req) => req.auth?.userId || req.ip } = {}) {
  return async (req, res, next) => {
    if (!config.rate.enabled) return next();
    const bucket = Math.floor(Date.now() / 60000);
    // The path is part of the key: without it every rate-limited route shared one counter per caller,
    // so a burst of logins ate the (much smaller) set-password budget and the invitation flow
    // started answering 429 in an ordinary smoke run.
    const k = `rl:${req.path}:${key(req)}:${bucket}`;
    try {
      const n = await redis.multi().incr(k).expire(k, 70).exec();
      const count = Number(n?.[0]?.[1] ?? 1);
      res.setHeader('X-RateLimit-Limit', perMinute);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, perMinute - count));
      if (count > perMinute) throw new AppError('RATE_LIMITED', 'Too many requests — slow down', { status: 429, retryable: true, details: { retryAfterSec: 60 - new Date().getSeconds() } });
      next();
    } catch (e) {
      if (e instanceof AppError) return next(e);
      next();
    }
  };
}
