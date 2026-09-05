import { Queue } from 'bullmq';
import { config } from './config.js';
import { logger } from './logger.js';
import { queueConnection, redisSubscriber } from './redis.js';
import { staleTasks, markTask, query, one } from './db.js';

/**
 * Redis is the execution plane, Postgres is the system of record — this is what makes that promise true.
 *
 * Every job exists as a task_queue row before it is pushed. If Redis loses a job (restart without AOF,
 * a dropped container, a worker killed mid-flight) the row stays PENDING/PROCESSING and this sweeper
 * re-pushes it. The API also runs `pg_notify('task.ready', …)` on enqueue, so a wake-up is immediate
 * rather than waiting for the interval.
 */
const queues = { [config.queues.pdf]: new Queue(config.queues.pdf, { connection: queueConnection }),
                 [config.queues.email]: new Queue(config.queues.email, { connection: queueConnection }) };

export async function reclaimOnce({ olderThanSec = config.worker.reclaimSeconds, limit = 50 } = {}) {
  const tasks = await staleTasks({ olderThanSec, limit });
  let requeued = 0;
  for (const t of tasks) {
    try {
      const q = queues[t.queue_name];
      if (!q) throw new Error(`no such queue "${t.queue_name}"`);
      const jobName = t.task_type === 'GENERATE_PDF' ? 'payslip-pdf' : 'payslip-email';
      const job = await q.add(jobName, { taskId: t.id, payslipId: t.entity_id, version: t.payload?.version ?? null },
        // unique per sweep: BullMQ drops an add whose job id already exists
        { jobId: `rc-${t.id}-${Date.now()}` });
      await markTask(t.id, 'PENDING', { jobId: String(job.id) });
      requeued += 1;
    } catch (e) {
      // BullMQ keeps its own id; a duplicate simply means the job is already there — leave the row alone.
      if (!/duplicate/i.test(String(e.message))) {
        logger.warn({ taskId: t.id, err: e.message }, 'reclaim failed for task');
        await query(`update task_queue set error_message = $2, updated_at = now() where id = $1::uuid`, [t.id, String(e.message).slice(0, 500)]);
      }
    }
  }
  if (requeued) logger.info({ requeued }, 'stuck jobs re-pushed from the ledger');
  return { scanned: tasks.length, requeued };
}

export function startReclaimLoop() {
  let stopped = false;
  let busy = false;
  const sweep = async () => {
    if (busy || stopped) return;
    busy = true;
    try { await reclaimOnce(); } catch (e) { logger.warn({ err: e.message }, 'reclaim sweep failed'); }
    finally { busy = false; }
  };
  const timer = setInterval(sweep, Math.max(10, config.worker.reclaimSeconds / 3) * 1000);
  timer.unref?.();
  let sub = null;
  (async () => {
    try {
      sub = redisSubscriber();
      await sub.subscribe('task.ready');
      sub.on('message', () => sweep());
    } catch (e) { logger.warn({ err: e.message }, 'task.ready subscription unavailable — interval sweep only'); }
  })();
  return async () => {
    stopped = true;
    clearInterval(timer);
    try { if (sub) { await sub.unsubscribe('task.ready'); await sub.quit(); } } catch { sub?.disconnect?.(); }
    for (const q of Object.values(queues)) await q.close().catch(() => {});
  };
}
/** Used by /health/ready so a worker with a dead queue does not claim it is draining work. */
export async function queueDepth() {
  const out = {};
  for (const [name, q] of Object.entries(queues)) {
    try { out[name] = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'); }
    catch { out[name] = { error: 'unreachable' }; }
  }
  const dead = await one(`select count(*)::int as n from task_queue where status = 'DEAD' and created_at > now() - interval '7 days'`).catch(() => ({ n: 0 }));
  return { queues: out, dead_tasks: dead?.n ?? 0 };
}
