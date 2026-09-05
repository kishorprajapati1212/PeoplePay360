import { query } from '../db/pool.js';
import { mapKeys } from './sql.js';
import { params0 } from './_helpers.js';

/**
 * Everything the dashboard needs, in a handful of set-based queries (no N+1 loops from JS).
 * `filters` = { from, to, departmentId, employeeType } — the four dropdowns at the top of the mockup.
 */
function clauses(f, P) {
  const c = ['true'];
  if (f.from && f.to) c.push(`p.period_start <= ${P(f.to)} and p.period_end >= ${P(f.from)}`);
  if (f.departmentId) c.push(`e.department_id = ${P(f.departmentId)}`);
  if (f.employeeType) c.push(`e.employee_type = ${P(f.employeeType)}`);
  return c;
}
export async function salaryKpis(f) {
  const { params, P } = params0();
  const c = clauses(f, P);
  const { rows } = await query(`
    select coalesce(sum(p.net_amount),0) as net_paid,
           coalesce(sum(p.gross_amount),0) as gross_paid,
           coalesce(sum(p.total_deductions),0) as deductions,
           coalesce(sum(p.employer_cost),0) as employer_cost,
           count(*) as payslips,
           count(*) filter (where p.status = 'PAID') as paid,
           count(*) filter (where p.status in ('DRAFT','COMPUTED','VALIDATED')) as pending,
           count(distinct p.employee_id) as employees,
           count(distinct p.payrun_id) as payruns
    from payslips p join employees e on e.id = p.employee_id
    where ${c.join(' and ')} and p.status <> 'VOID'`, params);
  const x = mapKeys(rows[0], ['net_paid', 'gross_paid', 'deductions', 'employer_cost', 'payslips', 'paid', 'pending', 'employees', 'payruns']);
  const pp = params0();
  const pc = [`p.status = 'PAID'`, `p.period_end < ${pp.P(f.from || '1970-01-01')}`];
  if (f.departmentId) pc.push(`e.department_id = ${pp.P(f.departmentId)}`);
  if (f.employeeType) pc.push(`e.employee_type = ${pp.P(f.employeeType)}`);
  const prev = await query(`select coalesce(sum(p.net_amount),0) as net_paid from payslips p
      join employees e on e.id = p.employee_id where ${pc.join(' and ')}`, pp.params);
  const prevNet = Number(prev.rows[0]?.net_paid || 0);
  const net = Number(x.net_paid);
  return {
    ...x,
    avg_per_employee: x.employees ? +(net / x.employees).toFixed(2) : 0,
    prev_net_paid: prevNet,
    change_pct: prevNet > 0 ? +(((net - prevNet) / prevNet) * 100).toFixed(1) : null,
  };
}
export async function salaryByDepartment(f) {
  const { params, P } = params0();
  const c = clauses(f, P);
  const { rows } = await query(`
    select coalesce(d.name,'Unassigned') as department, count(distinct p.employee_id) as employees,
           coalesce(sum(p.gross_amount),0) as gross, coalesce(sum(p.net_amount),0) as net,
           coalesce(sum(p.total_deductions),0) as deductions, coalesce(sum(p.employer_cost),0) as employer_cost
    from payslips p join employees e on e.id = p.employee_id left join departments d on d.id = e.department_id
    where ${c.join(' and ')} and p.status <> 'VOID'
    group by 1 order by net desc`, params);
  return rows.map((r) => mapKeys(r, ['employees', 'gross', 'net', 'deductions', 'employer_cost']));
}
export async function netTrend({ months = 12, departmentId } = {}) {
  const { params, P } = params0();
  const clauses = [`p.month_anchor >= (date_trunc('month', current_date) - ($1 || ' months')::interval)::date`, `p.status = 'PAID'`];
  params.push(months);
  if (departmentId) clauses.push(`e.department_id = ${P(departmentId)}`);
  const { rows } = await query(`
    select to_char(date_trunc('month', p.month_anchor),'YYYY-MM') as month,
           coalesce(sum(p.net_amount),0) as net, coalesce(sum(p.gross_amount),0) as gross, count(*) as payslips
    from payslips p join employees e on e.id = p.employee_id
    where ${clauses.join(' and ')}
    group by 1 order by 1`, params);
  return rows.map((r) => mapKeys(r, ['net', 'gross', 'payslips']));
}
export const departmentOverview = () =>
  query(`select * from v_department_overview order by headcount desc, department`).then((r) =>
    r.rows.map((x) => mapKeys(x, ['headcount', 'monthly_wage_cost'])));
