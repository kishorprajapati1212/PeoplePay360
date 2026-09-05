import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * The worker owns its own pool: it is a separate process and must not reach into the API's modules for
 * data access. Postgres is the system of record for delivery, so every job writes its result back here.
 */
export const pool = new pg.Pool({
  connectionString: config.db.connectionString,
  max: config.db.max,
  ssl: config.db.ssl,
  application_name: 'peoplepay360-worker',
  idleTimeoutMillis: 30_000,
});
pool.on('error', (e) => logger.error({ err: e.message }, 'pg pool error'));

export const query = (sql, params) => pool.query(sql, params);
export const one = async (sql, params) => (await query(sql, params)).rows[0] ?? null;
export const rows = async (sql, params) => (await query(sql, params)).rows;

const NUMERIC = ['gross_amount', 'net_amount', 'total_deductions', 'total_adjustments', 'amount', 'worked_hours', 'overtime_hours',
                 'pro_rata_factor', 'expected_working_days', 'paid_days', 'unpaid_leave_days', 'leave_days', 'absent_days',
                 'holiday_days', 'basic_salary', 'wage', 'bytes', 'document_version'];
/** pg hands NUMERIC back as strings; the renderer and the mailer want numbers where a number is meant. */
export function numbers(row, cols = NUMERIC) {
  if (!row) return row;
  const out = { ...row };
  for (const c of cols) if (out[c] !== null && out[c] !== undefined && typeof out[c] === 'string' && out[c] !== '') out[c] = Number(out[c]);
  return out;
}

export async function pingDb() {
  try { return (await one('select 1 as ok'))?.ok === 1; } catch { return false; }
}
export const closeDb = () => pool.end().catch(() => {});

// ── task_queue ledger writes ──────────────────────────────────────────────────
export const markTask = (id, status, { error = null, jobId, at } = {}) =>
  query(`update task_queue set status = $2::queue_status, error_message = $3, job_id = coalesce($4, job_id),
                -- ck_task_attempts keeps attempts <= max_attempts, so never run past the ceiling
                attempts = least(attempts + (case when $2::queue_status = 'PROCESSING' then 1 else 0 end), max_attempts),
                processed_at = case when $2::queue_status = 'PROCESSING' and processed_at is null then now() else processed_at end,
                completed_at = case when $2::queue_status = 'COMPLETED' then coalesce($5::timestamptz, now()) else completed_at end,
                failed_at = case when $2::queue_status in ('FAILED','DEAD') then now() else failed_at end,
                updated_at = now()
         where id = $1::uuid returning id, status, attempts, max_attempts`,
  [id, status, error ? String(error).slice(0, 900) : null, jobId || null, at || null]).then((r) => r.rows[0] || null);

/** Failure policy: retry while attempts remain, otherwise mark DEAD so the reclaim sweep stops touching it. */
export async function failTask(id, error, jobId) {
  const t = await one(`select attempts, max_attempts from task_queue where id = $1::uuid`, [id]);
  const exhausted = !t || Number(t.attempts) + 1 >= Number(t.max_attempts || 3);
  const row = await markTask(id, exhausted ? 'DEAD' : 'FAILED', { error, jobId });
  return { ...row, retryable: !exhausted };
}
export const taskOf = (id) => one(`select * from task_queue where id = $1::uuid`, [id]);
export const staleTasks = ({ olderThanSec = 90, limit = 50 } = {}) =>
  rows(`select t.* from task_queue t
         where t.status in ('PENDING','PROCESSING') and t.scheduled_at < now() - ($1 || ' seconds')::interval
         order by t.priority desc, t.scheduled_at limit $2`, [olderThanSec, limit]);
export const counts = () => rows(`select status, count(*)::int as n from task_queue where created_at > now() - interval '7 days' group by status`);
