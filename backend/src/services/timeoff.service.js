import { AppError, toIso, eachDay, isoDow } from '../lib/shared/index.js';
import * as repo from '../repositories/timeoff.repo.js';
import * as employeeRepo from '../repositories/employee.repo.js';
import { query } from '../db/pool.js';
import { transaction } from '../db/tx.js';
import { shiftHours } from '../lib/payroll/index.js';

export const listTypes = (f) => repo.listTypes(f);
export const getType = (id) => repo.getType(id).then((t) => { if (!t) throw AppError.notFound('Time off type not found'); return t; });
export const createType = (d) => repo.createType(d);
export const updateType = async (id, d) => { const t = await repo.updateType(id, d); if (!t) throw AppError.notFound('Time off type not found'); return t; };
export const deleteType = async (id) => { const t = await repo.deleteType(id); if (!t) throw new AppError('TYPE_IN_USE', 'This type already has requests against it; deactivate it instead', { status: 409 }); return { ok: true, id }; };
export const listAllocations = (f) => repo.listAllocations(f);
export const overview = (f) => repo.timeOffOverview(f);
export const repoGetRequest = (id) => repo.getRequest(id);
export const listRequests = (f) => repo.listRequests(f);

/** Days between two dates that the type actually counts (weekends optional, holidays always excluded). */
export async function countDays({ employeeId, typeId, from, to, unit, halfDayPeriod }) {
  const type = await repo.getType(typeId);
  if (!type) throw AppError.notFound('Time off type not found');
  const employee = await employeeRepo.getEmployeeRaw(employeeId);
  const holidays = new Set((await query(`select day from holidays where day between $1 and $2`, [from, to]).then((r) => r.rows)).map((h) => toIso(h.day)));
  const scheduleId = employee?.working_schedule_id;
  const rows = scheduleId ? await query(`select day_of_week, start_time, end_time, break_minutes, is_rest_day from working_schedule_days where schedule_id = $1`, [scheduleId]).then((r) => r.rows) : [];
  const byDow = new Map(rows.map((r) => [Number(r.day_of_week), r]));
  let days = 0;
  const excluded = [];
  for (const d of eachDay(from, to)) {
    if (holidays.has(d)) { excluded.push({ day: d, reason: 'holiday' }); continue; }
    const dow = isoDow(d);
    const row = byDow.get(dow);
    if (row ? (row.is_rest_day || shiftHours(row.start_time, row.end_time, row.break_minutes) <= 0) : (dow === 6 || dow === 7)) {
      excluded.push({ day: d, reason: 'week-off' });
      continue;
    }
    days += 1;
  }
  if (!days && eachDay(from, to).length) days = eachDay(from, to).length;   // nothing but week-offs → count them anyway so the request isn't 0 days
  const out = unit === 'HOURS' ? days * 8 : days;
  return { days: unit === 'HOURS' ? out : days, hours: days * 8, halfDay: halfDayPeriod ? 0.5 : 0, excluded, type };
}
/**
 * Approving time off is a two-row write (request + allocation balance) and must be atomic: a half-applied
 * approval is how balances drift from reality and nobody can prove who changed it.
 */
