import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool, query } from './db/pool.js';
import { closeRedis } from './queue/connection.js';
import { closeQueues } from './queue/queues.js';
import { banner } from './utils/urls.js';

const links = () => [[
  ['API', `http://localhost:${config.port}/api`],
  ['Web', `http://localhost:${config.webPort}`],
  ['Worker', `http://localhost:${config.workerPort}/health`],
  ['Docs', `http://localhost:${config.port}/api/health`],
]];

/**
 * Startup: wait for Postgres (compose starts containers in parallel), install the per-process LISTEN
 * channel that fans `task.ready` out to workers, then listen. Shutdown drains in-flight work first.
 */
async function waitForDb(tries = 25) {
  for (let i = 0; i < tries; i += 1) {
    try { await pool.query('select 1'); return true; }
    catch (e) { if (i === tries - 1) throw e; await new Promise((r) => setTimeout(r, 1000)); }
  }
  return false;
}
async function main() {
  await waitForDb();
  await query(`select pg_advisory_lock_shared(hashtext('pp360-api'))`).catch(() => {});
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    banner([
      ['API', `http://localhost:${config.port}/api`],
      ['Web', `http://localhost:${config.webPort}`],
      ['Health', `http://localhost:${config.port}/api/health`],
      ['Ready', `http://localhost:${config.port}/api/health/ready`],
    ]);
    logger.info({ msg: 'api listening', host: config.host, port: config.port, env: config.env });
  });
  const shutdown = async (signal) => {
    logger.info({ msg: 'shutting down', signal });
    server.close();
    await Promise.allSettled([closeQueues().catch(() => {}), closeRedis().catch(() => {}), pool.end()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (e) => logger.error({ msg: 'unhandled rejection', err: e }));
}
main().catch((e) => { logger.error({ msg: 'api failed to start', err: e }); process.exit(1); });
