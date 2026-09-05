import { redis } from '../queue/connection.js';
import { AppError } from '../lib/shared/index.js';
/**
 * Protects the money buttons: a double-click on MARK PAID or a retried bulk send must not pay twice.
 * The client sends `Idempotency-Key`; the first request wins and a replay gets 409 with the original result.
 */
export function idempotent({ ttlSec = 600 } = {}) {
  return async (req, res, next) => {
    const key = req.headers['idempotency-key'] || req.body?.idempotencyKey;
    if (!key) return next();
    const k = `idem:${req.auth?.userId || 'anon'}:${String(key).slice(0, 120)}`;
    try {
      const got = await redis.set(k, 'in-flight', 'EX', ttlSec, 'NX');
      if (!got) {
        const prev = await redis.get(k);
        if (prev === 'in-flight') throw new AppError('ALREADY_IN_PROGRESS', 'An identical request is still running', { status: 409 });
        throw new AppError('ALREADY_PROCESSED', 'This action was already completed (idempotency key reused)', { status: 409, details: { result: safeParse(prev) } });
      }
      res.on('finish', () => {
        if (res.statusCode < 400) redis.set(k, JSON.stringify({ status: res.statusCode, at: Date.now() }), 'EX', ttlSec).catch(() => {});
        else redis.del(k).catch(() => {});
      });
      next();
    } catch (e) {
      if (e instanceof AppError) return next(e);
      next(); // Redis down: never block a legitimate action, the DB guards still apply
    }
  };
}
const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
