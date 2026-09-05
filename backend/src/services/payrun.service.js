import { AppError, toIso, periodKey, monthAnchor, eachDay, fromPaise, inferKind } from '../lib/shared/index.js';
import * as repo from '../repositories/payrun.repo.js';
import * as payslipRepo from '../repositories/payslip.repo.js';
import * as employeeRepo from '../repositories/employee.repo.js';
import * as salaryRepo from '../repositories/salary.repo.js';
import * as companyRepo from '../repositories/company.repo.js';
import * as deliveryRepo from '../repositories/delivery.repo.js';
import { transaction } from '../db/tx.js';
import { query } from '../db/pool.js';
import { computeOne, computeStructureFor } from './payroll.compute.js';
import { schedule } from '../queue/queues.js';
import { QUEUES } from '../queue/queues.js';
import { logger } from '../logger.js';

const FLOW = { DRAFT: 'COMPUTED', COMPUTED: 'VALIDATED', VALIDATED: 'PAID' };
/** Wizard step 1 → step 2: the candidate table, with duplicate-period warnings already computed. */
export async function preview({ salary_structure_id, period_start, period_end, pay_frequency, compute_mode, search, department_id, employee_type, page = 1, page_size = 25 }) {
  const structure = await salaryRepo.getStructure(salary_structure_id);
  if (!structure) throw AppError.badRequest('Choose a Pay Structure first', { code: 'STRUCTURE_REQUIRED' });
  if (!Number(structure.rules)) throw new AppError('STRUCTURE_EMPTY', `“${structure.name}” has no rules — add salary rules before running payroll`, { status: 422 });
  const from = toIso(period_start), to = toIso(period_end || period_start);
  if (to < from) throw AppError.badRequest('Period end must be on or after the period start', { code: 'DATE_RANGE' });
  const key = periodKey(from, to, pay_frequency);
  const size = Math.min(200, Math.max(1, Number(page_size) || 25));
  const cand = await employeeRepo.candidatesForPeriod({ periodStart: from, periodEnd: to, structureId: salary_structure_id, search,
    departmentId: department_id, employeeType: employee_type, limit: size, offset: (Math.max(1, Number(page)) - 1) * size });
  const ids = cand.rows.map((r) => r.id);
  const dupes = ids.length ? await payslipRepo.overlapping(ids, from, to) : [];
  const dupeBy = new Map(dupes.map((d) => [d.employee_id, d]));
  const existing = await repo.findPayrun({ periodKey: key, structureId: salary_structure_id });
  return {
    period: { from, to, key, label: `${toIso(from)} → ${toIso(to)}`, pay_frequency: pay_frequency || 'MONTHLY', compute_mode: compute_mode || 'PRO_RATA' },
    structure: { id: structure.id, name: structure.name, rules: Number(structure.rules) },
    employees: cand.rows.map((r) => ({ ...r, duplicate: dupeBy.get(r.id) || null,
      expected_days: r.expected_days, worked_hours: Number(r.worked_hours), wages: Number(r.wage) })),
    total: cand.total, page: Number(page), page_size: size,
    pages: Math.max(1, Math.ceil(cand.total / size)),
    existing_payrun: existing ? { id: existing.id, name: existing.name, status: existing.status } : null,
    note: existing ? 'A payrun already exists for this period and structure — creating again will be refused.' : null,
  };
}
/**
 * The payrun is created HERE (after the selection), never on "Continue" — the mockup is explicit about
 * that, and a half-created payrun is what people delete by accident later.
 */
