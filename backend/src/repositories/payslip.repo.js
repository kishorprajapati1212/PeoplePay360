import { query } from '../db/pool.js';
import { mapKeys } from './sql.js';
import { params0 } from './_helpers.js';

const SELECT = `select * from v_payslip_list p`;
const MONEY = ['gross_amount', 'total_deductions', 'total_adjustments', 'net_amount', 'ytd_net', 'worked_days', 'paid_days',
               'absent_days', 'leave_days', 'unpaid_leave_days', 'overtime_hours', 'expected_working_days', 'pro_rata_factor',
               'contract_wage', 'download_count', 'document_version'];
export const listPayslips = async (f = {}) => {
  const { params, P } = params0();
  const clauses = ['true'];
  if (f.employeeId) clauses.push(`p.employee_id = ${P(f.employeeId)}`);
  if (f.employeeIds?.length) clauses.push(`p.employee_id in (${f.employeeIds.map((x) => P(x)).join(',')})`);
  if (f.payrunId) clauses.push(`p.payrun_id = ${P(f.payrunId)}`);
  if (f.status) clauses.push(`p.status = ${P(f.status)}`);
  if (f.periodKey) clauses.push(`p.period_key = ${P(f.periodKey)}`);
  if (f.month) clauses.push(`to_char(p.period_start,'YYYY-MM') = ${P(f.month)}`);
  if (f.from) clauses.push(`p.period_end >= ${P(f.from)}`);
  if (f.to) clauses.push(`p.period_start <= ${P(f.to)}`);
  if (f.kinds?.length) clauses.push(`p.payslip_kind = any(${P(f.kinds)}::payslip_kind[])`);
  if (f.missingBank) clauses.push(`p.missing_bank`);
  if (f.search) { const p = P(`%${f.search}%`); clauses.push(`(p.employee ilike ${p} or p.employee_code ilike $${params.length})`); }
  const SORTABLE = { employee: 'p.employee', period: 'p.period_start', gross: 'p.gross_amount', net: 'p.net_amount', status: 'p.status' };
  const dir = String(f.dir).toLowerCase() === 'desc' ? 'desc' : 'asc';
  const order = SORTABLE[f.sort] ? `order by ${SORTABLE[f.sort]} ${dir}` : 'order by p.period_start desc, p.employee asc';
  const { rows } = await query(`select *, count(*) over () as total from (${SELECT} where ${clauses.join(' and ')}) p
    ${order} limit ${P(f.limit || 100)} offset ${P(f.offset || 0)}`, params);
  return { rows: rows.map((r) => mapKeys(r, MONEY)), total: Number(rows[0]?.total ?? 0) };
};
export const getPayslip = (id, q = query) => q(`${SELECT} where p.id = $1`, [id]).then((r) => r.rows[0] ? mapKeys(r.rows[0], MONEY) : null);
export const getPayslipRaw = (id, q = query) => q(`select * from payslips where id = $1`, [id]).then((r) => r.rows[0] || null);
export const createPayslip = (d, q = query) =>
  q(`insert into payslips (payrun_id, employee_id, contract_id, salary_structure_id, period_start, period_end, period_key,
                           payslip_kind, month_anchor, status, notes, reconciled_from)
     values ($1,$2,$3,$4,$5,$6,$7,coalesce($8,'MONTHLY')::payslip_kind,$9,coalesce($10,'DRAFT')::payslip_status,$11,$12) returning *`,
    [d.payrun_id, d.employee_id, d.contract_id || null, d.salary_structure_id || null, d.period_start, d.period_end, d.period_key,
     d.payslip_kind, d.month_anchor, d.status, d.notes || null, d.reconciled_from || null]).then((r) => r.rows[0]);
export const bulkPayslipStatus = (payrunId, status, q = query) =>
  q(`update payslips set status = $2::payslip_status,
           released_at = case when $2::text = 'PAID' and released_at is null then now() else released_at end,
           paid_at = case when $2::text = 'PAID' then now() else paid_at end
     where payrun_id = $1 and status <> 'VOID' returning id`, [payrunId, status]).then((r) => r.rows.map((x) => x.id));
