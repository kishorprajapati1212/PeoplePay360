import { AppError, toIso, eachDay } from '../lib/shared/index.js';
import * as repo from '../repositories/org.repo.js';
import { query } from '../db/pool.js';
import { transaction } from '../db/tx.js';

// ── departments ───────────────────────────────────────────────────────────────
export const listDepartments = (f) => repo.listDepartments(f);
export const createDepartment = (d) => repo.createDepartment(d);
export const updateDepartment = (id, p) => repo.updateDepartment(id, p);
export async function deleteDepartment(id) {
  const usage = await repo.departmentUsage(id);
  if (Number(usage.employees) > 0) throw new AppError('DEPARTMENT_IN_USE', `${usage.employees} employee(s) are still in this department`, { status: 409, details: usage });
  const done = await repo.deleteDepartment(id);
  if (!done) throw AppError.notFound('Department not found');
  return { ok: true, id };
}
// ── working schedules ─────────────────────────────────────────────────────────
export const listSchedules = (f) => repo.listSchedules(f);
export const getSchedule = (id) => repo.getSchedule(id);
export async function saveSchedule(id, data) {
  if (!data.name) throw AppError.badRequest('Schedule Name is required');
  const days = normaliseDays(data.days);
  const total = days.reduce((a, d) => a + (d.rest ? 0 : dayHours(d)), 0);
  if (total <= 0) throw AppError.badRequest('Add at least one working day with a start and end time');
  if (data.total_weekly_hours != null && Math.abs(Number(data.total_weekly_hours) - total) > 0.01) {
    // the field is derived from the grid; refuse a mismatch instead of silently overwriting the user
    throw AppError.badRequest(`Hours / Week (${data.total_weekly_hours}) does not match the weekly grid (${total.toFixed(2)} h)`, { code: 'SCHEDULE_TOTAL_MISMATCH', details: { grid: +total.toFixed(2), given: Number(data.total_weekly_hours) } });
  }
  const saved = await repo.saveSchedule(id, { ...data, days });
  return saved;
}
/** Hours for one grid row, crossing midnight when needed (22:00→06:00 is 8 h, not −16 h). */
export function dayHours(d) {
  if (!d.start || !d.end) return 0;
  const [sh, sm] = String(d.start).split(':').map(Number);
  const [eh, em] = String(d.end).split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.max(0, mins / 60 - (Number(d.break) || 0) / 60);
}
function normaliseDays(days) {
  if (!Array.isArray(days)) throw AppError.badRequest('Weekly Schedule rows are required');
  const out = [];
  for (const d of days) {
    if (!d) continue;
    const day = Number(d.day ?? d.day_of_week);
    if (!(day >= 1 && day <= 7)) throw AppError.badRequest('Each row needs a weekday between 1 (Monday) and 7 (Sunday)', { code: 'DAY_RANGE' });
    if (out.some((x) => x.day === day)) throw AppError.badRequest('A weekday can only appear once in the grid', { code: 'DAY_DUPLICATE' });
    const rest = !!d.rest || !d.start || !d.end;
    out.push({ day, start: rest ? null : d.start, end: rest ? null : d.end, break: rest ? 0 : (Number(d.break ?? 60) || 0), rest, code: d.code || d.note || null });
  }
  if (!out.length) throw AppError.badRequest('Add at least one day to the weekly grid');
  return out;
}
/**
 * Switch a schedule off without touching its week. A PATCH of the whole row would need the seven days resent,
 * and a screen that reads them back from a list endpoint can easily send a week it did not mean to write.
 */
export async function setScheduleActive(id, on) {
  const row = await repo.setScheduleActive(id, on);
  if (!row) throw AppError.notFound('Schedule not found');
  return { ...row, note: on ? 'Contracts can point at this schedule again.' : 'Still on the records that use it, but nobody can be assigned to it.' };
}
export async function deleteSchedule(id) {
  const usage = await repo.scheduleUsage(id);
  if (Number(usage.employees) || Number(usage.contracts)) throw new AppError('SCHEDULE_IN_USE', 'Reassign the employees on this schedule first', { status: 409, details: usage });
  const done = await repo.deleteSchedule(id);
  if (!done) throw AppError.notFound('Schedule not found');
  return { ok: true, id };
}
// ── holidays ──────────────────────────────────────────────────────────────────
export const listHolidays = (f) => repo.listHolidays(f).then((r) => r.rows);
export const listTemplates = () => repo.listTemplates();
export async function createHoliday(d) {
  const clash = await query(`select id, name from holidays where day = $1`, [d.day]).then((r) => r.rows[0]);
  if (clash) throw new AppError('HOLIDAY_EXISTS', `${toIso(d.day)} already has “${clash.name}”. Edit that one instead.`, { status: 409, details: clash });
  return repo.createHoliday(d);
}
export const updateHoliday = (id, p) => repo.updateHoliday(id, p);
export const deleteHoliday = async (id) => {
  const done = await repo.deleteHoliday(id);
  if (!done) throw AppError.notFound('Holiday not found');
  return { ok: true, id };
};
/**
 * Bulk-generate a year from a template (the "Holidays" screen's helper). Existing days are skipped,
 * never overwritten — HR may have renamed one.
 */
export async function generateHolidays({ year, days, replace = false }) {
  if (!Array.isArray(days) || !days.length) throw AppError.badRequest('Provide the holiday list for the year');
  const existing = new Map((await listHolidays({ year })).map((h) => [toIso(h.day), h]));
  const created = []; const skipped = [];
  await transaction(async (client) => {
    for (const d of days) {
      const day = toIso(d.day ?? d.date);
      if (!day) { skipped.push({ day, reason: 'invalid date' }); continue; }
      if (existing.has(day)) {
        if (!replace) { skipped.push({ day, name: existing.get(day).name, reason: 'already exists' }); continue; }
        await client.query(`delete from holidays where day = $1`, [day]);
      }
      await client.query(`insert into holidays (day, name, type, year, note) values ($1,$2,coalesce($3,'PUBLIC'),$4,$5)`,
        [day, d.name || `Holiday ${day}`, d.type || 'PUBLIC', +day.slice(0, 4), d.note || null]);
      created.push({ day, name: d.name });
    }
  });
  return { year, created: created.length, skipped: skipped.length, createdRows: created, skippedRows: skipped };
}
