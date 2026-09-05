import { query } from '../db/pool.js';
import { mapKeys, like } from './sql.js';
import { params0 } from './_helpers.js';

const SELECT = `select * from v_payrun_summary r`;
export const listPayruns = async (f = {}) => {
  const { params, P } = params0();
  const clauses = ['true'];
  if (f.year) clauses.push(`extract(year from r.period_start) = ${P(Number(f.year))}`);
  if (f.month) clauses.push(`to_char(r.period_start,'YYYY-MM') = ${P(f.month)}`);
  if (f.status) clauses.push(`r.status = ${P(f.status)}`);
  if (f.structureId) clauses.push(`exists (select 1 from payruns p2 where p2.id = r.id and p2.salary_structure_id = ${P(f.structureId)})`);
  if (f.search) { const p = P(`%${f.search}%`); clauses.push(`(r.name ilike ${p})`); }
  const { rows } = await query(`select *, count(*) over () as total from (${SELECT} where ${clauses.join(' and ')}) x
    order by x.period_start desc, x.name asc limit ${P(f.limit || 100)} offset ${P(f.offset || 0)}`, params);
  return { rows: rows.map((r) => mapKeys(r, ['total_gross', 'total_deductions', 'total_net', 'employer_cost', 'employee_count', 'payslip_count', 'warning_count', 'error_count', 'emails_sent', 'emails_failed'])),
           total: Number(rows[0]?.total ?? 0) };
};
export const getPayrun = (id, q = query) => q(`${SELECT} where r.id = $1`, [id]).then((r) => mapKeys(r.rows[0],
  ['total_gross', 'total_deductions', 'total_net', 'employer_cost', 'employee_count', 'payslip_count', 'warning_count', 'error_count']));
export const findPayrun = ({ periodKey, structureId }) =>
  query(`${SELECT} where r.period_key = $1 and exists (select 1 from payruns p where p.id = r.id and p.salary_structure_id = $2)`, [periodKey, structureId]).then((r) => r.rows[0] || null);
export const createPayrun = (d, q = query) =>
  q(`insert into payruns (name, period_key, salary_structure_id, period_start, period_end, month_anchor, pay_frequency, compute_mode,
                          employee_type_filter, department_filter, status, employee_count, idempotency_key, notes, created_by)
     values ($1,$2,$3,$4,$5,date_trunc('month', $4::date)::date,$6,coalesce($7,'PRO_RATA')::compute_mode,$8,$9,coalesce($10,'DRAFT')::payrun_status,$11,$12,$13,$14)
     returning *`,
    [d.name, d.period_key, d.salary_structure_id, d.period_start, d.period_end, d.pay_frequency || 'MONTHLY', d.compute_mode,
     d.employee_type_filter || null, d.department_filter || null, d.status, d.employee_count || 0, d.idempotency_key || null,
     d.notes || null, d.created_by]).then((r) => r.rows[0]);
const STAMP = {
  DRAFT: 'computed_at = null',
  COMPUTED: 'computed_at = now()',
  VALIDATED: 'validated_at = now(), validated_by = $3',
  PAID: 'paid_at = now(), paid_by = $3, locked_at = now()',
  VOID: 'locked_at = now()',
};
export const updatePayrunStatus = (id, status, { by } = {}, q = query) =>
  q(`update payruns set status = $1, ${STAMP[status] || 'updated_at = now()'} where id = $2 returning *`,
    [status, id, by || null]).then((r) => r.rows[0]);
export const setSent = (id, by, q = query) => q(`update payruns set sent_at = now(), sent_by = $2 where id = $1 returning *`, [id, by]);
/** Wizard step 2 selection, persisted only when the payrun is created. */
export const addPayrunEmployees = (payrunId, employeeIds, q = query) =>
  q(`insert into payrun_employees (payrun_id, employee_id, is_selected) select $1, unnest($2::uuid[]), true on conflict (payrun_id, employee_id) do nothing`, [payrunId, employeeIds]);
export const payrunEmployees = (payrunId) =>
  query(`select pe.*, e.name as employee, e.employee_code, d.name as department, c.wage, c.id as contract_id,
                p.id as payslip_id, p.status as payslip_status, p.net_amount, p.gross_amount, p.total_deductions,
                p.expected_working_days, p.paid_days, p.overtime_hours, p.worked_hours, p.payslip_kind
         from payrun_employees pe
         join employees e on e.id = pe.employee_id
         join payruns r on r.id = pe.payrun_id
         left join departments d on d.id = e.department_id
         left join lateral (select cc.id, cc.wage from contracts cc
                            where cc.employee_id = e.id and cc.status <> 'DRAFT'
                              and cc.start_date <= r.period_end and (cc.end_date is null or cc.end_date >= r.period_start)
                            order by cc.is_primary desc nulls last, cc.start_date desc limit 1) c on true
         left join payslips p on p.payrun_id = pe.payrun_id and p.employee_id = pe.employee_id
         where pe.payrun_id = $1 order by e.name`, [payrunId]).then((r) => r.rows.map((x) => mapKeys(x,
           ['wage', 'net_amount', 'gross_amount', 'total_deductions', 'overtime_hours', 'worked_hours'])));
export const deletePayrun = (id, q = query) =>
  q(`delete from payruns where id = $1 and status in ('DRAFT','COMPUTED') returning name`, [id]).then((r) => r.rows[0] || null);
export const voidPayrun = (id, q = query) =>
  q(`update payruns set status = 'VOID' where id = $1 and status <> 'PAID' returning *`, [id]).then((r) => r.rows[0] || null);
export const payrunWarningRows = (id) =>
  query(`select p.id as payslip_id, e.name as employee, e.employee_code, l.rule_code, l.computation_log
         from payslips p join payslip_lines l on l.payslip_id = p.id
         join employees e on e.id = p.employee_id
         where p.payrun_id = $1 and l.computation_log ilike 'ERROR%' order by e.name`, [id]).then((r) => r.rows);