export async function create({ name, salary_structure_id, period_start, period_end, pay_frequency, compute_mode, employee_ids, notes, idempotency_key }, { auth }) {
  if (!Array.isArray(employee_ids) || !employee_ids.length) throw AppError.badRequest('Select at least one employee record', { code: 'EMPLOYEES_REQUIRED' });
  const from = toIso(period_start), to = toIso(period_end || period_start);
  const key = periodKey(from, to, pay_frequency);
  const kind = inferKind(from, to, pay_frequency);
  const structure = await salaryRepo.getStructure(salary_structure_id);
  if (!structure) throw AppError.badRequest('Unknown salary structure', { code: 'STRUCTURE_REQUIRED' });
  const title = name?.trim() || defaultName(from, to, pay_frequency, structure.name);
  return transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    const run = await repo.createPayrun({ name: title, period_key: key, salary_structure_id, period_start: from, period_end: to,
      pay_frequency: pay_frequency || 'MONTHLY', compute_mode: compute_mode || 'PRO_RATA', employee_count: employee_ids.length,
      idempotency_key, notes, created_by: auth.userId, status: 'DRAFT' }, q);
    await repo.addPayrunEmployees(run.id, employee_ids, q);
    const created = [];
    for (const employeeId of employee_ids) {
      const contract = await employeeRepo.activeForPeriod({ employeeId, from, to });
      const slip = await payslipRepo.createPayslip({ payrun_id: run.id, employee_id: employeeId, contract_id: contract?.id || null,
        salary_structure_id: contract?.salary_structure_id || salary_structure_id, period_start: from, period_end: to, period_key: perEmployeeKey(key, employee_ids, employeeId),
        payslip_kind: kind, month_anchor: monthAnchor(from), status: 'DRAFT' }, q);
      created.push(slip.id);
    }
    await q(`select recalc_payrun_totals($1)`, [run.id]);
    logger.info({ run: run.id, payslips: created.length, by: auth.userId }, 'payrun created');
    return repo.getPayrun(run.id, q);
  }).catch((e) => {
    if (e?.code === 'DUPLICATE' || /uq_payruns/.test(e?.message || '')) {
      throw new AppError('PAYRUN_EXISTS', `A payrun for “${title}” already exists for this structure and period`, { status: 409 });
    }
    throw e;
  });
}
const perEmployeeKey = (base) => base;
const defaultName = (from, to, freq, structureName) => {
  const d = new Date(`${toIso(from)}T00:00:00Z`);
  const month = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC', year: 'numeric' });
  if (freq === 'HALF_MONTH_FIRST') return `${month} — First Half`;
  if (freq === 'HALF_MONTH_SECOND') return `${month} — Second Half`;
  if (freq === 'BI_MONTHLY') return `${month} (bi-monthly)`;
  return month;
};
export const read = async (id) => {
  const run = await repo.getPayrun(id);
  if (!run) throw AppError.notFound('Payrun not found');
  const [rows, emails, tasks] = await Promise.all([repo.payrunEmployees(id), deliveryRepo.listEmailsForPayrun(id), deliveryRepo.recentTasks({ payrunId: id, limit: 40 })]);
  return { ...run, employees: rows, email_summary: emails, tasks, actions: nextActions(run) };
};
const nextActions = (run) => ({
  can_compute: ['DRAFT', 'COMPUTED'].includes(run.status),
  can_validate: run.status === 'COMPUTED' && Number(run.error_count) === 0,
  can_mark_paid: run.status === 'VALIDATED',
  can_send: run.status === 'PAID',
  can_void: run.status !== 'PAID',
  can_edit_lines: ['DRAFT', 'COMPUTED'].includes(run.status),
  next: FLOW[run.status] || null,
});
/** Batch compute. One employee's failure marks only their row ERROR; the run still finishes. */
export async function compute(id, { auth, only = null } = {}) {
  const run = await repo.getPayrun(id);
  if (!run) throw AppError.notFound('Payrun not found');
  if (['PAID', 'VOID'].includes(run.status)) throw new AppError('LOCKED', `A ${run.status.toLowerCase()} payrun cannot be recomputed`, { status: 409 });
  const { company } = await loadContext(run);
  const employees = await repo.payrunEmployees(id);
  const targets = only?.length ? employees.filter((e) => only.includes(e.employee_id)) : employees;
  const results = [];
  for (const row of targets) {
    try {
      if (!row.payslip_id && !row.contract_id) {
        throw AppError.unprocessable(`No contract covers this period for ${row.employee}`, { code: 'NO_CONTRACT', employee: row.employee_code });
      }
      const payslipId = row.payslip_id || (await payslipRepo.createPayslip({ payrun_id: id, employee_id: row.employee_id, contract_id: row.contract_id,
        salary_structure_id: run.salary_structure_id, period_start: run.period_start, period_end: run.period_end,
        period_key: periodKey(toIso(run.period_start), toIso(run.period_end), run.pay_frequency), payslip_kind: inferKind(toIso(run.period_start), toIso(run.period_end), run.pay_frequency),
        month_anchor: monthAnchor(toIso(run.period_start)), status: 'DRAFT' })).id;
      const out = await transaction(async (client) => {
        const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
        const { structure, rules, ptSlabs } = await computeStructureFor(run.salary_structure_id, { at: run.period_start });
        const slip = await payslipRepo.getPayslipRaw(payslipId, q);
        if (!slip) throw AppError.notFound('Payslip row disappeared while computing');
        return computeOne({ payslip: slip, payrun: run, company, structure, rules, ptSlabs, q, actorUserId: auth?.userId });
      });
      results.push({ employee_id: row.employee_id, employee: row.employee, ok: true, net: out.totals.net, gross: out.totals.gross,
                     warnings: out.warnings.length, errors: out.warnings.filter((w) => w.severity === 'ERROR').length });
      await query(`update payrun_employees set compute_status = 'OK', error_code = null, error_message = null, payslip_id = $3
                   where payrun_id = $1 and employee_id = $2`, [id, row.employee_id, out.payslipId]);
    } catch (e) {
      results.push({ employee_id: row.employee_id, employee: row.employee, ok: false, error: e.message, code: e.code || 'COMPUTE_FAILED' });
      await query(`update payrun_employees set compute_status = 'ERROR', error_code = $3, error_message = $4 where payrun_id = $1 and employee_id = $2`,
        [id, row.employee_id, e.code || 'COMPUTE_FAILED', String(e.message).slice(0, 500)]).catch(() => {});
      logger.warn({ run: id, employee: row.employee_id, err: e.message }, 'payslip compute failed');
    }
  }
  // DRAFT → COMPUTED as soon as anything was computed: the run shows its warnings/errors, and
  // VALIDATE (not COMPUTE) is the gate that refuses to move on while error_count > 0.
  if (results.some((r) => r.ok)) await query(`update payruns set status = 'COMPUTED', computed_at = now() where id = $1 and status = 'DRAFT'`, [id]);
  await refreshTotals(id);
  const updated = await repo.getPayrun(id);
  return { payrun: updated, results, computed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, ...nextActions(updated) };
}
async function loadContext(run) {
  const company = await companyRepo.getCompany();
  return { company, structure: await salaryRepo.getStructure(run.salary_structure_id) };
}
async function refreshTotals(id) {
  await query(`select recalc_payrun_totals($1)`, [id]);
  await query(`update payruns set
      warning_count = (select count(*) from payslips p where p.payrun_id = $1 and p.status <> 'VOID'
                       and jsonb_array_length(coalesce(p.computation_summary -> 'warnings', '[]'::jsonb)) > 0),
      error_count = (select count(*) from payslips p where p.payrun_id = $1 and p.status <> 'VOID'
                     and exists (select 1 from jsonb_array_elements(coalesce(p.computation_summary -> 'warnings', '[]'::jsonb)) w
                                 where w ->> 'severity' = 'ERROR'))
    where id = $1`, [id]);
  return repo.getPayrun(id);
}
const transition = async (id, from, to, { auth, stamp } = {}) => {
  const run = await repo.getPayrun(id);
  if (!run) throw AppError.notFound('Payrun not found');
  if (run.status !== from) throw new AppError('WRONG_STATE', `This action needs the payrun to be ${from.toLowerCase()}, but it is ${run.status.toLowerCase()}`, { status: 409, details: { status: run.status, needs: from } });
  return transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    await client.query(`select id from payruns where id = $1 for update`, [id]);
    await repo.updatePayrunStatus(id, to, { by: auth?.userId }, q);
    await payslipRepo.bulkPayslipStatus(id, to === 'PAID' ? 'PAID' : to, q);
    const updated = await repo.getPayrun(id, q);
    return { payrun: updated, ...nextActions(updated) };
  });
};
export const validate = (id, ctx) => transition(id, 'COMPUTED', 'VALIDATED', ctx);
export const markPaid = async (id, { auth, releaseDocuments = true }) => {
  const out = await transition(id, 'VALIDATED', 'PAID', { auth });
  await query(`update payslips set released_at = now(), paid_at = now() where payrun_id = $1 and status = 'PAID'`, [id]);
  if (releaseDocuments) await queuePdfs(id, { auth, reason: 'on-paid' });
  return { ...out, note: 'Payslips are now locked. Corrections go through an arrear, not an edit.' };
};
export async function voidPayrun(id, { auth }) {
  const run = await repo.getPayrun(id);
  if (!run) throw AppError.notFound('Payrun not found');
  if (run.status === 'PAID') throw new AppError('LOCKED', 'A paid payrun stays as history — raise an arrear against it instead', { status: 409 });
  const sent = await query(`select count(*) as n from email_deliveries where payrun_id = $1 and status = 'SENT'`, [id]).then((r) => Number(r.rows[0].n));
  if (sent) throw new AppError('ALREADY_SENT', `${sent} payslip email(s) already went out; voiding would confuse people`, { status: 409, details: { sent } });
  await transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    await q(`update payslips set status = 'VOID' where payrun_id = $1`, [id]);
    await q(`update task_queue set status = 'CANCELLED' where payrun_id = $1 and status in ('PENDING','PROCESSING')`, [id]);
    await repo.voidPayrun(id, q);
  });
  return repo.getPayrun(id);
}
/** PDF generation is queued, never inline: 60 slips × puppeteer would blow the request timeout. */
export async function queuePdfs(id, { auth, reason = 'manual' } = {}) {
  const run = await repo.getPayrun(id);
  if (!run) throw AppError.notFound('Payrun not found');
  const slips = await query(`select p.id, p.document_version, p.employee_id, e.name from payslips p join employees e on e.id = p.employee_id
                             where p.payrun_id = $1 and p.status <> 'VOID' order by e.name`, [id]).then((r) => r.rows);
  const enqueued = [];
  for (const s of slips) {
    const dedupe = `pdf:${s.id}:v${s.document_version}:${reason}`;
    const task = await deliveryRepo.enqueueTask({ task_type: 'GENERATE_PDF', entity_type: 'PAYSLIP', entity_id: s.id, payrun_id: id,
      dedupe_key: dedupe, queue_name: QUEUES.pdf, payload: { payslip_id: s.id, version: s.document_version, requested_by: auth?.userId || null, reason } });
    await schedule(QUEUES.pdf, 'payslip-pdf', { taskId: task.id, payslipId: s.id, version: s.document_version }, { dedupeKey: dedupe });
    enqueued.push({ payslip_id: s.id, employee: s.name, task_id: task.id, status: task.status });
  }
  return { payrun: id, queued: enqueued.length, reason, jobs: enqueued, worker: 'payslip-pdf' };
}
export async function sendPayslips(id, { auth, ccHr = false, force = false }) {
  const run = await repo.getPayrun(id);
  if (!run) throw AppError.notFound('Payrun not found');
  if (run.status !== 'PAID') throw new AppError('NOT_PAID', 'Mark the payrun as Paid before releasing payslips to employees', { status: 409 });
  const rows = await deliveryRepo.emailRowsFor(id, { onlyPending: !force });
  if (!rows.length) return { payrun: id, queued: 0, note: force ? 'No payslips to send' : 'Every payslip in this run was already sent' };
  const company = await companyRepo.getCompany();
  const missingPdf = rows.filter((r) => !r.storage_path);
  const queued = [];
  for (const r of rows) {
    const dedupe = `mail:${r.payslip_id}:v${r.document_version}`;
    const task = await deliveryRepo.enqueueTask({ task_type: 'SEND_EMAIL', entity_type: 'PAYSLIP', entity_id: r.payslip_id, payrun_id: id,
      dedupe_key: dedupe, queue_name: QUEUES.email,
      payload: { payslipId: r.payslip_id, to: r.work_email, employee: r.employee, period: r.period_key, net: r.net_amount,
                 pdfPath: r.storage_path, sha256: r.sha256, version: r.document_version, subject: null, ccHr,
                 from: company?.mail_from, template: company?.payslip_footer ? { footer: company.payslip_footer } : null } });
    await deliveryRepo.queueEmail({ payslip_id: r.payslip_id, payrun_id: id, document_version: r.document_version, recipient: r.work_email,
      employee_name: r.employee, subject: `Payslip ${r.period_key}`, status: 'QUEUED' });
    await schedule(QUEUES.email, 'payslip-email', { taskId: task.id, payslipId: r.payslip_id, version: r.document_version }, { dedupeKey: dedupe });
    queued.push({ payslip_id: r.payslip_id, employee: r.employee, task_id: task.id });
  }
  await repo.setSent(id, auth.userId);
  return { payrun: id, queued: queued.length, skipped_missing_pdf: missingPdf.length, jobs: queued, driver_note: 'Delivered by the worker through Redis' };
}
export const emailLedger = (id) => deliveryRepo.emailLedger({ payrunId: id, limit: 500 });
export const tasks = (id) => deliveryRepo.recentTasks({ payrunId: id, limit: 200 });
export const warnings = (id) => repo.payrunWarningRows(id);
/** Salary register CSV — the file finance uploads to the bank. */
export async function exportCsv(id) {
  const run = await repo.getPayrun(id);
  if (!run) throw AppError.notFound('Payrun not found');
  const rows = await query(`
    select e.employee_code, e.name as employee, coalesce(d.name, '—') as department, e.job_position as designation, e.bank_account_number, e.bank_ifsc, e.bank_name,
           p.period_key, p.status,
           coalesce(max(case when l.rule_code = 'BASIC' then l.amount end), 0) as basic,
           -- a rule flagged "not in reports" stays off the finance file; the payslip itself still shows it
           coalesce(sum(l.amount) filter (where l.line_kind = 'EARNING' and coalesce(r.appears_in_report, true)), 0) as gross,
           coalesce(sum(l.amount) filter (where l.line_kind = 'DEDUCTION' and coalesce(r.appears_in_report, true)), 0) as deductions,
           p.net_amount, p.worked_days, p.overtime_hours, p.pro_rata_factor
    from payslips p
    join employees e on e.id = p.employee_id
    left join departments d on d.id = e.department_id
    left join payslip_lines l on l.payslip_id = p.id
    left join salary_rules r on r.id = l.salary_rule_id
    where p.payrun_id = $1 and p.status <> 'VOID'
    group by e.employee_code, e.name, d.name, e.job_position, e.bank_account_number, e.bank_ifsc, e.bank_name,
             p.period_key, p.status, p.net_amount, p.worked_days, p.overtime_hours, p.pro_rata_factor
    order by e.name`, [id]);
  const header = ['employee_code', 'employee', 'department', 'designation', 'bank_account_number', 'bank_ifsc', 'bank_name', 'period', 'status',
                  'basic', 'gross', 'deductions', 'net', 'worked_days', 'overtime_hours', 'pro_rata_factor'];
  const csv = [header.join(',')].concat(rows.rows.map((r) => header.map((h) => csvCell(r[h])).join(','))).join('\n');
  return { name: `${slug(run.name)}-salary-register.csv`, csv, rows: rows.rows.length, totals: { net: run.total_net, gross: run.total_gross, deductions: run.total_deductions } };
}
export const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const list = (f) => repo.listPayruns(f);
export const remove = async (id) => {
  const done = await repo.deletePayrun(id);
  if (!done) throw new AppError('CANNOT_DELETE', 'Only a DRAFT or COMPUTED payrun can be deleted (paid runs stay as history)', { status: 409 });
  return { ok: true, id };
};