export async function payrunStatusPanel() {
  const { rows } = await query(`
    select r.id, r.name, r.period_key, r.status, r.employee_count, r.payslip_count, r.total_net, r.warning_count, r.error_count,
           r.paid_at, r.validated_at, r.sent_at, s.name as salary_structure,
           (select count(*) from payslips p where p.payrun_id = r.id and p.status = 'PAID') as paid_payslips,
           (select count(*) from payslips p where p.payrun_id = r.id and p.status <> 'PAID') as unpaid_payslips,
           (select count(*) from email_deliveries m where m.payrun_id = r.id and m.status = 'SENT') as emails_sent,
           (select count(*) from email_deliveries m where m.payrun_id = r.id and m.status in ('FAILED','BOUNCED')) as emails_failed
    from payruns r join salary_structures s on s.id = r.salary_structure_id
    where r.status <> 'VOID' order by r.period_start desc limit 12`);
  return rows.map((x) => mapKeys(x, ['employee_count', 'payslip_count', 'total_net', 'warning_count', 'error_count',
    'paid_payslips', 'unpaid_payslips', 'emails_sent', 'emails_failed']));
}
/** The "Payslip Status & Payroll Alerts" list in the mockup — every row is actionable. */
export async function payrollAlerts({ from, to }) {
  const { rows } = await query(`
    select 'MISSING_BANK' as code, count(*)::int as n,
           'employees missing a bank account' as label, 'employee' as entity
    from employees e where e.status = 'ACTIVE' and (e.bank_account_number is null or e.bank_account_number = '')
    union all select 'DRAFT_UNVALIDATED', count(*)::int, 'draft payruns still not validated', 'payrun'
    from payruns r where r.status = 'DRAFT'
    union all select 'COMPUTED_UNPAID', count(*)::int, 'computed payruns awaiting payment', 'payrun'
    from payruns r where r.status in ('COMPUTED','VALIDATED')
    union all select 'OVERLAPPING_PAYSLIPS', count(*)::int, 'employees with two payslips covering the same days', 'payslip'
    from (select p.employee_id, p.month_anchor from payslips p where p.status <> 'VOID'
            group by 1,2 having count(*) > 2) x
    union all select 'CONTRACT_EXPIRING', count(*)::int, 'contracts expiring this month', 'contract'
    from contracts c where c.end_date between date_trunc('month', current_date)::date and (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date
         and c.status = 'RUNNING'
    union all select 'NO_CONTRACT', count(*)::int, 'active employees without a contract in this period', 'employee'
    from employees e where e.status = 'ACTIVE'
      and not exists (select 1 from contracts c where c.employee_id = e.id and c.start_date <= $2 and (c.end_date is null or c.end_date >= $1))
    union all select 'UNPAID_LEAVE_STUCK', count(*)::int, 'time-off requests waiting more than 5 days', 'time_off_request'
    from time_off_requests r where r.status = 'TO_APPROVE' and r.created_at < now() - interval '5 days'
    union all select 'PDF_FAILED', count(*)::int, 'payslips where the failed job is still stuck', 'job'
    from task_queue t where t.status in ('FAILED','DEAD') and t.created_at > now() - interval '30 days'
    order by n desc`, [from, to]);
  return rows.map((x) => mapKeys(x, ['n']));
}
export async function attendanceOverview({ from, to, departmentId }) {
  const { params, P } = params0();
  const c = [`a.day between ${P(from)} and ${P(to)}`];
  if (departmentId) c.push(`e.department_id = ${P(departmentId)}`);
  const { rows } = await query(`
    select count(*)::int as records,
           count(*) filter (where a.status in ('PRESENT','LATE','OVERTIME','HALF_DAY'))::int as present,
           count(*) filter (where a.status = 'ABSENT')::int as absent,
           count(*) filter (where a.status = 'ON_LEAVE')::int as on_leave,
           count(*) filter (where a.status = 'HOLIDAY')::int as holiday,
           count(*) filter (where a.check_in is not null and a.check_out is null)::int as missing_checkout,
           count(*) filter (where a.overtime_hours > 0 and not a.overtime_approved) as ot_pending,
           coalesce(round(avg(a.worked_hours) filter (where a.worked_hours is not null), 2), 0) as avg_worked_hours,
           count(*) filter (where a.status = 'LATE')::int as late,
           (select count(*) from employees e2 where e2.status = 'ACTIVE' ${departmentId ? `and e2.department_id = $${params.length}` : ''}) as headcount,
           (select count(distinct a2.employee_id) from attendance a2 where a2.day between $1 and $2) as employees_with_records
    from attendance a join employees e on e.id = a.employee_id
    where ${c.join(' and ')}`, params);
  const x = mapKeys(rows[0], ['records', 'present', 'absent', 'on_leave', 'holiday', 'missing_checkout', 'ot_pending', 'avg_worked_hours', 'late', 'headcount', 'employees_with_records']);
  const expected = Math.max(1, (Number(x.headcount) || 1) * expectedWorkingDays(from, to));
  x.health_pct = +Math.min(100, ((Number(x.present) + Number(x.holiday)) / expected) * 100).toFixed(1);
  x.coverage_pct = x.headcount ? +((Number(x.employees_with_records) / Number(x.headcount)) * 100).toFixed(1) : 0;
  return x;
}
const expectedWorkingDays = (from, to) => {
  let n = 0;
  for (let d = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
};
export const monthlyAttendanceByEmployee = async ({ from, to, limit = 8 }) => {
  const { rows } = await query(`
    select e.id, e.name as employee, e.employee_code, d.name as department,
           coalesce(sum(a.worked_hours),0) as worked_hours, count(*) filter (where a.status = 'ABSENT')::int as absent,
           count(*) filter (where a.status = 'LATE')::int as late, coalesce(sum(a.overtime_hours) filter (where a.overtime_approved),0) as overtime_hours,
           expected_days(e.id, $1::date, $2::date) as expected_days
    from employees e
    join departments d on d.id = e.department_id
    left join attendance a on a.employee_id = e.id and a.day between $1 and $2
    where e.status = 'ACTIVE'
    group by e.id, e.name, e.employee_code, d.name
    order by worked_hours desc limit $3`, [from, to, limit]);
  return rows.map((r) => mapKeys(r, ['worked_hours', 'absent', 'late', 'overtime_hours', 'expected_days']));
};
