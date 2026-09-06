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
/** Kiosk/self clock: one row per employee-day, a session list underneath (in → out → in → out …). */
const sessionsOf = (row) => {
  const list = Array.isArray(row?.punches) ? row.punches : [];
  return list.filter((s) => s && s.in).map((s) => ({ in: s.in, out: s.out || null }));
};
/** Worked time is the sum of the closed sessions plus the open one so far — never the span, so a
 *  lunch break between two punches is not paid as work. */
const sessionMinutes = (punches, now = new Date()) => {
  let mins = 0;
  for (const s of sessionsOf({ punches })) {
    const from = new Date(s.in).getTime();
    const to = s.out ? new Date(s.out).getTime() : now.getTime();
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) mins += (to - from) / 60000;
  }
  return mins;
};
export async function clock(input = {}, { auth }) {
  const id = input.employeeId ?? input.employee_id ?? auth?.employeeId;
  const at = input.at;
  if (!id) throw AppError.badRequest('No employee linked to this account', { code: 'NO_PROFILE' });
  const now = at ? new Date(at) : new Date();
  const day = toIso(now);
  const existing = await repo.byEmployeeDay(id, day);
  const sessions = sessionsOf(existing);
  const openIndex = sessions.findIndex((s) => !s.out);
  // A row that predates the session list still counts as one session, so legacy days punch forward fine.
  if (existing && !sessions.length && existing.check_in) sessions.push({ in: existing.check_in, out: existing.check_out || null });

  if (!existing) {
    const punches = [{ in: now.toISOString(), out: null }];
    const derived = await derive({ employeeId: id, day, check_in: now.toISOString(), status: 'PRESENT', punches }, (auth.roles || [])[0]);
    const created = await repo.createAttendance({ ...derived, punches });
    return { action: 'IN', at: created.check_in, record: await repo.getAttendance(created.id) };
  }
  if (openIndex >= 0) {
    // Punch OUT: close the open session, then recompute the day from the session list.
    sessions[openIndex].out = now.toISOString();
    const worked = Math.round((sessionMinutes(sessions) / 60) * 100) / 100;
    const brk = existing.break_minutes != null ? Number(existing.break_minutes) : (worked > 6 ? 60 : 0);
    const net = Math.max(0, Math.round((worked - brk / 60) * 100) / 100);
    const expected = Number(existing.expected_hours || 0);
    const overtime = expected > 0 ? Math.round(Math.max(0, net - expected) * 100) / 100 : 0;
    const status = overtime > 0 ? 'OVERTIME' : (expected > 0 && net >= expected * 0.45 && net < expected * 0.6 ? 'HALF_DAY' : 'PRESENT');
    const saved = await repo.updateAttendance(existing.id, {
      punches: sessions, check_in: sessions[0].in, check_out: sessions[sessions.length - 1].out,
      worked_hours: worked, net_worked_hours: net, overtime_hours: overtime, status: existing.status === 'HOLIDAY' ? 'HOLIDAY' : status,
      _editor: auth.userId,
    });
    return { action: 'OUT', at: saved.check_out, record: await repo.getAttendance(existing.id) };
  }
  // Punch IN again after a finished stretch (lunch, a second shift): append a new open session.
  sessions.push({ in: now.toISOString(), out: null });
  const worked = Math.round((sessionMinutes(sessions) / 60) * 100) / 100;
  const saved = await repo.updateAttendance(existing.id, {
    punches: sessions, check_in: sessions[0].in, check_out: null,
    worked_hours: worked, status: 'PRESENT', _editor: auth.userId,
  });
  return { action: 'IN', at: sessions[sessions.length - 1].in, record: await repo.getAttendance(existing.id) };
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
