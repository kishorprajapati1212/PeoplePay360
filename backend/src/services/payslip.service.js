import { AppError, toIso, periodKey, monthAnchor, inferKind, fromPaise, toPaise, rupeesInWords } from '../lib/shared/index.js';
import * as repo from '../repositories/payslip.repo.js';
import * as payrunRepo from '../repositories/payrun.repo.js';
import * as employeeRepo from '../repositories/employee.repo.js';
import * as companyRepo from '../repositories/company.repo.js';
import * as salaryRepo from '../repositories/salary.repo.js';
import * as deliveryRepo from '../repositories/delivery.repo.js';
import { computeOne, computeStructureFor } from './payroll.compute.js';
import { renderPayslipPdf } from '../lib/pdf/index.js';
import { transaction } from '../db/tx.js';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

/** Employees may only ever read their own slip; HR sees everything in the run. */
function assertVisible(payslip, auth) {
  if (!auth) throw AppError.unauthorized();
  if (auth.scope === 'company') return;
  if (String(auth.employeeId) !== String(payslip.employee_id)) throw AppError.forbidden('This payslip belongs to another employee');
}
export const list = async (f, { auth }) => {
  if (auth.scope !== 'company' && !f.employeeId) f = { ...f, employeeId: auth.employeeId };
  if (auth.scope !== 'company' && f.employeeId && String(f.employeeId) !== String(auth.employeeId)) throw AppError.forbidden('Not your payslip');
  return repo.listPayslips(f);
};
export async function read(id, { auth, withLines = true } = {}) {
  const p = await repo.getPayslip(id);
  if (!p) throw AppError.notFound('Payslip not found');
  assertVisible(p, auth);
  const out = { ...p };
  if (withLines) {
    const [lines, inputs, arrears, docs, downloads] = await Promise.all([
      repo.linesOf(id), repo.listInputs(id), repo.pendingArrears(p.employee_id, '9999-01-01'),
      repo.documentHistory(id), auth.scope === 'company' ? repo.downloadHistory(id) : Promise.resolve([]),
    ]);
    Object.assign(out, { lines, inputs, arrears: arrears.filter((a) => a.status === 'CARRIED'), documents: docs.rows || docs, downloads });
  }
  return out;
}
export async function recompute(id, { auth }) {
  const p = await repo.getPayslipRaw(id);
  if (!p) throw AppError.notFound('Payslip not found');
  if (p.status === 'PAID') throw new AppError('LOCKED', 'A paid payslip cannot be recomputed — raise an arrear instead', { status: 409 });
  const run = await payrunRepo.getPayrun(p.payrun_id);
  if (['PAID', 'VOID'].includes(run.status)) throw new AppError('LOCKED', `The payrun is ${run.status.toLowerCase()}`, { status: 409 });
  const company = await companyRepo.getCompany();
  const { structure, rules, ptSlabs } = await computeStructureFor(run.salary_structure_id, { at: run.period_start });
  const out = await transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    return computeOne({ payslip: await repo.getPayslipRaw(id, q), payrun: run, company, structure, rules, ptSlabs, q, actorUserId: auth?.userId });
  });
  await query(`update payslips set status = 'COMPUTED' where id = $1 and status = 'DRAFT'`, [id]);
  await query(`select recalc_payrun_totals($1)`, [p.payrun_id]);
  return { payslip: await repo.getPayslip(id), ...out, note: 'Stored totals are always derived from the lines' };
}
/** HR edits a line (manual bonus, loan recovery). Allowed only while the slip is not PAID. */
export async function editLines(id, { lines = [], replace = false }, { auth }) {
  const p = await repo.getPayslipRaw(id);
  if (!p) throw AppError.notFound('Payslip not found');
  if (p.status === 'PAID') throw new AppError('LOCKED', 'A paid payslip is immutable; use an arrear to correct it', { status: 409 });
  return transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    if (replace) await q(`delete from payslip_lines where payslip_id = $1 and rule_code not in (select code from salary_rules where statutory)`, [id]);
    for (const l of lines) {
      if (l.id) { await repo.updateLine(l.id, { amount: Math.abs(Number(l.amount)).toFixed(2), computation_log: l.computation_log || 'edited by HR', is_hidden: !!l.is_hidden }, q); continue; }
      const seq = l.sequence ?? await repo.nextSequence(id, q);
      await repo.addLine(id, { rule_code: l.rule_code || 'MANUAL', rule_name: l.rule_name || 'Manual Adjustment',
        category: l.category || (l.line_kind === 'DEDUCTION' ? 'DEDUCTION' : 'ALLOWANCE'), line_kind: l.line_kind || 'EARNING',
        sequence: seq, amount: toPaise(l.amount), computation_log: l.computation_log || `entered by ${auth.name || 'HR'}` }, q);
    }
    await q(`select recalc_payslip_totals($1)`, [id]);
    await q(`update payslips set status = 'COMPUTED', document_version = document_version where id = $1 and status = 'DRAFT'`, [id]);
    await q(`select recalc_payrun_totals($1)`, [p.payrun_id]);
    return read(id, { auth, withLines: true });
  });
}
export async function setInputs(id, inputs, { auth }) {
  const p = await repo.getPayslipRaw(id);
  if (!p) throw AppError.notFound('Payslip not found');
  if (p.status === 'PAID') throw new AppError('LOCKED', 'A paid payslip cannot take new inputs', { status: 409 });
  const rows = Array.isArray(inputs) ? inputs : inputs?.rows || [];
  for (const i of rows) await repo.upsertInput(id, { ...i, created_by: auth.userId });
  if (Array.isArray(inputs?.remove) && inputs.remove.length) for (const code of inputs.remove) await repo.deleteInput(id, code);
  return { payslip: await repo.getPayslip(id), inputs: await repo.listInputs(id), note: 'Recompute the payslip to fold these into the numbers' };
}
/**
 * A correction for a PAID (locked) period: the money moves into a new ARREAR payslip in the next open
 * run, and the original stays untouched. That is how you keep an audit trail.
 */
