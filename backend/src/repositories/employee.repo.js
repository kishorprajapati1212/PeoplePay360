import { query } from '../db/pool.js';
import { page, mapKeys, like } from './sql.js';

const NUM = ['basic_salary', 'contract_wage', 'total_weekly_hours', 'wage'];

export async function listEmployees(f = {}) {
  const params = [];
  const P = (v) => { params.push(v); return `$${params.length}`; };
  const clauses = ['true'];
  if (f.search) {
    const p = P(`%${f.search}%`);
    clauses.push(`(to_tsvector('simple', coalesce(e.name,'') || ' ' || e.employee_code || ' ' || coalesce(e.work_email,''))
                  @@ plainto_tsquery('simple', ${p}) or e.name ilike ${p} or e.employee_code ilike ${p} or coalesce(e.department,'') ilike ${p})`);
  }
  if (f.departmentId) clauses.push(`e.department_id = ${P(f.departmentId)}`);
  if (f.status) clauses.push(`e.status = ${P(f.status)}`);
  if (f.employeeType) clauses.push(`e.employee_type = ${P(f.employeeType)}`);
  if (f.userRole) clauses.push(`e.user_role = ${P(f.userRole)}`);
  if (f.missingBank) clauses.push(`e.missing_bank`);
  if (f.missingSchedule) clauses.push(`e.missing_schedule`);
  if (f.hasUser === true) clauses.push(`e.user_id is not null`);
  if (f.hasUser === false) clauses.push(`e.user_id is null`);
  if (f.ids?.length) clauses.push(`e.id in (${f.ids.map((x) => P(x)).join(',')})`);
  const { limit, offset } = page(f);
  const SORTABLE = { name: 'e.name', employee_code: 'e.employee_code', department: 'e.department', date_of_joining: 'e.date_of_joining', status: 'e.status', wage: 'e.contract_wage' };
  const dir = String(f.dir).toLowerCase() === 'desc' ? 'desc' : 'asc';
  const sort = SORTABLE[String(f.sort || '').toLowerCase()] ? `order by ${SORTABLE[f.sort.toLowerCase()]} ${dir} nulls last, e.name asc` : 'order by e.name asc';
  const { rows } = await query(`
    select *, count(*) over () as total
    from v_employee_directory e
    where ${clauses.join(' and ')}
    ${sort}
    limit ${P(limit)} offset ${P(offset)}`, params);
  const total = Number(rows[0]?.total ?? 0);
  return { rows: rows.map((r) => mapKeys(r, NUM)), total, limit, offset, pages: Math.max(1, Math.ceil(total / limit)) };
}
export const getEmployee = (id, q = query) => q(`select * from v_employee_directory where id = $1`, [id]).then((r) => mapKeys(r.rows[0], NUM));
export const getEmployeeRaw = (id, q = query) => q(`select * from employees where id = $1`, [id]).then((r) => r.rows[0] || null);
export async function employeeSummary(id) {
  const { rows } = await query(`select
      (select count(*) from contracts c where c.employee_id = $1) as contracts,
      (select count(*) from contracts c where c.employee_id = $1 and c.status = 'RUNNING') as running_contracts,
      (select count(*) from attendance a where a.employee_id = $1 and a.day >= date_trunc('month', current_date)::date) as attendance,
      (select count(*) from attendance a where a.employee_id = $1 and a.day = current_date::date) as attendance_today,
      (select count(*) from time_off_requests t where t.employee_id = $1 and t.status in ('DRAFT','TO_APPROVE','APPROVED')) as time_off,
      (select count(*) from time_off_requests t where t.employee_id = $1 and t.status = 'TO_APPROVE') as time_off_pending,
      (select count(*) from payslips p where p.employee_id = $1) as payslips,
      (select count(*) from payslips p where p.employee_id = $1 and p.status = 'PAID') as payslips_paid,
      (select count(*) from payslips p where p.employee_id = $1 and p.period_start <= current_date and p.period_end >= current_date) as payslips_current,
      (select coalesce(sum(a.remaining_days),0) from time_off_allocations a
         where a.employee_id = $1 and a.status = 'APPROVED' and a.valid_from <= current_date and a.valid_until >= current_date) as leave_balance,
      (select json_agg(json_build_object('type_id', b.type_id, 'type', b.type, 'allocated', b.allocated_days, 'taken', b.taken_days,
                                          'pending', b.pending_days, 'remaining', b.remaining_days, 'windows', b.windows))
         from (select t.id as type_id, t.name as type, sum(a.allocated_days) as allocated_days, sum(a.taken_days) as taken_days,
                      sum(a.pending_days) as pending_days, sum(a.remaining_days) as remaining_days, count(*) as windows
                 from time_off_allocations a join time_off_types t on t.id = a.time_off_type_id
                where a.employee_id = $1 and a.status = 'APPROVED'
                group by t.id, t.name order by t.name) b) as balances`, [id]);
  return rows[0];
}
const EMP_COLS = `employee_code, name, work_email, phone, gender, date_of_birth, address, city, state, pincode, work_location,
                  department_id, manager_id, job_position, employee_type, working_schedule_id, date_of_joining, status,
                  employment_tag, basic_salary, bank_account_number, bank_ifsc, bank_name, pan_number, uan_number, esi_number, notes`;
