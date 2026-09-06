import { query } from '../db/pool.js';
import { mapKeys } from './sql.js';
import { params0 } from './_helpers.js';

// ── departments (id, name, code, manager_id, parent_id, is_active) ────────────
export const listDepartments = ({ includeInactive = false } = {}) =>
  query(`select d.id, d.name, d.code, d.manager_id, d.parent_id, d.is_active,
                m.name as manager_name, m.employee_code as manager_code,
                (select count(*) from employees e where e.department_id = d.id and e.status = 'ACTIVE') as employee_count,
                (select coalesce(sum(c.wage),0) from contracts c join employees e2 on e2.id = c.employee_id
                   where e2.department_id = d.id and c.status = 'RUNNING' and c.start_date <= current_date
                     and (c.end_date is null or c.end_date >= current_date)) as monthly_wage,
                p.name as parent_name
         from departments d
         left join employees m on m.id = d.manager_id
         left join departments p on p.id = d.parent_id
         ${includeInactive ? '' : 'where d.is_active'}
         order by d.name`).then((r) => r.rows.map((x) => mapKeys(x, ['employee_count', 'monthly_wage'])));
export const createDepartment = (d) =>
  query(`insert into departments (name, code, manager_id, parent_id, is_active) values ($1,$2,$3,$4,coalesce($5,true)) returning *`,
    [d.name, d.code || null, d.manager_id || null, d.parent_id || null, d.is_active]).then((r) => r.rows[0]);
export const updateDepartment = (id, p) => {
  const { params, P } = params0();
  const sets = ['name', 'code', 'manager_id', 'parent_id', 'is_active'].filter((k) => p[k] !== undefined).map((k) => `${k} = ${P(p[k])}`);
  if (!sets.length) return query(`select * from departments where id = $1`, [id]).then((r) => r.rows[0]);
  params.push(id);
  return query(`update departments set ${sets.join(', ')} where id = $${params.length} returning *`, params).then((r) => r.rows[0]);
};
export const departmentUsage = (id) =>
  query(`select (select count(*) from employees where department_id = $1) as employees,
                (select count(*) from contracts where department_id = $1) as contracts,
                (select count(*) from payruns where department_filter = $1) as payruns`, [id]).then((r) => r.rows[0]);
/** Soft delete only, and never while employees are attached (matches the "no hard delete" rule). */
export const deleteDepartment = (id) =>
  query(`update departments set is_active = false where id = $1
         and not exists (select 1 from employees e where e.department_id = $1) returning id`, [id]).then((r) => r.rows[0] || null);

// ── working schedules: parent + weekly grid, saved as one unit ────────────────
const SCHEDULE_DAYS = (id) =>
  query(`select id, day_of_week as day, start_time as start, end_time as "end", break_minutes as break,
                is_rest_day as rest, note as code, day_hours(start_time, end_time, break_minutes) as hours
         from working_schedule_days where schedule_id = $1 order by day_of_week`, [id]).then((r) => r.rows.map((x) => mapKeys(x, ['hours', 'break'])));
export async function listSchedules({ search, status, company, includeDays = true } = {}) {
  const { params, P } = params0();
  const clauses = ['true'];
  if (search) clauses.push(`(s.name ilike ${P(`%${search}%`)} or s.description ilike $${params.length})`);
  if (status) clauses.push(`s.is_active = ${P(status === 'ACTIVE')}`);
  if (company) clauses.push(`s.company_name ilike ${P(`%${company}%`)}`);
  const { rows } = await query(`
    select s.id, s.name, s.type, s.company_name, s.timezone, s.total_weekly_hours, s.days_per_week, s.is_active, s.description,
           count(d.id) filter (where not d.is_rest_day and day_hours(d.start_time, d.end_time, d.break_minutes) > 0) as day_count
    from working_schedules s
    left join working_schedule_days d on d.schedule_id = s.id
    where ${clauses.join(' and ')}
    group by s.id
    order by s.name asc`, params);
  const out = rows.map((r) => mapKeys(r, ['total_weekly_hours', 'days_per_week']));
  if (includeDays) for (const s of out) s.days = await SCHEDULE_DAYS(s.id);
  return out;
}
export const getSchedule = async (id) => {
  const { rows } = await query(`select s.* from working_schedules s where s.id = $1`, [id]);
  if (!rows[0]) return null;
  return { ...mapKeys(rows[0], ['total_weekly_hours', 'days_per_week']), days: await SCHEDULE_DAYS(id),
           usage: await scheduleUsage(id) };
};
export const scheduleUsage = (id) =>
  query(`select (select count(*) from employees where working_schedule_id = $1) as employees,
                (select count(*) from contracts where working_schedule_id = $1) as contracts`, [id]).then((r) => mapKeys(r.rows[0], ['employees', 'contracts']));