export async function raiseArrear(sourceId, { amount, reason, target_payrun_id, rule_code = 'ARREAR' }, { auth }) {
  const source = await repo.getPayslipRaw(sourceId);
  if (!source) throw AppError.notFound('Payslip not found');
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) throw AppError.badRequest('Arrear amount must be a non-zero number');
  if (!reason) throw AppError.badRequest('Say why — the arrear line prints on the payslip', { code: 'REASON_REQUIRED' });
  let target = target_payrun_id;
  if (!target) {
    target = await query(`select id from payruns where status in ('DRAFT','COMPUTED','VALIDATED') order by period_start desc limit 1`).then((r) => r.rows[0]?.id);
  }
  if (!target) throw new AppError('NO_OPEN_PAYRUN', 'Open a payrun for the current period before raising an arrear', { status: 409 });
  const targetRun = await payrunRepo.getPayrun(target);
  return transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    const arrear = (await q(`insert into payslip_arrears (employee_id, month_anchor, rule_code, amount, reason, from_payslip, status)
      values ($1,$2,$3,$4,$5,$6,'CARRIED') returning *`, [source.employee_id, source.month_anchor, rule_code, value.toFixed(2), reason, sourceId])).rows[0];
    const from = toIso(targetRun.period_start), to = toIso(targetRun.period_end);
    const key = periodKey(from, to, targetRun.pay_frequency);
    const existing = await q(`select id from payslips where payrun_id = $1 and employee_id = $2`, [target, source.employee_id]).then((r) => r.rows[0]);
    let slipId = existing?.id;
    if (!slipId) {
      const contract = await employeeRepo.activeForPeriod({ employeeId: source.employee_id, from, to });
      const slip = await repo.createPayslip({ payrun_id: target, employee_id: source.employee_id, contract_id: contract?.id || null,
        salary_structure_id: contract?.salary_structure_id || targetRun.salary_structure_id, period_start: from, period_end: to,
        period_key: key, payslip_kind: 'ARREAR', month_anchor: monthAnchor(from), status: 'DRAFT', reconciled_from: sourceId }, q);
      slipId = slip.id;
      await q(`insert into payrun_employees (payrun_id, employee_id) values ($1,$2) on conflict do nothing`, [target, source.employee_id]);
    }
    await repo.upsertInput(slipId, { code: 'ARREAR', name: 'Arrears', amount: value, reason, created_by: auth.userId }, q);
    await q(`update payslips set notes = coalesce(notes || ' | ', '') || $2 where id = $1`,
      [sourceId, `arrear ₹${fromPaise(Math.abs(toPaise(value)))} raised for ${targetRun.name}: ${reason}`]);
    await q(`select recalc_payrun_totals($1)`, [target]);
    return { arrear, payslip_id: slipId, payrun: { id: target, name: targetRun.name, status: targetRun.status },
             note: 'Compute the target payrun to fold the arrear into the payslip' };
  });
}
// ── PDF: render, persist, stream ──────────────────────────────────────────────
async function pdfPayload(id, { version } = {}) {
  const p = await repo.getPayslip(id);
  if (!p) throw AppError.notFound('Payslip not found');
  const [lines, company, employee] = await Promise.all([repo.linesOf(id), companyRepo.getCompany(), employeeRepo.getEmployee(p.employee_id)]);
  return { p, lines, company, employee };
}
export async function renderPdf(id, { auth, persist = false, version } = {}) {
  const { p, lines, company, employee } = await pdfPayload(id, { version });
  assertVisible(p, auth);
  const rendered = await renderPayslipPdf({
    payslip: { ...p, period_label: `${p.period_start} to ${p.period_end}`, kind_label: p.payslip_kind?.replace('_', ' ') },
    employee: { ...employee, ...p }, company,
    lines: lines.map((l) => ({ ...l, amount: Number(l.amount) })),
    totals: { gross: Number(p.gross_amount), deductions: Number(p.total_deductions), adjustments: Number(p.total_adjustments), net: Number(p.net_amount),
              taxable: Number(p.computation_summary?.taxableGross ?? 0) },
    meta: { ...(p.computation_summary ? { computation_summary: p.computation_summary } : {}), expected_working_days: p.expected_working_days,
            paid_days: p.paid_days, unpaid_leave_days: p.unpaid_leave_days, overtime_hours: Number(p.overtime_hours),
            worked_hours: Number(p.worked_hours), pro_rata_factor: Number(p.pro_rata_factor) },
    amountInWords: rupeesInWords(p.net_amount),
  });
  if (!persist) return { ...rendered, fileName: `payslip-${p.employee_code}-${p.period_key}-preview.pdf` };
  const dir = join(config.pdf.dir, p.period_key || 'unknown');
  await mkdir(dir, { recursive: true });
  const key = `payslip-${p.employee_code}-${p.period_key}-v${p.document_version}.pdf`;
  const path = join(dir, key);
  await writeFile(path, rendered.buffer);
  await repo.saveDocument(id, { version: p.document_version, storage_path: path, bytes: rendered.bytes, sha256: rendered.sha256, renderer: config.pdf.renderer });
  await query(`update payslips set pdf_hash = $2, pdf_generated_at = now(), notes = coalesce(notes,'') where id = $1`, [id, rendered.sha256]);
  return { ...rendered, path, key, fileName: key, payslip_id: id };
}
/**
 * Serves the stored PDF (or renders on demand if it is missing) and records the download: who, when,
 * which version, which hash. Payslips are personal; this is the trail that proves delivery.
 */