const bind = (e, start = 1) => e.split(',').map((_, i) => `$${start + i}`).join(', ');
export async function createEmployee(data, q = query) {
  const cols = EMP_COLS.split(', ').filter((c) => data[c] !== undefined);
  const vals = cols.map((c) => data[c]);
  const sql = `insert into employees (${cols.join(', ')}) values (${vals.map((_, i) => `$${i + 1}`).join(', ')}) returning *`;
  const { rows } = await q(sql, vals);
  return rows[0];
}
export async function updateEmployee(id, patch, q = query) {
  const cols = Object.keys(patch).filter((k) => EMP_COLS.includes(k));
  if (!cols.length) return getEmployeeRaw(id);
  const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const { rows } = await q(`update employees set ${sets} where id = $${cols.length + 1} returning *`, [...cols.map((c) => patch[c]), id]);
  return rows[0];
}
export const setEmployeeStatus = (id, status, { date_of_exit } = {}, q = query) =>
  q(`update employees set status = $2, date_of_exit = coalesce($3, date_of_exit) where id = $1 returning *`, [id, status, date_of_exit || null]).then((r) => r.rows[0]);
export const nextEmployeeCode = () => query(`select 'EMP' || lpad(nextval('employee_code_seq')::text, 4, '0') as code`).then((r) => r.rows[0].code);
export const emailTaken = (email, exceptId) =>
  query(`select 1 from employees where lower(work_email) = lower($1) and ($2::uuid is null or id <> $2) and status <> 'TERMINATED' limit 1`, [email, exceptId || null]).then((r) => r.rowCount > 0);
/** Employees for the payrun wizard table: worked hours + wages for the chosen period, pre-filtered. */
export async function candidatesForPeriod({ periodStart, periodEnd, structureId, search, departmentId, employeeType, employeeIds, limit = 200, offset = 0 }) {
  const params = [periodStart, periodEnd, limit, offset];
  const P = (v) => { params.push(v); return `$${params.length}`; };
  const clauses = [`e.status = 'ACTIVE'`, `c.status <> 'DRAFT'`];
  if (structureId) clauses.push(`c.salary_structure_id = ${P(structureId)}`);
  if (departmentId) clauses.push(`e.department_id = ${P(departmentId)}`);
  if (employeeType) clauses.push(`e.employee_type = ${P(employeeType)}`);
  if (search) clauses.push(`(e.name ilike ${P(like(search))} or e.employee_code ilike $${params.length})`);
  if (employeeIds?.length) clauses.push(`e.id in (${employeeIds.map((id) => P(id)).join(',')})`);
  const { rows } = await query(`
    with base as (
      select e.id, e.employee_code, e.name, e.date_of_joining, e.date_of_exit, e.work_email, d.name as department,
             e.bank_account_number, e.working_schedule_id, c.id as contract_id, c.wage, c.start_date as contract_start,
             s.id as structure_id, s.name as structure_name,
             coalesce(c.working_schedule_id, e.working_schedule_id) as schedule_id
      from employees e
      join contracts c on c.employee_id = e.id and c.start_date <= $2 and (c.end_date is null or c.end_date >= $1)
      left join departments d on d.id = e.department_id
      left join salary_structures s on s.id = c.salary_structure_id
      where ${clauses.join(' and ')}
    ), att as (
      select a.employee_id,
             coalesce(sum(a.worked_hours), 0) as worked_hours,
             coalesce(sum(a.overtime_hours) filter (where a.overtime_approved), 0) as overtime_hours,
             count(*) filter (where a.status in ('PRESENT','LATE','OVERTIME','HALF_DAY')) as present_days,
             count(*) filter (where a.status = 'ABSENT') as absent_days,
             count(*) filter (where a.check_in is not null and a.check_out is null) as missing_checkout
      from attendance a
      where a.day between $1 and $2
      group by 1
    )
    select b.*, coalesce(a.worked_hours, 0) as worked_hours, coalesce(a.overtime_hours, 0) as overtime_hours,
           coalesce(a.present_days, 0) as present_days, coalesce(a.absent_days, 0) as absent_days,
           coalesce(a.missing_checkout, 0) as missing_checkout,
           expected_days(b.id, $1, $2) as expected_days,
           (b.bank_account_number is null or b.bank_account_number = '') as missing_bank,
           (b.working_schedule_id is null and b.schedule_id is null) as missing_schedule,
           count(*) over () as total
    from base b
    left join att a on a.employee_id = b.id
    order by b.name asc
    limit $3 offset $4`, params);
  return { rows: rows.map((r) => mapKeys(r, ['wage', 'worked_hours', 'overtime_hours', 'expected_days', 'present_days', 'absent_days'])), total: Number(rows[0]?.total ?? 0) };
}
export const activeForPeriod = ({ employeeId, from, to }) =>
  query(`select c.* from contracts c where c.employee_id = $1 and c.status <> 'DRAFT' and c.start_date <= $2 and (c.end_date is null or c.end_date >= $3)
         order by c.is_primary desc nulls last, c.start_date desc, c.id desc limit 1`, [employeeId, to, from]).then((r) => r.rows[0] || null);
