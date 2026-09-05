import { toPaise, fromPaise } from '../shared/index.js';
import { eachDay, toIso, addDays, isoDow, daysInMonth } from '../shared/index.js';

/** Hours scheduled for one calendar day, straight off the weekly grid (falls back to Mon–Fri). */
export function dayHours(scheduleDays, holidaySet, day) {
  if (holidaySet?.has(day)) return 0;
  const dow = isoDow(day);
  const row = scheduleDays?.[dow];
  if (!row || row.is_rest_day) return 0;            // no row for that weekday = not a working day
  if (!row.start_time || !row.end_time) return row.hours_per_day != null ? Number(row.hours_per_day) : 0;
  const [sh, sm] = String(row.start_time).split(':').map(Number);
  const [eh, em] = String(row.end_time).split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.max(0, mins / 60 - (Number(row.break_minutes) || 0) / 60);
}
/**
 * Plain start/end/break → hours. Same maths as the SQL `day_hours(time, time, int)` helper, for rows
 * that come straight from working_schedule_days (start_time / end_time / break_minutes).
 */
export function shiftHours(start, end, breakMinutes) {
  if (!start || !end) return 0;
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  let mins = toMin(end) - toMin(start);
  if (mins <= 0) mins += 24 * 60;                       // night shift crossing midnight
  return Math.round(Math.max(0, mins / 60 - (Number(breakMinutes) || 0) / 60) * 100) / 100;
}
/** Expected working days + hours in [from,to] clamped to joining/exit (the SQL helper mirrors this). */
export function expectedDays({ scheduleDays, holidays, from, to, joining, exit }) {
  const holidaySet = new Set(holidays || []);
  const days = eachDay(from, to).filter((d) => {
    if (joining && d < toIso(joining)) return false;
    if (exit && d > toIso(exit)) return false;
    return true;
  });
  let count = 0;
  let hours = 0;
  for (const d of days) {
    const h = dayHours(scheduleDays, holidaySet, d);
    if (h > 0) { count += 1; hours += h; }
  }
  return { days: count, hours: round2(hours), calendarDays: days.length };
}
export function attendanceStats({ rows = [], from, to, expectedHours }) {
  const inRange = rows.filter((a) => toIso(a.day) >= toIso(from) && toIso(a.day) <= toIso(to));
  const s = { present: 0, absent: 0, late: 0, halfDay: 0, onLeave: 0, holiday: 0, overtimeRows: 0,
              workedHours: 0, overtimeHours: 0, missingCheckout: 0, manual: 0, byDay: new Map() };
  for (const a of inRange) {
    s.byDay.set(toIso(a.day), a);
    switch (a.status) {
      case 'PRESENT': s.present += 1; break;
      case 'LATE': s.late += 1; s.present += 1; break;
      case 'OVERTIME': s.overtimeRows += 1; s.present += 1; break;
      case 'HALF_DAY': s.halfDay += 1; s.present += 0.5; break;
      case 'ABSENT': s.absent += 1; break;
      case 'ON_LEAVE': s.onLeave += 1; break;
      case 'HOLIDAY': s.holiday += 1; break;
      default: break;
    }
    s.workedHours += Number(a.worked_hours) || 0;
    if (a.overtime_approved) s.overtimeHours += Number(a.overtime_hours) || 0;
    if (a.check_in && !a.check_out) s.missingCheckout += 1;
    if (a.is_manual) s.manual += 1;
  }
  s.workedHours = round2(s.workedHours);
  s.overtimeHours = round2(s.overtimeHours);
  s.shortfall = round2(Math.max(0, expectedHours - s.workedHours));
  return s;
}
/**
 * Leave days that actually fall inside the payslip period, paid vs unpaid (Loss of Pay).
 * Reads the real time_off_types columns: `unit` (DAYS|HOURS), `is_unpaid`, `sandwich_rule`.
 * A "sandwich" type counts the calendar span, everything else counts only scheduled working days.
 */
export function leaveStats({ requests = [], from, to, expectedDays, typesById = new Map(), scheduleDays, holidays, hoursPerDay = 8 }) {
  const holidaySet = new Set(holidays || []);
  const hasSchedule = scheduleDays && Object.keys(scheduleDays).length > 0;
  const out = { paid: 0, unpaid: 0, sick: 0, compOff: 0, byType: {}, byCode: {}, detail: [] };
  for (const r of requests) {
    if (r.status !== 'APPROVED') continue;
    const start = toIso(r.start_date) < toIso(from) ? toIso(from) : toIso(r.start_date);
    const end = toIso(r.end_date) > toIso(to) ? toIso(to) : toIso(r.end_date);
    if (start > end) continue;
    const t = typesById.get(r.time_off_type_id) || {};
    const span = eachDay(start, end);
    const working = hasSchedule ? span.filter((d) => dayHours(scheduleDays, holidaySet, d) > 0) : span;
    const inHours = t.unit === 'HOURS';
    const statedDays = Number(r.approved_days != null ? r.approved_days : (inHours ? NaN : r.duration));
    let n;
    if (Number.isFinite(statedDays) && statedDays > 0) n = round2(statedDays);
    else if (inHours) n = round2((Number(r.duration) || 0) / (Number(hoursPerDay) || 8));
    else n = round2(t.sandwich_rule ? span.length : working.length);
    if (!n) continue;
    const unpaid = !!t.is_unpaid;
    const label = t.name || t.code || 'LEAVE';
    out.byType[label] = round2((out.byType[label] || 0) + n);
    if (t.code) out.byCode[t.code] = round2((out.byCode[t.code] || 0) + n);
    if (unpaid) out.unpaid = round2(out.unpaid + n); else out.paid = round2(out.paid + n);
    if (t.code === 'SL') out.sick = round2(out.sick + n);
    if (t.code === 'COMP_OFF') out.compOff = round2(out.compOff + n);
    out.detail.push({ id: r.id, type: label, code: t.code || null, days: n, start: toIso(r.start_date), end: toIso(r.end_date),
                      paid: !unpaid, unit: t.unit || 'DAYS', half_day: r.half_day_period || null });
  }
  out.total = round2(out.paid + out.unpaid);
  out.lop = out.unpaid;
  out.encashable = round2(out.total - out.unpaid);
  return out;
}
/**
 * The object a formula sees. Rupees (not paise) — a rule author writes `wage * 0.5`, never `4600000`.
 * Every field is read-only and allowlisted; see @pp360/formula DEFAULT_ALLOW.
 */
