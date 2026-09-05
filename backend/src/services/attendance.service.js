import { AppError, toIso, fmtDate, round2p, csvToObjects } from '../lib/shared/index.js';
import * as repo from '../repositories/attendance.repo.js';
import * as orgRepo from '../repositories/org.repo.js';
import * as employeeRepo from '../repositories/employee.repo.js';
import { shiftHours } from '../lib/payroll/index.js';
import { query } from '../db/pool.js';

const hoursBetween = (from, to) => {
  if (!from || !to) return null;
  let mins = (new Date(to).getTime() - new Date(from).getTime()) / 60000;
  if (mins < 0) mins += 24 * 60;      // night shift: 22:00 → 06:00
  return Math.round((mins / 60) * 100) / 100;
};
const minutesOf = (ts) => { const d = new Date(ts); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
/**
 * Derives net_worked_hours / overtime / status from the punches and the employee's schedule.
 * Explicit HR values in the payload always win — auto math is a starting point, not a verdict.
 */
export async function derive(input = {}, actorRole) {
  const { day, check_in, check_out, break_minutes, expected_hours, status, overtime_hours } = input;
  const employeeId = input.employeeId ?? input.employee_id;
  const employee = await employeeRepo.getEmployeeRaw(employeeId);
  if (!employee) throw AppError.notFound('Employee not found');
  const scheduleId = employee.working_schedule_id;
  const rows = scheduleId ? await orgRepo.scheduleDaysFor([scheduleId]) : [];
  const dow = new Date(`${toIso(day)}T00:00:00Z`).getUTCDay() === 0 ? 7 : new Date(`${toIso(day)}T00:00:00Z`).getUTCDay();
  const row = rows.find((r) => Number(r.day_of_week) === dow);
  const scheduled = row && !row.is_rest_day ? shiftHours(row.start_time, row.end_time, row.break_minutes) : 0;
  const holiday = await query(`select name from holidays where day = $1`, [day]).then((r) => r.rows[0] || null);
  const worked = hoursBetween(check_in, check_out);
  const brk = break_minutes != null ? Number(break_minutes) : (row?.break_minutes != null ? Number(row.break_minutes) : (worked != null && worked > 6 ? 60 : 0));
  const net = worked == null ? null : Math.max(0, Math.round((worked - brk / 60) * 100) / 100);
  const expected = expected_hours != null ? Number(expected_hours) : scheduled;
  const out = {
    employee_id: employeeId, day: toIso(day),
    check_in: check_in || null, check_out: check_out || null,
    worked_hours: worked, net_worked_hours: net, break_minutes: brk,
    expected_hours: expected, overtime_hours: overtime_hours != null ? Number(overtime_hours) : (net != null && expected > 0 ? Math.round(Math.max(0, net - expected) * 100) / 100 : 0),
    status: status || deriveStatus({ net, expected, holiday, row, check_in, check_out }),
    is_manual: actorRole === 'HR_MANAGER' || actorRole === 'HR_PAYROLL_USER' || actorRole === 'HR_PAYROLL_MANAGER' || actorRole === 'ADMIN' ? true : false,
    source: actorRole === 'EMPLOYEE' ? 'self' : 'hr',
  };
  if (out.overtime_hours > 0 && overtime_hours == null) out.overtime_hours = Math.round(out.overtime_hours * 100) / 100;
  if (holiday && !status) out.holiday_name = holiday.name;
  return out;
}
function deriveStatus({ net, expected, holiday, row, check_in, check_out }) {
  if (holiday) return 'HOLIDAY';
  if (!check_in && !check_out) return row?.is_rest_day || expected === 0 ? 'HOLIDAY' : 'ABSENT';
  if (check_in && !check_out) return 'PRESENT';
  if (expected > 0 && net >= expected * 0.45 && net < expected * 0.6) return 'HALF_DAY';
  if (expected > 0 && net > expected + 0.25) return 'OVERTIME';
  return 'PRESENT';
}
export const list = (f) => repo.listAttendance(f);
export const read = (id) => repo.getAttendance(id);
export async function upsert(data, { auth } = {}) {
  const derived = await derive(data, (auth?.roles || [])[0]);
  if (data.manual_reason) derived.manual_reason = data.manual_reason;
  if (!derived.check_in && !derived.check_out && !data.status) throw AppError.badRequest('Add a punch or pick a status');
  if (derived.check_in && derived.check_out && new Date(derived.check_out).getTime() < new Date(derived.check_in).getTime() - 12 * 3600000) {
    throw AppError.badRequest('Check out cannot be before check in (unless it is a night shift)');
  }
  const saved = await repo.createAttendance(derived);
  return repo.getAttendance(saved.id);
}
export async function patch(id, patch_, { auth } = {}) {
  const existing = await repo.getAttendance(id);
  if (!existing) throw AppError.notFound('Attendance row not found');
  const merged = { ...existing, ...patch_, employee_id: existing.employee_id, day: patch_.day || existing.day };
  const derived = await derive(merged, (auth?.roles || [])[0]);
  const edited = { ...derived, _editor: auth?.userId, manual_reason: patch_.manual_reason || existing.manual_reason,
                   overtime_approved: patch_.overtime_approved ?? existing.overtime_approved, status: patch_.status || derived.status };
  const saved = await repo.updateAttendance(id, edited);
  return repo.getAttendance(saved.id);
}
export async function remove(id) {
  const done = await repo.deleteAttendance(id);
  if (!done) throw AppError.notFound('Attendance row not found');
  return { ok: true, id };
}
/** Kiosk/self clock: one row per employee-day, punch state machine (in → out). */
export async function clock(input = {}, { auth }) {
  const id = input.employeeId ?? input.employee_id ?? auth?.employeeId;
  const at = input.at;
  if (!id) throw AppError.badRequest('No employee linked to this account', { code: 'NO_PROFILE' });
  const now = at ? new Date(at) : new Date();
  const day = toIso(now);
  const existing = await repo.byEmployeeDay(id, day);
  if (!existing) {
    const created = await repo.createAttendance(await derive({ employeeId: id, day, check_in: now.toISOString(), status: 'PRESENT' }, (auth.roles || [])[0]));
    return { action: 'IN', at: created.check_in, record: await repo.getAttendance(created.id) };
  }
  if (existing.check_in && !existing.check_out) {
    const derived = await derive({ ...existing, check_out: now.toISOString() }, (auth.roles || [])[0]);
    const saved = await repo.updateAttendance(existing.id, { ...derived, _editor: auth.userId, status: existing.status || derived.status });
    return { action: 'OUT', at: saved.check_out, record: await repo.getAttendance(saved.id) };
  }
  const hm = (v) => (v instanceof Date ? v.toTimeString().slice(0, 5) : String(v).slice(11, 16));
  throw new AppError('ALREADY_CLOCKED_OUT', `You already clocked out at ${hm(existing.check_out)} for ${fmtDate(day)}`, { status: 409 });
}
export const approveOvertime = async (id, { auth, approved = true }) => {
  const row = await repo.getAttendance(id);
  if (!row) throw AppError.notFound('Attendance row not found');
  if (!(Number(row.overtime_hours) > 0)) throw AppError.badRequest('This day has no overtime to approve');
  return repo.approveOvertime(id, auth.userId, approved);
};
export const exceptions = (f) => repo.exceptions(f);
export const monthly = (employeeId, f) => repo.monthlySummary(employeeId, f.from, f.to);
export async function importRows(payload, { auth }) {
  const { employeeMatch = 'code', default_source: source, overwrite = true } = payload || {};
  let rows = payload?.rows;
  if (!Array.isArray(rows)) {
    rows = (csvToObjects(payload?.csv) ?? []).map((r) => ({
      employee_code: r.employee_code ?? r.code ?? r.employee_id,
      work_email: r.work_email ?? r.email,
      day: r.day ?? r.date,
      check_in: r.check_in ?? r.in_time ? `${r.day ?? r.date}T${r.check_in ?? r.in_time}` : undefined,
      check_out: r.check_out ?? r.out_time ? `${r.day ?? r.date}T${r.check_out ?? r.out_time}` : undefined,
      break_minutes: r.break_minutes, status: r.status, overtime_hours: r.overtime_hours,
    })).filter((r) => r.day);
    if (source) rows = rows.map((r) => ({ ...r, source }));
    if (overwrite) rows = rows.map((r) => ({ ...r, overwrite: true }));
  }
  if (!rows.length) throw AppError.badRequest('No rows to import — the file needs a header row and at least one line');
  const out = []; const errors = [];
  for (const [i, r] of rows.entries()) {
    try {
      const emp = r.employee_id ? { id: r.employee_id }
        : await query(`select id from employees where ${employeeMatch === 'email' ? 'lower(work_email) = lower($1)' : 'employee_code = $1'} limit 1`,
            [employeeMatch === 'email' ? r.work_email : r.employee_code]).then((x) => x.rows[0]);
      if (!emp) { errors.push({ row: i + 1, error: 'employee not found' }); continue; }
      const saved = await repo.createAttendance(await derive({ employeeId: emp.id, day: r.day, check_in: r.check_in, check_out: r.check_out,
        break_minutes: r.break_minutes, status: r.status, overtime_hours: r.overtime_hours }, (auth?.roles || [])[0]));
      out.push({ day: toIso(r.day), id: saved.id, worked_hours: saved.worked_hours });
    } catch (e) { errors.push({ row: i + 1, error: e.message }); }
  }
  return { imported: out.length, errors: errors.length, rows: out, errorRows: errors };
}