export async function saveSchedule(id, data, q = query) {
  const head = { name: data.name, type: data.type || 'FIXED', company_name: data.company_name || 'OXP Pvt Ltd',
                 timezone: data.timezone || 'Asia/Kolkata', is_active: data.is_active ?? 'ACTIVE', description: data.description ?? null };
  let row;
  if (id) {
    const keys = Object.keys(head);
    row = (await q(`update working_schedules set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning *`, [id, ...keys.map((k) => head[k])])).rows[0];
  } else {
    row = (await q(`insert into working_schedules (${Object.keys(head).join(', ')}) values (${Object.keys(head).map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
      Object.values(head))).rows[0];
  }
  if (data.days) {
    await q(`delete from working_schedule_days where schedule_id = $1`, [row.id]);
    for (const d of data.days) {
      if (!d || d.day == null) continue;
      await q(`insert into working_schedule_days (schedule_id, day_of_week, start_time, end_time, break_minutes, is_rest_day, note)
               values ($1,$2,$3::time,$4::time,$5,$6,$7) on conflict do nothing`,
        [row.id, d.day, d.start || null, d.end || null, Number(d.break ?? (d.rest ? 0 : 60)), !!d.rest, d.code || d.note || null]);
    }
  }
  return getSchedule(row.id);
}
export const deleteSchedule = (id) =>
  query(`update working_schedules set is_active = 'INACTIVE' where id = $1
         and not exists (select 1 from employees e where e.working_schedule_id = $1)
         and not exists (select 1 from contracts c where c.working_schedule_id = $1) returning id`, [id]).then((r) => r.rows[0] || null);
/** Days with no schedule row are non-working; used by attendance + payroll, mirrored by expected_days(). */
export const scheduleDaysFor = (ids) =>
  query(`select schedule_id, day_of_week, start_time, end_time, break_minutes, is_rest_day
         from working_schedule_days where schedule_id = any($1::uuid[])`, [ids]).then((r) => r.rows);

// ── holidays (day is globally unique in this schema) ──────────────────────────
export const listHolidays = ({ year, from, to, type } = {}) => {
  const { params, P } = params0();
  const clauses = ['true'];
  if (from && to) clauses.push(`h.day between ${P(from)} and ${P(to)}`);
  else if (year) clauses.push(`h.year = ${P(Number(year))}`);
  if (type) clauses.push(`h.type = ${P(type)}`);
  return query(`select h.id, h.day, h.name, h.type, h.year, h.note, h.template_id, t.name as template
                from holidays h left join holiday_templates t on t.id = h.template_id
                where ${clauses.join(' and ')} order by h.day`, params);
};
export const createHoliday = (h) =>
  query(`insert into holidays (day, name, type, year, note, template_id)
         values ($1,$2,coalesce($3,'PUBLIC'),$4,$5,$6) returning *`,
    [h.day, h.name, h.type, new Date(h.day).getUTCFullYear(), h.note || null, h.template_id || null]).then((r) => r.rows[0]);
export const updateHoliday = (id, p) => {
  const { params, P } = params0();
  const sets = ['day', 'name', 'type', 'note'].filter((k) => p[k] !== undefined).map((k) => `${k} = ${P(p[k])}`);
  if (!sets.length) return query(`select * from holidays where id = $1`, [id]).then((r) => r.rows[0]);
  params.push(id);
  return query(`update holidays set ${sets.join(', ')} where id = $${params.length} returning *`, params).then((r) => r.rows[0]);
};
export const deleteHoliday = (id) => query(`delete from holidays where id = $1 returning id`, [id]).then((r) => r.rows[0] || null);
export const listTemplates = () => query(`select * from holiday_templates order by month asc, day asc, name asc`).then((r) => r.rows);
