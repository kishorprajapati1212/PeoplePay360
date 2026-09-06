import { AppError } from '../lib/shared/index.js';
import { query } from '../db/pool.js';
import { mapKeys } from './sql.js';
import { params0 } from './_helpers.js';

const TYPE_COLS = ['name', 'code', 'unit', 'requires_allocation', 'max_days_per_year', 'approval_route', 'work_entry_type',
                   'is_unpaid', 'payslip_code', 'is_encashable', 'carry_forward', 'sandwich_rule', 'min_notice_days',
                   'display_color', 'is_active', 'description', 'category'];
export const listTypes = ({ includeInactive = false, category = null, pay = null } = {}) => {
  const where = []; const params = [];
  if (!includeInactive) where.push("t.is_active = 'ACTIVE'");
  if (category) { params.push(category); where.push(`t.category = $${params.length}`); }
  if (pay) where.push(pay === 'PAID' ? 'not t.is_unpaid' : 't.is_unpaid');
  return query(`select t.*,
                (select count(*) from time_off_requests r where r.time_off_type_id = t.id and r.status = 'APPROVED') as approved_requests,
                (select coalesce(sum(r.approved_days),0) from time_off_requests r where r.time_off_type_id = t.id and r.status = 'APPROVED') as days_used,
                (select count(distinct a.employee_id) from time_off_allocations a where a.time_off_type_id = t.id) as allocated_employees
         from time_off_types t ${where.length ? `where ${where.join(' and ')}` : ''} order by t.name`, params)
    .then((r) => r.rows.map((x) => mapKeys(x, ['days_used', 'approved_requests', 'allocated_employees'])));
};
/** Everything that points at a type, so "delete" can say what it would break instead of failing quietly. */
export const typeReferences = (id) =>
  query(`select (select count(*) from time_off_requests where time_off_type_id = $1) as requests,
                 (select count(*) from time_off_requests where time_off_type_id = $1 and status = 'TO_APPROVE') as pending_requests,
                 (select count(*) from time_off_allocations where time_off_type_id = $1) as allocations,
                 (select count(distinct employee_id) from time_off_allocations where time_off_type_id = $1) as allocated_employees`, [id])
    .then((r) => Object.fromEntries(Object.entries(r.rows[0]).map(([k, v]) => [k, Number(v)])));
