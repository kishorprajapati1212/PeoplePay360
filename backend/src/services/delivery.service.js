import { AppError } from '../lib/shared/index.js';
import * as repo from '../repositories/delivery.repo.js';
import { queueStats } from '../queue/queues.js';
import { pingRedis } from '../queue/connection.js';
import { query } from '../db/pool.js';

export const tasks = (f) => repo.recentTasks(f);
export const stats = async () => {
  const [db, redis, queues] = await Promise.all([repo.taskStats(), pingRedis(), queueStats().catch(() => ({}))]);
  return { db, redis: redis ? 'up' : 'down', queues };
};
export async function retry(taskId, { auth } = {}) {
  const t = await repo.taskOf(taskId);
  if (!t) throw AppError.notFound('Job not found');
  if (!['FAILED', 'DEAD', 'CANCELLED'].includes(t.status)) throw new AppError('NOT_RETRYABLE', `This job is ${t.status.toLowerCase()}`, { status: 409 });
  const { schedule, QUEUES } = await import('../queue/queues.js');
  const dedupe = `${t.task_type.toLowerCase()}:${t.entity_id}:retry:${Date.now()}`;
  const task = await repo.enqueueTask({ task_type: t.task_type, entity_type: t.entity_type, entity_id: t.entity_id, payrun_id: t.payrun_id,
    dedupe_key: dedupe, queue_name: t.queue_name, payload: t.payload, priority: 5 });
  await schedule(t.queue_name, t.task_type === 'GENERATE_PDF' ? 'payslip-pdf' : 'payslip-email',
    { taskId: task.id, payslipId: t.entity_id, version: t.payload?.version ?? null }, { dedupeKey: dedupe });
  await repo.markTask(t.id, 'PENDING', { error: null });
  return { ok: true, retried: task.id, note: 'Re-queued with a fresh dedupe key' };
}
/** Re-push anything the DB says is pending but Redis has forgotten (worker restart, flushed queue). */
export async function reclaim({ limit = 50 } = {}) {
  const stuck = await repo.pendingTasks({ limit });
  const { schedule } = await import('../queue/queues.js');
  let pushed = 0;
  for (const t of stuck) {
    try { await schedule(t.queue_name, t.task_type === 'GENERATE_PDF' ? 'payslip-pdf' : 'payslip-email', { taskId: t.id, payslipId: t.entity_id }, { dedupeKey: `reclaim:${t.id}` }); pushed += 1; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  return { scanned: stuck.length, pushed };
}
export const emails = (payrunId) => repo.emailLedger({ payrunId, limit: 500 });
