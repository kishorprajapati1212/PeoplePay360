import { query } from '../db/pool.js';
import { config } from '../config.js';
import { mapKeys } from './sql.js';
import { params0 } from './_helpers.js';

/**
 * task_queue is the durable ledger; BullMQ is the executor. Enqueue writes here first (dedupe_key makes a
 * retry idempotent), the worker flips the row, and a stalled job is re-pushed from Postgres.
 */
export const enqueueTask = async ({ task_type, entity_type, entity_id, payrun_id, dedupe_key, queue_name, payload = {}, priority = 0, scheduled_at }, q = query) => {
  const { rows } = await q(`insert into task_queue (task_type, entity_type, entity_id, payrun_id, dedupe_key, queue_name, payload, priority, scheduled_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9, now()))
        on conflict (dedupe_key) do update set payload = excluded.payload, status = 'PENDING', attempts = 0, error_message = null,
                                     processed_at = null, completed_at = null, failed_at = null, updated_at = now()
        returning *`,
    [task_type, entity_type, entity_id, payrun_id || null, dedupe_key, queue_name, JSON.stringify(payload), priority, scheduled_at || null]);
  // Wake the worker now instead of waiting for its sweep; harmless if nothing is listening.
  if (rows[0]) q(`select pg_notify('task.ready', $1::text)`, [`${queue_name}:${rows[0].id}`]).catch(() => {});
  return rows[0];
};
export const markTask = (id, status, { error, jobId, attempts } = {}, q = query) =>
  // $2 arrives as one text parameter but is used both as the enum assignment (status) and in text
  // comparisons — without the ::text cast on every use Postgres refuses the query with "inconsistent
  // types deduced for parameter $2" (enum vs text), which used to kill the inline invite send.
  q(`update task_queue set status = $2::queue_status, error_message = $3, job_id = coalesce($4, job_id),
           attempts = coalesce($5, attempts + case when $2::text = 'PROCESSING' then 1 else 0 end),
           processed_at = case when $2::text = 'PROCESSING' and processed_at is null then now() else processed_at end,
           completed_at = case when $2::text = 'COMPLETED' then now() else completed_at end,
           failed_at = case when $2::text in ('FAILED','DEAD') then now() else failed_at end,
           updated_at = now()
     where id = $1 returning *`, [id, status, error || null, jobId || null, attempts ?? null]).then((r) => r.rows[0]);
export const taskOf = (idOrDedupe, q = query) =>
  q(`select * from task_queue where dedupe_key = $1::text or id::text = $1::text`, [idOrDedupe]).then((r) => r.rows[0] || null);
export const pendingTasks = ({ limit = 20, olderThanSec = 120 } = {}, q = query) =>
  q(`select * from task_queue where status in ('PENDING','PROCESSING') and scheduled_at < now() - ($2 || ' seconds')::interval
     order by priority desc, scheduled_at limit $1`, [limit, olderThanSec]).then((r) => r.rows);
export const taskStats = () =>
  query(`select status, count(*) as n from task_queue where created_at > now() - interval '7 days' group by status`).then((r) =>
    Object.fromEntries(r.rows.map((x) => [x.status, Number(x.n)])));
export const recentTasks = ({ payrunId, limit = 50 } = {}) =>
  query(`select id, task_type, entity_type, entity_id, status, attempts, max_attempts, error_message, scheduled_at, completed_at, queue_name, job_id
         from task_queue ${payrunId ? 'where payrun_id = $1' : 'where true'} order by created_at desc limit ${Number(limit) || 50}`,
    payrunId ? [payrunId] : []).then((r) => r.rows);
// ── email ledger ──────────────────────────────────────────────────────────────
export const queueEmail = (e, q = query) =>
  q(`insert into email_deliveries (payslip_id, payrun_id, document_version, recipient, employee_name, subject, status, preview_url)
     values ($1,$2,$3,$4,$5,$6,coalesce($7::text,'QUEUED')::delivery_status,$8)
     on conflict (payslip_id, document_version) do update set status = 'QUEUED', error = null, recipient = excluded.recipient,
       subject = excluded.subject, queued_at = now()
     returning *`,
    [e.payslip_id, e.payrun_id || null, e.document_version || 1, e.recipient, e.employee_name || null, e.subject, e.status, e.preview_url || null]);
export const emailRowsFor = (payrunId, { onlyPending = true, documentVersion } = {}) =>
  query(`select p.id as payslip_id, p.document_version, p.email_status, e.work_email, e.name as employee, p.period_key, p.net_amount,
                r.name as payrun, d.storage_path, d.sha256, d.version
         from payslips p
         join employees e on e.id = p.employee_id
         join payruns r on r.id = p.payrun_id
         left join lateral (select * from payslip_documents x where x.payslip_id = p.id and x.kind = 'PAYSLIP'
                            order by x.version desc limit 1) d on true
         where p.payrun_id = $1 and p.status in ('PAID','VALIDATED')
           ${onlyPending ? `and (p.email_status <> 'SENT' ${documentVersion ? `or p.document_version > ${Number(documentVersion)}` : ''})` : ''}
           and e.work_email is not null
         order by e.name`, [payrunId]).then((r) => r.rows.map((x) => mapKeys(x, ['net_amount'])));
export const emailLedger = ({ payrunId, limit = 200 } = {}) =>
  query(`select m.*, p.period_key, e.name as employee from email_deliveries m
         join payslips p on p.id = m.payslip_id join employees e on e.id = p.employee_id
         ${payrunId ? 'where m.payrun_id = $1' : 'where true'} order by m.queued_at desc limit ${Number(limit)}`,
    payrunId ? [payrunId] : []).then((r) => r.rows);
export const listEmailsForPayrun = (payrunId) =>
  query(`select status, count(*) as n from email_deliveries where payrun_id = $1 group by status`, [payrunId])
    .then((r) => Object.fromEntries(r.rows.map((x) => [x.status, Number(x.n)])));
