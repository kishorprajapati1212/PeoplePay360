import { randomUUID } from 'node:crypto';
import { logger } from '../logger.js';
export function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]({ rid: req.id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: +ms.toFixed(1),
                    user: req.auth?.userId || null, ip: req.ip, body: req.method === 'GET' ? undefined : safe(req.body) }, 'http');
  });
  next();
}
const safe = (b) => { if (!b || typeof b !== 'object') return undefined; const { password, currentPassword, newPassword, token, ...rest } = b; return Object.keys(rest).length ? rest : undefined; };
