import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { apiRouter } from './routes/index.js';
import { requestId } from './middleware/request-id.js';
import { errorHandler, notFound } from './middleware/error.js';
import { logger } from './logger.js';

/**
 * Express app factory. Middleware order matters: security → parsing → request-id → health → routes →
 * 404 → error handler. The SPA is served from web/dist when it exists (single container), otherwise the
 * API runs alone and Vite proxies /api to it in development.
 */
export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
  app.use(cors({ origin: config.cors.origin, credentials: true, exposedHeaders: ['X-Request-Id', 'X-Pdf-Sha256', 'Content-Disposition'] }));
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use(requestId);
  app.get(['/health', '/api/health'], (_req, res) => res.json({ ok: true, service: 'api', status: 'up', uptime: Math.round(process.uptime()), ts: new Date().toISOString() }));
  app.get('/api/health/ready', ready);
  app.use('/api', apiRouter());
  if (config.serveStatic && existsSync(config.webDist)) {
    logger.info('serving the built SPA from ' + config.webDist);
    app.use(express.static(config.webDist, { maxAge: '1h', index: false }));
    app.get(/^(?!\/api|\/health).*/, (_req, res, next) =>
      res.sendFile('index.html', { root: config.webDist }, (err) => (err ? next() : undefined)));
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
/** Readiness checks the dependencies, because a half-up stack must not be reported as healthy. */
async function ready(_req, res) {
  try {
    const { pool } = await import('./db/pool.js');
    const { pingRedis } = await import('./queue/connection.js');
    const db = await pool.query('select 1 as ok').then((r) => r.rows[0]?.ok === 1).catch(() => false);
    const redis = await pingRedis().catch(() => false);
    const ok = db && redis;
    res.status(ok ? 200 : 503).json({ ok, db, redis, queue_backend: ok ? 'up' : 'degraded' });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
}