export async function downloadPdf(id, { auth, via = 'PORTAL', version, req }) {
  const p = await repo.getPayslip(id);
  if (!p) throw AppError.notFound('Payslip not found');
  assertVisible(p, auth);
  let doc = await repo.latestDocument(id, { version });
  if (!doc || doc.version !== p.document_version) {
    const rendered = await renderPdf(id, { auth, persist: true });
    doc = { storage_path: rendered.path, sha256: rendered.sha256, version: p.document_version };
  }
  const { readFile, stat } = await import('node:fs/promises');
  let buf;
  try { buf = await readFile(doc.storage_path); }
  catch { const rendered = await renderPdf(id, { auth, persist: true }); buf = rendered.buffer; doc = { storage_path: rendered.path, sha256: rendered.sha256, version: p.document_version }; }
  await repo.noteDownload(id, { user: auth.userId, role: (auth.roles || [])[0], via, ip: req?.headers['x-forwarded-for']?.split(',')[0]?.trim() || req?.ip,
                                 userAgent: req?.headers['user-agent'], version: doc.version, sha256: doc.sha256 });
  return { buffer: buf, fileName: `payslip-${p.employee_code}-${p.period_key}-v${doc.version}.pdf`, sha256: doc.sha256, version: doc.version, bytes: buf.length };
}
export const history = (id) => repo.documentHistory(id);
export const downloads = (id) => repo.downloadHistory(id);
export async function zipPayslips(payrunId, { auth }) {
  const run = await payrunRepo.getPayrun(payrunId);
  if (!run) throw AppError.notFound('Payrun not found');
  const slips = await query(`select p.id, e.employee_code from payslips p join employees e on e.id = p.employee_id
                             where p.payrun_id = $1 and p.status <> 'VOID' order by e.name`, [payrunId]).then((r) => r.rows);
  const { makeZip } = await import('../lib/pdf/index.js');
  const entries = [];
  for (const s of slips) {
    const { buffer } = await downloadPdf(s.id, { auth, via: 'ZIP' });
    entries.push({ name: `payslip-${s.employee_code}-${run.period_key}.pdf`, data: buffer });
  }
  return { buffer: makeZip(entries), fileName: `payslips-${run.period_key}.zip`, count: entries.length };
}