export const getType = (id) => query(`select * from time_off_types where id = $1`, [id]).then((r) => r.rows[0] || null);
const upsertCols = (d, cols) => ({ keys: cols.filter((c) => d[c] !== undefined), vals: cols.filter((c) => d[c] !== undefined).map((c) => d[c]) });
export const createType = (d) => {
  const { keys, vals } = upsertCols(d, TYPE_COLS);
  return query(`insert into time_off_types (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, vals).then((r) => r.rows[0]);
};
export const updateType = (id, d) => {
  const { keys, vals } = upsertCols(d, TYPE_COLS);
  if (!keys.length) return getType(id);
  return query(`update time_off_types set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning *`, [id, ...vals]).then((r) => r.rows[0]);
};
// A delete that quietly turned the row INACTIVE was the bug: the screen said "deleted", the row stayed, and
// the only clue was a chip that no longer appeared in a picker. Now the row goes when nothing points at it,
// and the service counts the references first so the refusal can name them.
export const deleteType = (id) =>
  query(`delete from time_off_types t
         where t.id = $1
           and not exists (select 1 from time_off_requests r where r.time_off_type_id = t.id)
           and not exists (select 1 from time_off_allocations a where a.time_off_type_id = t.id)
         returning t.id`, [id]).then((r) => r.rows[0] || null);


const REQ_SELECT = `
  -- the leave type's own rules travel with the request so an approver can be told, in the decision dialog,
  -- whether these days come off a balance or are unpaid; the front end never has to guess them
  select r.*, e.name as employee, e.employee_code, e.department_id, t.name as type, t.code as type_code, t.unit, t.is_unpaid,
         t.category, t.requires_allocation,
         coalesce(appr.name, 'HR') as approver, ap.name as approved_by_name,
         alloc.description as allocation_label, alloc.remaining_days as allocation_remaining
  from time_off_requests r
  join employees e on e.id = r.employee_id
  join time_off_types t on t.id = r.time_off_type_id
  left join employees appr on appr.id = e.manager_id
  left join users ap on ap.id = r.approved_by
  left join time_off_allocations alloc on alloc.id = r.allocation_id`;
export const listRequests = async (f = {}) => {
  const { params, P } = params0();
  const clauses = ['true'];
  if (f.employeeId) clauses.push(`r.employee_id = ${P(f.employeeId)}`);
  if (f.status) clauses.push(`r.status = ${P(f.status)}`);
  if (f.statuses?.length) clauses.push(`r.status = any(${P(f.statuses)}::request_status[])`);
  if (f.typeId) clauses.push(`r.time_off_type_id = ${P(f.typeId)}`);
  if (f.from) clauses.push(`r.end_date >= ${P(f.from)}`);
  if (f.to) clauses.push(`r.start_date <= ${P(f.to)}`);
  if (f.pendingOnly) clauses.push(`r.status = 'TO_APPROVE'`);
  if (f.departmentId) clauses.push(`e.department_id = ${P(f.departmentId)}`);
  const sql = `${REQ_SELECT} where ${clauses.join(' and ')} order by r.start_date desc, e.name
                limit ${P(f.limit || 200)} offset ${P(f.offset || 0)}`;
  const { rows } = await query(`select *, count(*) over () as total from (${sql}) x`, params);
  return { rows: rows.map((r) => mapKeys(r, ['duration', 'work_days', 'approved_days'])), total: Number(rows[0]?.total ?? 0) };
};
export const getRequest = (id, q = query) => q(`${REQ_SELECT} where r.id = $1`, [id]).then((r) => mapKeys(r.rows[0], ['duration', 'work_days', 'approved_days']));
export const createRequest = (d, q = query) =>
  q(`insert into time_off_requests (employee_id, time_off_type_id, allocation_id, start_date, end_date, duration, duration_unit,
                                     work_days, half_day_period, approved_days, reason, status, requested_by)
     values ($1,$2,$3,$4,$5,$6,coalesce($7,'DAYS')::time_off_unit,$8,$9,$10,$11,coalesce($12,'TO_APPROVE')::request_status,$13) returning *`,
    [d.employee_id, d.time_off_type_id, d.allocation_id || null, d.start_date, d.end_date, d.duration, d.duration_unit,
     d.work_days ?? 0, d.half_day_period || null, d.approved_days ?? null, d.reason || null, d.status, d.requested_by]).then((r) => r.rows[0]);
export const patchRequest = (id, p, q = query) => {
  const keys = ['start_date', 'end_date', 'duration', 'reason', 'status', 'allocation_id', 'half_day_period', 'work_days'].filter((k) => p[k] !== undefined);
  if (!keys.length) return q(`select * from time_off_requests where id = $1`, [id]).then((r) => r.rows[0]);
  return q(`update time_off_requests set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning *`, [id, ...keys.map((k) => p[k])]).then((r) => r.rows[0]);
};
export const decideRequest = (id, { status, approvedBy, approvedDays, refuseReason, allocationId, decisionRemark }, q = query) =>
  q(`update time_off_requests set status = $2::request_status, approved_by = $3,
           approved_at = case when $2::text in ('APPROVED','REFUSED') then now() else null end,
           approved_days = coalesce($4, approved_days), refuse_reason = $5, allocation_id = coalesce($6, allocation_id),
           decision_remark = $7
     where id = $1 returning *`,
    [id, status, approvedBy, approvedDays ?? null, refuseReason || null, allocationId || null, decisionRemark || null]).then((r) => r.rows[0]);
export const deleteRequest = (id, q = query) => q(`delete from time_off_requests where id = $1 and status in ('DRAFT','CANCELLED','REFUSED') returning id`, [id]).then((r) => r.rows[0] || null);
/** Allocation rows for an employee + type, ordered so the newest window wins. */
export const allocationsFor = (employeeId, q = query) =>
  q(`select a.*, t.name as type, t.code as type_code, t.unit, t.requires_allocation, t.carry_forward
     from time_off_allocations a join time_off_types t on t.id = a.time_off_type_id
     where a.employee_id = $1 order by t.name, a.valid_from desc`, [employeeId]).then((r) => r.rows.map((x) => mapKeys(x, ['allocated_days', 'taken_days', 'pending_days', 'remaining_days'])));
/** One row per leave type — the balance a person (and HR) should see. Windows overlap in real data
 *  (an annual grant plus a mid-year correction, a carried-forward row, …), and the raw rows made the
 *  granted days look missing whenever two windows shared a type: the UI keyed by type name and one of
 *  the two never rendered. Aggregating here means "12 days added" always shows, summed with whatever
 *  the person already had. */
export const balancesFor = (employeeId, q = query) =>
  q(`select t.id as type_id, t.name as type, t.code as type_code, t.unit, t.is_unpaid, t.carry_forward,
            count(*) filter (where current_date between a.valid_from and a.valid_until)::int as active_windows,
            count(*)::int as windows,
            coalesce(sum(a.allocated_days), 0) as allocated_days,
            coalesce(sum(a.taken_days), 0) as taken_days,
            coalesce(sum(a.pending_days), 0) as pending_days,
            coalesce(sum(a.remaining_days), 0) as remaining_days,
            min(a.valid_from) as valid_from, max(a.valid_until) as valid_until
     from time_off_allocations a join time_off_types t on t.id = a.time_off_type_id
     where a.employee_id = $1 and a.status = 'APPROVED'
     group by t.id, t.name, t.code, t.unit, t.is_unpaid, t.carry_forward
     order by t.name`, [employeeId])
    .then((r) => r.rows.map((x) => mapKeys(x, ['allocated_days', 'taken_days', 'pending_days', 'remaining_days', 'windows', 'active_windows'])));
export const pickAllocation = (employeeId, typeId, fromDate, q = query) =>
  q(`select * from time_off_allocations where employee_id = $1 and time_off_type_id = $2 and status = 'APPROVED'
       and valid_from <= $3 and valid_until >= $3 order by valid_until desc limit 1`, [employeeId, typeId, fromDate]).then((r) => r.rows[0] || null);
export const adjustAllocation = (id, { taken = 0, pending = 0 }, q = query) =>
  q(`update time_off_allocations
        set taken_days = greatest(0, taken_days + $2),
            pending_days = greatest(0, pending_days + $3),
            remaining_days = greatest(0, allocated_days - greatest(0, taken_days + $2))
      where id = $1 returning *`, [id, taken, pending]).then((r) => r.rows[0]);
export const createAllocation = (d, q = query) =>
  q(`insert into time_off_allocations (employee_id, time_off_type_id, allocated_days, taken_days, pending_days, remaining_days,
                                       valid_from, valid_until, status, requested_by, approved_by, approved_at, description)
     values ($1::uuid,$2::uuid,$3::numeric,coalesce($4::numeric,0),coalesce($5::numeric,0),$3::numeric - coalesce($4::numeric,0),$6::date,$7::date,
             coalesce($8::text,'APPROVED')::request_status,$9::uuid,$10::uuid,case when coalesce($8::text,'APPROVED')='APPROVED' then now() else null end,$11::text)
     returning *`,
    [d.employee_id, d.time_off_type_id, d.allocated_days, d.taken_days, d.pending_days, d.valid_from, d.valid_until,
     d.status, d.requested_by || null, d.approved_by || null, d.description || null]).then((r) => r.rows[0]);
export async function updateAllocation(id, p, q = query) {
  const keys = ['allocated_days', 'taken_days', 'pending_days', 'valid_from', 'valid_until', 'status', 'description'].filter((k) => p[k] !== undefined);
  if (!keys.length) return (await q(`select * from time_off_allocations where id = $1`, [id])).rows[0] ?? null;
  const current = await q(`select * from time_off_allocations where id = $1 for update`, [id]).then((r) => r.rows[0]);
  if (!current) return null;
  const next = { ...current, ...Object.fromEntries(keys.map((k) => [k, p[k]])) };
  // ck_alloc_math: remaining must equal allocated − taken exactly, so recompute it from the new values
  const remaining = Number(next.allocated_days) - Number(next.taken_days);
  if (remaining < 0) throw new AppError('NEGATIVE_BALANCE', `Taken days (${next.taken_days}) exceed the allocation (${next.allocated_days})`, { status: 422 });
  return q(`update time_off_allocations set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')},
                   remaining_days = $${keys.length + 2} where id = $1 returning *`,
    [id, ...keys.map((k) => p[k]), remaining]).then((r) => r.rows[0]);
};
export const listAllocations = async (f = {}) => {
  const { params, P } = params0();
  const clauses = ['true'];
  if (f.employeeId) clauses.push(`a.employee_id = ${P(f.employeeId)}`);
  if (f.typeId) clauses.push(`a.time_off_type_id = ${P(f.typeId)}`);
  if (f.year) clauses.push(`extract(year from a.valid_from) = ${P(Number(f.year))}`);
  const { rows } = await query(`select *, count(*) over () as total from (
      select a.*, e.name as employee, e.employee_code, t.name as type, t.unit, t.is_unpaid
      from time_off_allocations a
      join employees e on e.id = a.employee_id
      join time_off_types t on t.id = a.time_off_type_id
      where ${clauses.join(' and ')} order by e.name, t.name limit ${P(f.limit || 500)}) x`, params);
  return { rows: rows.map((r) => mapKeys(r, ['allocated_days', 'taken_days', 'pending_days', 'remaining_days'])), total: Number(rows[0]?.total ?? 0) };
};
/** Dashboard panel: approved / pending / remaining per leave type (subqueries keep the filters honest). */
export const timeOffOverview = ({ from, to, departmentId } = {}) => {
  const { params, P } = params0();
  const window = from && to ? `and r.start_date <= ${P(to)} and r.end_date >= ${P(from)}` : '';
  const dept = departmentId ? `and e2.department_id = ${P(departmentId)}` : '';
  return query(`
    select t.id as type_id, t.name as type, t.unit,
           coalesce(req.approved_days, 0) as approved_days,
           coalesce(req.pending, 0) as pending,
           coalesce(req.pending_days, 0) as pending_days,
           coalesce(alloc.remaining_balance, 0) as remaining_balance,
           coalesce(alloc.taken, 0) as taken_days,
           coalesce(alloc.allocated, 0) as allocated_days
    from time_off_types t
    left join lateral (
      select sum(r.approved_days) filter (where r.status = 'APPROVED') as approved_days,
             count(*) filter (where r.status = 'TO_APPROVE') as pending,
             sum(r.duration) filter (where r.status = 'TO_APPROVE') as pending_days
      from time_off_requests r join employees e2 on e2.id = r.employee_id
      where r.time_off_type_id = t.id ${window} ${dept}
    ) req on true
    left join lateral (
      select sum(a.remaining_days) as remaining_balance, sum(a.taken_days) as taken, sum(a.allocated_days) as allocated
      from time_off_allocations a join employees e3 on e3.id = a.employee_id
      where a.time_off_type_id = t.id and a.status = 'APPROVED' ${departmentId ? `and e3.department_id = $${params.length}` : ''}
    ) alloc on true
    where t.is_active = 'ACTIVE'
    order by t.name`, params).then((r) => r.rows.map((x) => mapKeys(x, ['approved_days', 'pending', 'pending_days', 'remaining_balance', 'taken_days', 'allocated_days'])));
};