export function buildFormulaContext({ employee, contract, period, expected, attendance, leaves, worksheet, inputs, run: runMeta, structure, prior }) {
  const r = (v) => Number(fromPaise(toPaise(v)));
  // Every formula variable has to exist, even on a preview where nobody passed attendance or leave stats:
  // an undefined identifier is a hard error in the expression evaluator, so `overtime_hours > 0` on an
  // empty period would surface as RULE_ERROR instead of simply being false.
  const att = { present: 0, absent: 0, late: 0, halfDay: 0, onLeave: 0, holiday: 0, workedHours: 0, overtimeHours: 0, shortfall: 0, missingCheckout: 0, manual: 0, ...(attendance || {}) };
  const lv = { total: 0, paid: 0, unpaid: 0, lop: 0, sick: 0, compOff: 0, byType: {}, detail: [], ...(leaves || {}) };
  const exp = { days: 0, hours: 0, calendarDays: 0, ...(expected || {}) };
  const ws = {};
  for (const [code, paise] of Object.entries(worksheet || {})) ws[code] = r(paise);
  return {
    worksheet: ws,
    result: 0,
    gross: r(worksheet?.GROSS ?? 0),
    net: 0,
    total_deductions: r(worksheet?.TOTAL_DEDUCTIONS ?? 0),
    wage: r(contract?.wage ?? employee?.basic_salary ?? 0),
    basic: r(contract?.wage ?? employee?.basic_salary ?? 0),
    days: exp.days,
    expected_days: exp.days,
    paid_days: round2(exp.days - lv.lop),
    present_days: round2(att.present),
    absent_days: att.absent,
    leave_days: lv.total,
    unpaid_days: lv.lop,
    lop_days: lv.lop,
    half_days: att.halfDay,
    period_days: exp.calendarDays,
    month_days: daysInMonth(new Date(period.to).getUTCFullYear(), new Date(period.to).getUTCMonth() + 1),
    worked_hours: att.workedHours,
    scheduled_hours: exp.hours,
    overtime_hours: att.overtimeHours,
    overtime_earnings: r(inputs?.overtime_earnings ?? 0),
    allowance: 0,
    bonus: r(inputs?.bonus_amount ?? 0),
    arrear: r(inputs?.arrear_amount ?? 0),
    bonus_rate: Number(inputs?.bonus_rate ?? 0),
    pt: 0,
    tds: r(inputs?.tds ?? 0),
    loan_deduction: r(inputs?.loan_deduction ?? 0),
    professional_tax: 0,
    pf_employee: 0, pf_employer: 0, esi_employee: 0, esi_employer: 0,
    attendance: {
      days: exp.days, present: att.present, absent: att.absent, late: att.late,
      half_days: att.halfDay, on_leave: att.onLeave, worked_hours: att.workedHours,
      overtime_hours: att.overtimeHours, shortfall: att.shortfall,
      missing_checkout: att.missingCheckout, manual_edits: att.manual,
    },
    timeoff: { paid: lv.paid, unpaid: lv.lop, total: lv.total, by_type: lv.byType },
    employee: {
      id: employee.id, code: employee.employee_code, name: employee.name, status: employee.status,
      employee_type: employee.employee_type, job_position: employee.job_position, department: employee.department,
      date_of_joining: toIso(employee.date_of_joining), date_of_exit: employee.date_of_exit ? toIso(employee.date_of_exit) : null,
    },
    contract: {
      id: contract.id, wage: r(contract.wage), start_date: toIso(contract.start_date), end_date: contract.end_date ? toIso(contract.end_date) : null,
      salary_structure: structure?.name ?? null, working_hours_per_week: Number(contract.total_weekly_hours ?? 0),
    },
    inputs: { ...inputs },
    run: {
      period_start: toIso(period.from), period_end: toIso(period.to), period_key: period.key,
      pay_frequency: period.payFrequency, compute_mode: period.computeMode, factor: period.factor,
      is_half_month: !!period.isHalf, half: period.half ?? null,
      payrun_status: runMeta?.status ?? null, payrun_name: runMeta?.name ?? null,
      month_prior_net: r(prior?.month_net ?? 0), month_h1_net: r(prior?.h1_net ?? 0),
    },
    ytd: { net: r(prior?.ytd_net ?? 0), gross: r(prior?.ytd_gross ?? 0), basic: r(prior?.ytd_basic ?? 0), pt: r(prior?.ytd_pt ?? 0),
           pf_employee: r(prior?.ytd_pf ?? 0), esi_employee: r(prior?.ytd_esi ?? 0), bonus: r(prior?.ytd_bonus ?? 0) },
  };
}
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
