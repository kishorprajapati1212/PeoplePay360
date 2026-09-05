import { query } from '../db/pool.js';
import { mapKeys, like } from './sql.js';
import { params0 } from './_helpers.js';

const SELECT = `select c.*, e.name as employee, e.employee_code, e.work_email, d.name as department,
                       s.name as salary_structure, s.id as salary_structure_id, w.name as working_schedule, w.total_weekly_hours
                from contracts c
                join employees e on e.id = c.employee_id
                left join departments d on d.id = c.department_id
                left join salary_structures s on s.id = c.salary_structure_id
                left join working_schedules w on w.id = c.working_schedule_id`;
export const listContracts = async (f = {}) => {
  const { params, P } = params0();
  const clauses = ['true'];
  if (f.employeeId) clauses.push(`c.employee_id = ${P(f.employeeId)}`);
  if (f.status) clauses.push(`c.status = ${P(f.status)}`);
  if (f.departmentId) clauses.push(`c.department_id = ${P(f.departmentId)}`);
  if (f.search) clauses.push(`(e.name ilike ${P(`%${f.search}%`)} or e.employee_code ilike $${params.length} or c.contract_number ilike $${params.length})`);
  if (f.expiringDays) clauses.push(`c.end_date is not null and c.end_date between current_date and current_date + ($${P(f.expiringDays)})::int`);
  const { rows } = await query(`select *, count(*) over () as total from (${SELECT} where ${clauses.join(' and ')}) x
    order by x.start_date desc, x.employee asc limit ${P(f.limit || 200)} offset ${P(f.offset || 0)}`, params);
  return { rows: rows.map((r) => mapKeys(r, ['wage', 'total_weekly_hours'])), total: Number(rows[0]?.total ?? 0) };
};
export const getContract = (id, q = query) => q(`${SELECT} where c.id = $1`, [id]).then((r) => mapKeys(r.rows[0], ['wage', 'total_weekly_hours']));
/** Period-aware: payroll asks "which contract applies to 1–15 Feb", never "what is running today". */
export const contractForPeriod = (employeeId, from, to) =>
  query(`select * from contracts where employee_id = $1 and status <> 'DRAFT' and start_date <= $2 and (end_date is null or end_date >= $3)
         order by is_primary desc nulls last, start_date desc, id desc limit 1`, [employeeId, to, from]).then((r) => r.rows[0] || null);
const COLS = ['employee_id', 'start_date', 'end_date', 'department_id', 'job_position', 'wage', 'salary_structure_id', 'working_schedule_id', 'status', 'is_primary', 'notes'];
export const createContract = (d, q = query) =>
  q(`insert into contracts (${COLS.filter((c) => d[c] !== undefined).join(', ')})
     values (${COLS.filter((c) => d[c] !== undefined).map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    COLS.filter((c) => d[c] !== undefined).map((c) => d[c])).then((r) => r.rows[0]);
export const updateContract = (id, p, q = query) => {
  const keys = COLS.filter((k) => p[k] !== undefined);
  if (!keys.length) return query(`select * from contracts where id = $1`, [id]).then((r) => r.rows[0]);
  return q(`update contracts set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning *`, [id, ...keys.map((k) => p[k])]).then((r) => r.rows[0]);
};
export const setStatus = (id, status, { end_date } = {}, q = query) =>
  q(`update contracts set status = $2, end_date = coalesce($3, end_date) where id = $1 returning *`, [id, status, end_date || null]).then((r) => r.rows[0]);
/** Overlap probe used by the UI before it lets you save a second running contract for the same dates. */
export const overlaps = (employeeId, from, to, exceptId, q = query) =>
  q(`select id, contract_number, start_date, end_date, status from contracts
     where employee_id = $1 and id is distinct from $4::uuid and status <> 'DRAFT'
       and start_date <= $2 and (end_date is null or end_date >= $3) order by start_date`, [employeeId, to, from, exceptId || null]).then((r) => r.rows);
export const contractsOf = (employeeId) =>
  query(`select c.*, s.name as salary_structure, w.name as working_schedule, w.total_weekly_hours
         from contracts c left join salary_structures s on s.id = c.salary_structure_id
         left join working_schedules w on w.id = c.working_schedule_id
         where c.employee_id = $1 order by c.start_date desc`, [employeeId]).then((r) => r.rows.map((x) => mapKeys(x, ['wage', 'total_weekly_hours'])));
export const expiring = (days = 30) =>
  query(`select c.id, c.contract_number, c.end_date, c.status, e.id as employee_id, e.name as employee, e.employee_code
         from contracts c join employees e on e.id = c.employee_id
         where c.end_date is not null and c.end_date between current_date and current_date + ($1)::int and c.status = 'RUNNING'
         order by c.end_date`, [days]).then((r) => r.rows);
export const demoteExpired = () =>
  query(`update contracts set status = 'EXPIRED' where status = 'RUNNING' and end_date is not null and end_date < current_date`).then((r) => r.rowCount);
