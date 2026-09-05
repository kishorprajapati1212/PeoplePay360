import crypto from 'node:crypto';
import { Queue } from 'bullmq';
import { queueConnection } from './connection.js';
import { config } from '../config.js';

/**
 * Redis is the execution plane; task_queue (Postgres) is the system of record. Every enqueue below
 * writes the ledger row first, so a lost Redis job can always be re-pushed from the DB.
 */
export const QUEUES = { pdf: 'payslip-pdf', email: 'payslip-email', import: 'employee-import', export: 'report-export' };
const mk = (name) => new Queue(name, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 86400 },
  },
});
export const queues = { [QUEUES.pdf]: mk(QUEUES.pdf), [QUEUES.email]: mk(QUEUES.email), [QUEUES.import]: mk(QUEUES.import), [QUEUES.export]: mk(QUEUES.export) };
export const queue = (name) => queues[name] || queues[QUEUES.pdf];
/**
 * Push a job onto a queue. The ledger row is written first (see repositories/delivery.repo.js),
 * so losing this call is recoverable — the worker's reclaim sweep re-pushes from Postgres.
 */
export async function schedule(name, jobName, data, { dedupeKey, delay = 0, priority } = {}) {
  const q = queue(name);
  // BullMQ forbids ":" in a custom job id and our dedupe keys look like "type:uuid:version", so hash it.
  const jobId = dedupeKey ? `dk-${crypto.createHash('sha1').update(String(dedupeKey)).digest('hex').slice(0, 24)}` : undefined;
  if (jobId) await clearFinished(q, jobId);
  return q.add(jobName, data, { delay, priority, jobId });
}

/**
 * A job id is derived from the ledger's dedupe key, so a revived task (retry, reclaim after a crash,
 * a forced second send of the same document version) would be dropped silently — BullMQ ignores an
 * add whose id is already present. Finished jobs are evicted first; live ones are left alone so a
 * double click cannot run the same job twice.
 */
async function clearFinished(q, jobId) {
  const existing = await q.getJob(jobId).catch(() => null);
  if (!existing) return;
  const state = await existing.getState().catch(() => null);
  if (state === 'completed' || state === 'failed') await existing.remove().catch(() => {});
}

export async function queueStats() {
  const out = {};
  for (const [name, q] of Object.entries(queues)) {
    const s = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
    out[name] = s;
  }
  return out;
}
export async function pauseAll() { for (const q of Object.values(queues)) await q.pause().catch(() => {}); }
export async function closeQueues() { await Promise.all(Object.values(queues).map((q) => q.close().catch(() => {}))); }
export const workerConcurrency = config.queue.concurrency;