/** Store the computed result: meta on the header, lines replaced wholesale (a recompute is a full refresh). */
export async function saveComputation(id, { meta = {}, totals, lines, documentVersion }, q = query) {
  await q(`update payslips set
             expected_working_days = $2, paid_days = $3, worked_days = $4, half_days = $5, leave_days = $6,
             unpaid_leave_days = $7, absent_days = $8, holiday_days = $9, worked_hours = $10, overtime_hours = $11,
             pro_rata_factor = $12, ytd_gross = $13, ytd_deductions = $14, ytd_net = $15, computation_summary = $16,
             document_version = coalesce($17, document_version), status = coalesce($18::payslip_status, status),
             gross_amount = $19, total_deductions = $20, total_adjustments = $21, net_amount = $22, employer_cost = $23
           where id = $1 returning *`,
    [id, meta.expected_working_days ?? 0, meta.paid_days ?? 0, meta.worked_days ?? 0, meta.half_days ?? 0,
     meta.leave_days ?? 0, meta.unpaid_leave_days ?? 0, meta.absent_days ?? 0, meta.holiday_days ?? 0,
     meta.worked_hours ?? 0, meta.overtime_hours ?? 0, meta.pro_rata_factor ?? 1,
     meta.ytd_gross ?? 0, meta.ytd_deductions ?? 0, meta.ytd_net ?? 0, JSON.stringify(meta.computation_summary || {}),
     documentVersion ?? null, meta.status ?? null,
     (totals.gross / 100).toFixed(2), (totals.deductions / 100).toFixed(2), (totals.adjustments / 100).toFixed(2),
     (totals.net / 100).toFixed(2), (totals.employerCost ?? 0) / 100]);
  await q(`delete from payslip_lines where payslip_id = $1`, [id]);
  for (const l of lines) {
    await q(`insert into payslip_lines (payslip_id, salary_rule_id, rule_code, rule_name, category, line_kind, sequence,
                                        amount, quantity, base_amount, is_hidden, computation_log, ref_payslip_id)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, l.rule_id || null, l.rule_code, l.rule_name, l.category, l.line_kind, l.sequence, (l.amount / 100).toFixed(2),
       l.quantity ?? null, l.base_amount != null ? (l.base_amount / 100).toFixed(2) : null, !!l.is_hidden, l.computation_log || null, l.ref_payslip_id || null]);
  }
  return getPayslip(id, q);
}
export const linesOf = (payslipId, q = query) =>
  q(`select l.*, r.id is not null as has_rule from payslip_lines l left join salary_rules r on r.id = l.salary_rule_id
     where l.payslip_id = $1 order by l.sequence, l.rule_code`, [payslipId]).then((r) => r.rows.map((x) => mapKeys(x, ['amount', 'quantity', 'base_amount'])));
export const addLine = (payslipId, l, q = query) =>
  q(`insert into payslip_lines (payslip_id, salary_rule_id, rule_code, rule_name, category, line_kind, sequence, amount, quantity, base_amount, is_hidden, computation_log, ref_payslip_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (payslip_id, sequence) do update set amount = excluded.amount, rule_code = excluded.rule_code, rule_name = excluded.rule_name,
       category = excluded.category, line_kind = excluded.line_kind, computation_log = excluded.computation_log
     returning *`,
    [payslipId, l.salary_rule_id || null, l.rule_code, l.rule_name, l.category, l.line_kind, l.sequence,
     Math.abs(Number(l.amount)).toFixed(2), l.quantity ?? null, l.base_amount ?? null, !!l.is_hidden, l.computation_log || null, l.ref_payslip_id || null]);
export const updateLine = (lineId, patch, q = query) =>
  q(`update payslip_lines set ${Object.keys(patch).map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning *`,
    [lineId, ...Object.values(patch)]).then((r) => r.rows[0]);
export const nextSequence = (payslipId, q = query) =>
  q(`select coalesce(max(sequence),0) + 10 as n from payslip_lines where payslip_id = $1`, [payslipId]).then((r) => Number(r.rows[0].n));
export const listInputs = (payslipId, q = query) =>
  q(`select i.*, u.name as created_by_name from payslip_inputs i left join users u on u.id = i.created_by
     where i.payslip_id = $1 order by i.code`, [payslipId]).then((r) => r.rows.map((x) => mapKeys(x, ['amount'])));
export const upsertInput = (payslipId, i, q = query) =>
  q(`insert into payslip_inputs (payslip_id, code, name, amount, reason, created_by) values ($1,$2,$3,$4,$5,$6)
     on conflict (payslip_id, code) do update set amount = excluded.amount, reason = excluded.reason, created_by = excluded.created_by, name = excluded.name
     returning *`, [payslipId, i.code, i.name, Number(i.amount).toFixed(2), i.reason || null, i.created_by || null]);
export const deleteInput = (payslipId, code, q = query) => q(`delete from payslip_inputs where payslip_id = $1 and code = $2 returning *`, [payslipId, code]);
// ── arrears ledger (carried into the next run) ────────────────────────────────
export const pendingArrears = (employeeId, beforeMonth, q = query) =>
  q(`select * from payslip_arrears where employee_id = $1 and month_anchor < $2 and status = 'CARRIED' order by month_anchor, created_at`,
    [employeeId, beforeMonth]).then((r) => r.rows.map((x) => mapKeys(x, ['amount'])));
export const markArrearsApplied = (ids, q = query) =>
  q(`update payslip_arrears set status = 'APPLIED', applied_at = now() where id = any($1::uuid[]) returning id`, [ids]).then((r) => r.rowCount);
// ── documents + downloads (the audit trail for "did the employee get it?") ─────
export const saveDocument = (payslipId, d, q = query) =>
  q(`insert into payslip_documents (payslip_id, kind, version, storage_path, bytes, sha256, renderer)
     values ($1::uuid,coalesce($2::text,'PAYSLIP')::document_kind,$3::int,$4::text,$5::int,$6::text,coalesce($7::text,'pdfkit'))
     on conflict (payslip_id, kind, version) do update set storage_path = excluded.storage_path, bytes = excluded.bytes,
       sha256 = excluded.sha256, renderer = excluded.renderer, generated_at = now()
     returning *`, [payslipId, d.kind, d.version, d.storage_path, d.bytes, d.sha256, d.renderer]);
export const latestDocument = (payslipId, { kind = 'PAYSLIP', version } = {}, q = query) =>
  q(`select * from payslip_documents where payslip_id = $1 and kind = $2::document_kind ${version ? 'and version = $3' : ''}
     order by version desc limit 1`, version ? [payslipId, kind, version] : [payslipId, kind]).then((r) => r.rows[0] || null);
export const documentHistory = (payslipId, q = query) =>
  q(`select d.*, (select count(*) from payslip_downloads x where x.payslip_id = d.payslip_id and x.version = d.version) as downloads
     from payslip_documents d where d.payslip_id = $1 and d.kind = 'PAYSLIP' order by d.version desc`, [payslipId]);
export const noteDownload = (payslipId, { user, role, via, ip, userAgent, version, sha256 }, q = query) =>
  q(`with x as (insert into payslip_downloads (payslip_id, actor_user, actor_role, via, ip, user_agent, version, sha256)
                values ($1,$2,$3::user_role,$4,$5,$6,$7,$8) returning 1)
      update payslips set last_download_at = now(), download_count = download_count + 1 where id = $1`,
    [payslipId, user || null, role || null, via || 'PORTAL', ip || null, (userAgent || '').slice(0, 300), version || 1, sha256 || null]);
export const downloadHistory = (payslipId, q = query) =>
  q(`select d.*, u.name as actor_name from payslip_downloads d left join users u on u.id = d.actor_user
     where d.payslip_id = $1 order by d.created_at desc limit 50`, [payslipId]);
/** Payslips whose period overlaps the given dates — the wizard warns before creating a duplicate. */
export const overlapping = (employeeIds, from, to, q = query) =>
  q(`select p.id, p.period_key, p.employee_id, e.name as employee, p.status, p.payrun_id, r.name as payrun
     from payslips p join employees e on e.id = p.employee_id join payruns r on r.id = p.payrun_id
     where p.employee_id = any($1::uuid[]) and p.status <> 'VOID' and p.period_start <= $3 and p.period_end >= $2
     order by e.name`, [employeeIds, from, to]).then((r) => r.rows);
/**
 * Everything the engine needs to know about what was ALREADY paid: month totals (for the true-up of a
 * second half), fiscal-year sums (for annual caps) and per-rule sums (for MONTH/MONTH_ONCE caps).
 * Two queries on purpose — aggregating per-rule amounts inside one big join fans rows out and lies.
 */
export async function priorTotals(employeeId, { monthAnchor, fyFrom, fyTo, excludePayslipId, monthKey }, q = query) {
  const head = await q(`select
      coalesce(sum(p.gross_amount) filter (where p.month_anchor = $2 and p.id is distinct from $5::uuid and p.status <> 'VOID'), 0) as month_gross,
      coalesce(sum(p.net_amount)    filter (where p.month_anchor = $2 and p.id is distinct from $5::uuid and p.status <> 'VOID'), 0) as month_net,
      coalesce(sum(p.net_amount)    filter (where p.month_anchor = $2 and p.period_key = $6 || '-H1' and p.id is distinct from $5::uuid), 0) as h1_net,
      coalesce(sum(p.gross_amount) filter (where p.period_start >= $3 and p.period_end <= $4 and p.status <> 'VOID'), 0) as ytd_gross,
      coalesce(sum(p.total_deductions) filter (where p.period_start >= $3 and p.period_end <= $4 and p.status <> 'VOID'), 0) as ytd_deductions,
      coalesce(sum(p.net_amount) filter (where p.period_start >= $3 and p.period_end <= $4 and p.status <> 'VOID'), 0) as ytd_net
    from payslips p where p.employee_id = $1 and (p.month_anchor = $2 or (p.period_start >= $3 and p.period_end <= $4))`,
    [employeeId, monthAnchor, fyFrom, fyTo, excludePayslipId || null, monthKey]);
  const signed = `(case when l.line_kind = 'DEDUCTION' then -l.amount else l.amount end)`;
  const perRule = await q(`select l.rule_code,
      coalesce(sum(${signed}) filter (where p.month_anchor = $2 and p.id is distinct from $5::uuid), 0) as month_amount,
      coalesce(sum(${signed}) filter (where p.period_start >= $3 and p.period_end <= $4), 0) as fy_amount,
      coalesce(sum(l.amount) filter (where p.month_anchor = $2 and p.id is distinct from $5::uuid), 0) as month_magnitude,
      coalesce(sum(l.amount) filter (where p.period_start >= $3 and p.period_end <= $4), 0) as fy_magnitude
    from payslips p join payslip_lines l on l.payslip_id = p.id
    where p.employee_id = $1 and p.status <> 'VOID' and l.line_kind <> 'REPORT'
      and (p.month_anchor = $2 or (p.period_start >= $3 and p.period_end <= $4))
    group by 1`, [employeeId, monthAnchor, fyFrom, fyTo, excludePayslipId || null]);
  const x = head.rows[0] || {};
  const f = (v) => Math.round((Number(v) || 0) * 100);
  const by_rule_month = {}; const by_rule_fy = {};
  for (const r of perRule.rows) { by_rule_month[r.rule_code] = f(r.month_magnitude); by_rule_fy[r.rule_code] = f(r.fy_magnitude); }
  return {
    month_gross: f(x.month_gross), month_net: f(x.month_net), h1_net: f(x.h1_net),
    ytd_gross: f(x.ytd_gross), ytd_deductions: f(x.ytd_deductions), ytd_net: f(x.ytd_net),
    ytd_pt: by_rule_fy.PT || 0, ytd_basic: by_rule_fy.BASIC || 0, ytd_pf: by_rule_fy.PF || 0,
    ytd_esi: by_rule_fy.ESI || 0, ytd_bonus: by_rule_fy.PERB || 0,
    by_rule_month, by_rule_fy, month_codes: Object.entries(by_rule_month).filter(([, v]) => v > 0).map(([k]) => k),
  };
}
/** Actual stored lines of the sibling half (what was really paid, including manual edits). */
export const siblingHalf = (employeeId, { monthKey, excludePayslipId }, q = query) =>
  q(`select p.id, p.period_key, p.net_amount, p.status, coalesce(jsonb_object_agg(l.rule_code, l.amount) filter (where l.line_kind <> 'REPORT'), '{}'::jsonb) as by_code,
             coalesce(jsonb_object_agg(l.rule_code, l.line_kind), '{}'::jsonb) as kinds
     from payslips p left join payslip_lines l on l.payslip_id = p.id
     where p.employee_id = $1 and p.period_key = $2 and p.status <> 'VOID' and p.id is distinct from $3::uuid
     group by p.id`, [employeeId, `${monthKey}-H1`, excludePayslipId || null])
    .then((r) => r.rows[0] ? { id: r.rows[0].id, period_key: r.rows[0].period_key, netPaise: f0(r.rows[0].net_amount),
                               status: r.rows[0].status, byCode: Object.fromEntries(Object.entries(r.rows[0].by_code || {}).map(([k, v]) => [k, f0(v)])) } : null);
const f0 = (v) => Math.round((Number(v) || 0) * 100);
