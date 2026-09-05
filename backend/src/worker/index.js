import { config } from './config.js';
import { logger } from './logger.js';
import { closeRedis, pingRedis } from './redis.js';
import { closeDb, pingDb } from './db.js';
import { createPdfWorker, onPdfFailed } from './jobs/pdf.job.js';
import { createEmailWorker, onEmailFailed, mailCapabilities } from './jobs/email.job.js';
import { startReclaimLoop, reclaimOnce } from './reclaim.js';
import { listenHealth, recordDrain, drainStats } from './health.js';
import { banner } from '../utils/urls.js';

/**
 * Worker entry point. Two BullMQ consumers (PDF rendering, payslip email) plus the ledger sweeper that
 * re-pushes anything Redis lost. Everything is graceful: SIGTERM stops accepting, waits for in-flight
 * jobs, then closes Redis and Postgres — so a container restart never strands a payslip mid-render.
 */
async function waitForDeps(tries = 30) {
  for (let i = 0; i < tries; i += 1) {
    const [db, redis] = await Promise.all([pingDb(), pingRedis()]);
    if (db && redis) return true;
    if (i === tries - 1) return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

const pdf = createPdfWorker();
const email = createEmailWorker();
let stopping = false;
for (const [name, w] of [['pdf', pdf], ['email', email]]) {
  w.on('ready', () => logger.info({ worker: name }, 'consuming'));
  w.on('failed', (job, err) => {
    recordDrain(0, 1);
    if (name === 'pdf') onPdfFailed(job, err).catch(() => {}); else onEmailFailed(job, err).catch(() => {});
  });
  w.on('completed', () => recordDrain(1));
  w.on('error', (e) => logger.error({ worker: name, err: e.message }, 'worker error'));
}
pdf.on('drained', () => logger.debug('pdf queue drained'));
email.on('drained', () => logger.debug('email queue drained'));

const stopReclaim = startReclaimLoop();
const health = listenHealth([pdf, email]);

async function main() {
  if (!(await waitForDeps())) {
    logger.error('Postgres or Redis is unavailable — the worker is exiting so the container restarts and retries');
    process.exitCode = 1;
    await shutdown('deps-unavailable');
    return;
  }
  const caps = await mailCapabilities().catch(() => ({ ok: true, driver: config.mail.MAIL_DRIVER }));
  // The server is printed because "the API sends and the worker does not" is a question about which process read
  // which settings — answered from the log line, with no shell in either container.
  logger.info({ mail: caps.driver, mail_server: caps.server || '—', mail_inferred: caps.inferred || null,
                mail_ok: caps.ok, pdf: config.pdf.renderer, dir: config.pdf.dir,
                redis: `${config.redis.host}:${config.redis.port}/${config.redis.db}` }, 'worker ready');
  banner([
    ['Worker health', `http://localhost:${config.worker.port}/health`],
    ['Worker stats', `http://localhost:${config.worker.port}/stats`],
    ['API', `http://localhost:${config.worker.apiPort}/api`],
    ['Web', `http://localhost:${config.worker.webPort}`],
  ], `PeoplePay360 worker · mail=${caps.driver}${caps.server ? ' → ' + caps.server : ' (files only)'} · pdf=${config.pdf.renderer}`);
  if (caps.ok === false) logger.warn({ err: caps.error }, 'the mail transport could not verify — the mail account and its App Password are the only two settings that matter (Settings → Company, or EMAIL_NAME / EMAIL_PASSWORD); check the port only if you typed a host yourself');
  await reclaimOnce({ olderThanSec: 0 }).catch(() => {});
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'draining');
  await stopReclaim().catch(() => {});
  await Promise.all([pdf.close(), email.close()]).catch(() => {});
  await new Promise((r) => (health.close(r), setTimeout(r, 1500)));
  await closeRedis();
  await closeDb();
  logger.info(drainStats(), 'stopped');
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => logger.error({ err: String(e?.stack ?? e) }, 'unhandled rejection'));
main().catch(async (e) => { logger.error({ err: e.message }, 'worker failed to start'); await shutdown('startup-error'); });