export async function createRequest(data, { auth }) {
  const employeeId = data.employee_id || auth.employeeId;
  if (!employeeId) throw AppError.badRequest('Employee is required', { code: 'EMPLOYEE_REQUIRED' });
  const type = await repo.getType(data.time_off_type_id);
  if (!type) throw AppError.badRequest('Unknown time off type', { code: 'TYPE_REQUIRED' });
  const from = toIso(data.start_date), to = toIso(data.end_date || data.start_date);
  if (to < from) throw AppError.badRequest('End date cannot be before the start date', { code: 'DATE_RANGE' });
  const counted = await countDays({ employeeId, typeId: type.id, from, to, unit: type.unit, halfDayPeriod: data.half_day_period });
  const duration = data.duration != null ? Number(data.duration) : (data.half_day_period ? Math.max(0.5, counted.days - 0.5) : counted.days);
  const allocation = type.requires_allocation ? await repo.pickAllocation(employeeId, type.id, from) : null;
  if (type.requires_allocation && !allocation) {
    throw new AppError('NO_ALLOCATION', `No approved ${type.name} allocation covers ${toIso(from)}. Ask HR to allocate it.`, { status: 409 });
  }
  if (type.max_days_per_year) {
    const used = await query(`select coalesce(sum(r.approved_days),0) as n from time_off_requests r
      where r.employee_id = $1 and r.time_off_type_id = $2 and r.status = 'APPROVED' and extract(year from r.start_date) = $3`,
      [employeeId, type.id, +from.slice(0, 4)]).then((r) => Number(r.rows[0].n));
    if (used + duration > type.max_days_per_year) {
      throw new AppError('MAX_DAYS_EXCEEDED', `${type.name}: ${used} of ${type.max_days_per_year} days already used this year`, { status: 409, details: { used, limit: type.max_days_per_year } });
    }
  }
  if (allocation && type.requires_allocation && Number(allocation.remaining_days) - Number(allocation.pending_days) < duration) {
    throw new AppError('INSUFFICIENT_BALANCE', `Only ${round(Number(allocation.remaining_days) - Number(allocation.pending_days))} ${type.unit.toLowerCase()} of ${type.name} left`,
      { status: 400, details: { remaining: Number(allocation.remaining_days), pending: Number(allocation.pending_days), requested: duration } });
  }
  if (type.min_notice_days > 0 && daysUntil(from) < type.min_notice_days) {
    throw new AppError('NOTICE_REQUIRED', `${type.name} needs ${type.min_notice_days} days notice`, { status: 400 });
  }
  const status = data.status || (type.approval_route === 'NONE' ? 'APPROVED' : 'TO_APPROVE');
  return transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    const created = await repo.createRequest({ employee_id: employeeId, time_off_type_id: type.id, allocation_id: allocation?.id || null,
      start_date: from, end_date: to, duration, duration_unit: type.unit, work_days: counted.days, half_day_period: data.half_day_period || null,
      approved_days: status === 'APPROVED' ? duration : null, reason: data.reason || null, status, requested_by: auth.userId }, q);
    if (allocation && status !== 'APPROVED') await repo.adjustAllocation(allocation.id, { pending: duration }, q);
    if (allocation && status === 'APPROVED') await repo.adjustAllocation(allocation.id, { taken: duration }, q);
    return repo.getRequest(created.id, q);
  });
}
const round = (n) => Math.round(n * 100) / 100;
const daysUntil = (dateIso) => Math.ceil((new Date(`${dateIso}T00:00:00Z`) - Date.now()) / 86400000);
export async function patchRequest(id, patch, { auth }) {
  const r = await repo.getRequest(id);
  if (!r) throw AppError.notFound('Time off request not found');
  if (r.employee_id !== auth.employeeId && auth.scope !== 'company') throw AppError.forbidden('Not your request');
  if (!['DRAFT', 'TO_APPROVE', 'REFUSED'].includes(r.status)) throw new AppError('LOCKED', `A ${r.status.toLowerCase()} request can no longer be edited`, { status: 409 });
  if (patch.status === 'CANCELLED') return decide(id, { status: 'CANCELLED' }, { auth });
  const from = toIso(patch.start_date || r.start_date), to = toIso(patch.end_date || r.end_date);
  const counted = await countDays({ employeeId: r.employee_id, typeId: r.time_off_type_id, from, to, unit: r.unit });
  return repo.patchRequest(id, { ...patch, start_date: from, end_date: to, duration: patch.duration ?? counted.days, work_days: counted.days });
}
/** approve → moves days from pending to taken on the allocation (the balance the portal shows). */
export async function decide(id, { status = 'APPROVED', approved_days, refuse_reason }, { auth }) {
  const r = await repo.getRequest(id);
  if (!r) throw AppError.notFound('Time off request not found');
  if (!['TO_APPROVE', 'DRAFT', 'APPROVED', 'REFUSED'].includes(r.status)) throw new AppError('LOCKED', `This request is already ${r.status.toLowerCase()}`, { status: 409 });
  if (status === 'REFUSED' && !refuse_reason) throw AppError.badRequest('Give a reason when refusing a request', { code: 'REASON_REQUIRED' });
  const days = approved_days != null ? Number(approved_days) : Number(r.duration);
  return transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r2) => ({ rows: r2.rows, rowCount: r2.rowCount }));
    if (r.status === 'APPROVED' && r.allocation_id) await repo.adjustAllocation(r.allocation_id, { taken: -Number(r.approved_days ?? r.duration) }, q);
    if (status === 'APPROVED' && r.allocation_id) {
      await repo.adjustAllocation(r.allocation_id, { pending: -Number(r.duration), taken: days }, q);
      const alloc = await q(`select allocated_days, taken_days, remaining_days from time_off_allocations where id = $1`, [r.allocation_id]).then((x) => x.rows[0]);
      if (alloc && Number(alloc.remaining_days) < 0) throw new AppError('INSUFFICIENT_BALANCE', 'Approving this would push the balance below zero', { status: 409, details: alloc });
    } else if (['REFUSED', 'CANCELLED'].includes(status) && r.allocation_id) {
      await repo.adjustAllocation(r.allocation_id, { pending: -Number(r.duration) }, q);
    }
    return repo.decideRequest(id, { status, approvedBy: auth?.userId || null, approvedDays: status === 'APPROVED' ? days : null,
      refuseReason: status === 'REFUSED' ? refuse_reason : null }, q);
  });
}
export const cancel = (id, { auth }) => decide(id, { status: 'CANCELLED' }, { auth });
export async function remove(id, { auth }) {
  const r = await repo.getRequest(id);
  if (!r) throw AppError.notFound('Time off request not found');
  if (r.status === 'APPROVED') throw new AppError('LOCKED', 'Refuse or cancel an approved request instead of deleting it', { status: 409 });
  const done = await repo.deleteRequest(id);
  if (!done) throw new AppError('LOCKED', 'Only draft, refused or cancelled requests can be deleted', { status: 409 });
  return { ok: true, id };
}
export const allocationsFor = (employeeId) => repo.allocationsFor(employeeId);
export const createAllocation = (d) => repo.createAllocation(d);
export const updateAllocation = (id, p) => repo.updateAllocation(id, p);
/** End-of-year carry forward, from the type's policy — runs in a transaction because it writes many rows. */
export async function carryForward({ typeId, fromYear, toYear, cap }) {
  const type = await repo.getType(typeId);
  if (!type) throw AppError.notFound('Time off type not found');
  if (!type.carry_forward) throw AppError.badRequest(`${type.name} does not carry forward`, { code: 'CARRY_FORWARD_OFF' });
  const rows = await query(`select a.* from time_off_allocations a
    where a.time_off_type_id = $1 and extract(year from a.valid_until) = $2 and a.remaining_days > 0`, [typeId, fromYear]).then((r) => r.rows);
  const applied = [];
  await transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    for (const a of rows) {
      const move = cap != null ? Math.min(Number(a.remaining_days), Number(cap)) : Number(a.remaining_days);
      if (move <= 0) continue;
      const existing = await q(`select * from time_off_allocations where employee_id = $1 and time_off_type_id = $2 and extract(year from valid_from) = $3`,
        [a.employee_id, typeId, toYear]).then((r) => r.rows[0]);
      if (existing) await repo.updateAllocation(existing.id, { allocated_days: Number(existing.allocated_days) + move }, q);
      else await repo.createAllocation({ employee_id: a.employee_id, time_off_type_id: typeId, allocated_days: move,
        valid_from: `${toYear}-01-01`, valid_until: `${toYear}-12-31`, status: 'APPROVED',
        description: `Carried forward from ${fromYear} (${type.name})` }, q);
      applied.push({ employee_id: a.employee_id, days: move });
    }
  });
  return { type: type.name, fromYear, toYear, employees: applied.length, days: applied.reduce((a, x) => a + x.days, 0) };
}
