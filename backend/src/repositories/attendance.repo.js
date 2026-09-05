import { query } from '../db/pool.js';
import { mapKeys, like } from './sql.js';
import { params0 } from './_helpers.js';

const COLS = ['employee_id', 'day', 'check_in', 'check_out', 'worked_hours', 'net_worked_hours', 'break_minutes',
              'expected_hours', 'overtime_hours', 'status', 'is_manual', 'manual_reason', 'overtime_approved', 'source'];
const SELECT = `select a.*, e.name as employee, e.employee_code, e.work_email, d.name as department,
                       m.name as manager, h.day as holiday_name
                from attendance a
                join employees e on e.id = a.employee_id
                left join departments d on d.id = e.department_id
                left join employees m on m.id = e.manager_id
                left join holidays h on h.day = a.day`;
export const listAttendance = async (f = {}) => {
  const { params, P } = params0();
  const clauses = ['true'];
  if (f.from && f.to) clauses.push(`a.day between ${P(f.from)} and ${P(f.to)}`);
  else if (f.month) clauses.push(`to_char(a.day,'YYYY-MM') = ${P(f.month)}`);
  else if (f.day) clauses.push(`a.day = ${P(f.day)}`);
  else clauses.push(`a.day >= date_trunc('month', current_date)::date`);
  if (f.employeeId) clauses.push(`a.employee_id = ${P(f.employeeId)}`);
  if (f.employeeIds?.length) clauses.push(`a.employee_id in (${f.employeeIds.map((x) => P(x)).join(',')})`);
  if (f.status) clauses.push(`a.status = ${P(f.status)}`);
  if (f.departmentId) clauses.push(`e.department_id = ${P(f.departmentId)}`);
  if (f.search) clauses.push(`(e.name ilike ${P(`%${f.search}%`)} or e.employee_code ilike $${params.length})`);
  if (f.onlyExceptions) clauses.push(`(a.check_in is not null and a.check_out is null) or (a.overtime_hours > 0 and not a.overtime_approved) or a.status = 'ABSENT'`);
  const { rows } = await query(`select *, count(*) over () as total from (${SELECT} where ${clauses.join(' and ')}) x
    order by x.day desc nulls last, x.employee asc limit ${P(f.limit || 300)} offset ${P(f.offset || 0)}`, params);
  return { rows: rows.map((r) => mapKeys(r, ['worked_hours', 'net_worked_hours', 'overtime_hours', 'expected_hours', 'break_minutes'])),
           total: Number(rows[0]?.total ?? 0) };
};
export const getAttendance = (id) =>
  query(`${SELECT} where a.id = $1`, [id]).then((r) => mapKeys(r.rows[0], ['worked_hours', 'net_worked_hours', 'overtime_hours', 'expected_hours']));
export const byEmployeeDay = (employeeId, day, q = query) =>
  q(`select * from attendance where employee_id = $1 and day = $2`, [employeeId, day]).then((r) => r.rows[0] || null);
export const rowsForPeriod = (employeeId, from, to, q = query) =>
  q(`select * from attendance where employee_id = $1 and day between $2 and $3 order by day`, [employeeId, from, to]).then((r) => r.rows);
export const createAttendance = (d, q = query) =>
  q(`insert into attendance (${COLS.filter((c) => d[c] !== undefined).join(', ')})
     values (${COLS.filter((c) => d[c] !== undefined).map((_, i) => `$${i + 1}`).join(', ')})
     on conflict (employee_id, day) do update set ${COLS.filter((c) => c !== 'employee_id' && c !== 'day' && d[c] !== undefined).map((c) => `${c} = excluded.${c}`).join(', ')}
     returning *`, COLS.filter((c) => d[c] !== undefined).map((c) => d[c])).then((r) => r.rows[0]);
export const updateAttendance = (id, p, q = query) => {
  const keys = COLS.filter((k) => p[k] !== undefined);
  if (!keys.length) return getAttendance(id);
  const vals = keys.map((k) => p[k]);
  return q(`update attendance set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')},
            edited_by = $1, edited_at = now() where id = $${keys.length + 2} returning *`,
    [p._editor || null, ...vals, id]).then((r) => r.rows[0]);
};
export const deleteAttendance = (id, q = query) => q(`delete from attendance where id = $1 returning id`, [id]).then((r) => r.rows[0] || null);
export const approveOvertime = (id, userId, approved, q = query) =>
  q(`update attendance set overtime_approved = $2, overtime_approved_by = $3, overtime_approved_at = case when $2 then now() else null end
     where id = $1 returning *`, [id, approved, userId]).then((r) => r.rows[0]);
/** Exceptions feed the red dot in the top nav and the dashboard's alert panel. */
export const exceptions = async ({ from, to, employeeId } = {}) => {
  const { params, P } = params0();
  const clauses = [`a.day between ${P(from)} and ${P(to)}`];
  if (employeeId) clauses.push(`a.employee_id = ${P(employeeId)}`);
  const { rows } = await query(`
    select count(*) filter (where missing_checkout) as missing_checkout,
           count(*) filter (where missing_checkin) as missing_checkin,
           count(*) filter (where short_day) as short_days,
           count(*) filter (where ot_pending) as ot_pending,
           count(*) filter (where absent) as absent
    from v_attendance_exceptions a where ${clauses.join(' and ')}`, params);
  return mapKeys(rows[0], ['missing_checkout', 'missing_checkin', 'short_days', 'ot_pending', 'absent']);
};
export const monthlySummary = (employeeId, from, to) =>
  query(`select count(*)::int as days, coalesce(sum(worked_hours),0) as worked_hours, coalesce(sum(net_worked_hours),0) as net_hours,
                coalesce(sum(overtime_hours) filter (where overtime_approved),0) as overtime_hours,
                count(*) filter (where status = 'ABSENT')::int as absent,
                count(*) filter (where status in ('PRESENT','LATE','OVERTIME','HALF_DAY'))::int as present,
                count(*) filter (where status = 'ON_LEAVE')::int as on_leave,
                count(*) filter (where status = 'HOLIDAY')::int as holiday,
                count(*) filter (where is_manual)::int as manual
         from attendance where employee_id = $1 and day between $2 and $3`, [employeeId, from, to])
    .then((r) => mapKeys(r.rows[0], ['worked_hours', 'net_hours', 'overtime_hours']));
/** Attendance heat for the dashboard panel: present %, by day, for a month. */
export const attendanceHealth = ({ from, to, departmentId } = {}) => {
  const { params, P } = params0();
  const clauses = [`a.day between ${P(from)} and ${P(to)}`];
  if (departmentId) clauses.push(`e.department_id = ${P(departmentId)}`);
  return query(`
    select a.day,
           count(*) filter (where a.status in ('PRESENT','LATE','OVERTIME','HALF_DAY')) as present,
           count(*) filter (where a.status = 'ABSENT') as absent,
           count(*) filter (where a.status = 'ON_LEAVE') as on_leave,
           count(*) filter (where a.check_in is not null and a.check_out is null) as exceptions,
           coalesce(avg(a.worked_hours) , 0) as avg_hours,
           count(*) as total
    from attendance a join employees e on e.id = a.employee_id
    where ${clauses.join(' and ')} group by a.day order by a.day`, params).then((r) => r.rows.map((x) => mapKeys(x, ['present', 'absent', 'on_leave', 'exceptions', 'total', 'avg_hours'])));
};
