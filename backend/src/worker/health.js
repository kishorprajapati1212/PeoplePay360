import express from 'express';
import { config } from './config.js';
import { logger } from './logger.js';
import { pingDb, counts } from './db.js';
import { pingRedis } from './redis.js';
import { queueDepth } from './reclaim.js';
import { mailCapabilities } from './jobs/email.job.js';
import { resolveDriver } from '../lib/mailer/index.js';

const started = Date.now();
let drained = 0;
let failed = 0;
export const recordDrain = (n = 1, bad = 0) => { drained += n; failed += bad; };
export const drainStats = () => ({ processed: drained, failed });

/**
 * A tiny HTTP surface so `docker compose ps`, a k8s probe and a curious human all get the same answer.
 * /health is liveness (is the process up); /health/ready is readiness (can it actually do work).
 */
export function healthApp({ workers = [] } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'worker', uptime: Math.round((Date.now() - started) / 1000),
    jobs: { processed: drained, failed }, pdf_dir: config.pdf.dir, mail_driver: resolveDriver(config.mail).driver, pdf_renderer: config.pdf.renderer,
    queues: Object.values(config.queues), concurrency: config.worker.concurrency,
    // the resolved queue target, because "the worker can't reach Redis" is always a host/port mismatch
    redis: { host: config.redis.host, port: config.redis.port, db: config.redis.db, tls: config.redis.tls,
             auth: Boolean(config.redis.password || config.redis.username) } }));
  app.get('/health/ready', async (_req, res) => {
    const [db, redis, depth] = await Promise.all([pingDb(), pingRedis(), queueDepth().catch(() => ({}))]);
    const ok = db && redis;
    res.status(ok ? 200 : 503).json({ ok, db, redis, redis_target: `${config.redis.host}:${config.redis.port}/${config.redis.db}`,
      ...depth, workers: workers.map((w) => ({ name: w.name ?? 'worker' })) });
  });
  app.get('/stats', async (_req, res) => {
    const byStatus = await counts().catch(() => []);
    res.json({ uptime_seconds: Math.round((Date.now() - started) / 1000), processed: drained, failed,
      tasks: Object.fromEntries(byStatus.map((r) => [r.status, r.n])) });
  });
  return app;
}
export function listenHealth(workers) {
  const server = healthApp({ workers }).listen(config.worker.port, config.worker.host, () =>
    logger.info(`worker health on http://localhost:${config.worker.port}/health`));
  server.on('error', (e) => { if (e.code === 'EADDRINUSE') logger.warn(`port ${config.worker.port} busy — health endpoint not started`); else throw e; });
  return server;
}
