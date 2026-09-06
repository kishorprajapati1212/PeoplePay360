import { AppError, toIso, monthLabel, fmtDate } from '../lib/shared/index.js';
import * as employeeRepo from '../repositories/employee.repo.js';
import * as payslipRepo from '../repositories/payslip.repo.js';
import * as attendanceRepo from '../repositories/attendance.repo.js';
import * as timeoffRepo from '../repositories/timeoff.repo.js';
import * as contractRepo from '../repositories/contract.repo.js';
import { query } from '../db/pool.js';

/** The employee's own home screen: last payslip, this month's attendance, leave balance, pending requests. */
export async function summary(employeeId, { month } = {}) {
  const employee = await employeeRepo.getEmployee(employeeId);
  if (!employee) throw AppError.notFound('Employee profile not found');
  const anchor = month || new Date().toISOString().slice(0, 7);
  const from = `${anchor}-01`;
  const y = Number(anchor.slice(0, 4)); const mo = Number(anchor.slice(5, 7));
  const to = `${anchor.slice(0, 7)}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;   // last day of that month
  const [payslips, att, balances, requests, contract, pending, todayRow, slipStats] = await Promise.all([
    payslipRepo.listPayslips({ employeeId, status: 'PAID', limit: 6 }), // released payslips only — approval comes before visibility
    attendanceRepo.monthlySummary(employeeId, from, to),
    timeoffRepo.balancesFor(employeeId),
    timeoffRepo.listRequests({ employeeId, limit: 10 }),
    contractRepo.contractForPeriod(employeeId, from, to),
    query(`select count(*) as n from time_off_requests where employee_id = $1 and status = 'TO_APPROVE'`, [employeeId]).then((r) => Number(r.rows[0].n)),
    attendanceRepo.listAttendance({ employeeId, day: toIso(new Date()), limit: 1 }).then((r) => r.rows[0] || null),
    // the stat card numbers (count / paid / YTD) — the list above is capped at six, so counting it would lie
    query(`select count(*) as payslips, count(*) filter (where status = 'PAID') as paid,
                  coalesce(sum(net_amount) filter (where status = 'PAID' and period_end <= current_date), 0) as ytd_net
             from payslips where employee_id = $1`, [employeeId]).then((r) => r.rows[0]),
  ]);
  const last = payslips.rows.find((p) => p.status === 'PAID') || payslips.rows[0] || null;
  return {
    employee: { id: employee.id, name: employee.name, code: employee.employee_code, email: employee.work_email, job_position: employee.job_position,
                department: employee.department, location: employee.work_location, joining: employee.date_of_joining, status: employee.status,
                bank: employee.bank_account_number ? `••••${String(employee.bank_account_number).slice(-4)}` : null, hours_week: employee.total_weekly_hours },
    period: { month: anchor, label: monthLabel(`${anchor}-01`), from, to },
    contract: contract ? { wage: Number(contract.wage), start: toIso(contract.start_date), end: contract.end_date ? toIso(contract.end_date) : null, status: contract.status, structure: contract.salary_structure_id } : null,
    // Everything the portal's "last payslip" card prints — the card used to read fields this object
    // never had (net_amount, worked_days, …), so it always fell back to "no payslip yet".
    last_payslip: last ? { id: last.id, period: last.period_key, period_key: last.period_key, net: Number(last.net_amount), net_amount: Number(last.net_amount),
                gross: Number(last.gross_amount), gross_amount: Number(last.gross_amount), total_deductions: Number(last.total_deductions || 0),
                worked_days: Number(last.worked_days || 0), overtime_hours: Number(last.overtime_hours || 0),
                document_version: Number(last.document_version || 1), paid_on: last.released_at || last.paid_at, status: last.status, has_pdf: !!last.pdf_hash } : null,
    attendance: { ...att, expected_days: await query(`select expected_days($1, $2, $3) as d`, [employeeId, from, to]).then((r) => Number(r.rows[0].d)) },
    leave_balances: (balances || []).map((b) => ({ id: b.id, type: b.type, code: b.type_code, allocated: Number(b.allocated_days), taken: Number(b.taken_days),
                pending: Number(b.pending_days), remaining: Number(b.remaining_days), unit: b.unit, windows: Number(b.windows || 1),
                valid_until: b.valid_until ? toIso(b.valid_until) : null })),
    requests: (requests.rows || []).map((r) => ({ id: r.id, type: r.type, from: toIso(r.start_date), to: toIso(r.end_date), days: Number(r.duration), status: r.status, approver: r.approver })),
    pending_approvals: pending,
    stats: { payslips: Number(slipStats?.payslips || 0), paid: Number(slipStats?.paid || 0), ytd_net: Number(slipStats?.ytd_net || 0) },
    // Today's punches for the check-in / check-out card: sessions, first in, last out, worked hours.
    today_attendance: todayRow ? {
      id: todayRow.id, day: toIso(todayRow.day), status: todayRow.status,
      punches: Array.isArray(todayRow.punches) ? todayRow.punches.filter((s) => s && s.in) : [],
      check_in: todayRow.check_in, check_out: todayRow.check_out,
      worked_hours: Number(todayRow.worked_hours || 0), net_worked_hours: Number(todayRow.net_worked_hours || 0),
      break_minutes: Number(todayRow.break_minutes || 0), overtime_hours: Number(todayRow.overtime_hours || 0),
    } : null,
  };
}
export const myPayslips = (employeeId, f = {}) => payslipRepo.listPayslips({ ...f, employeeId });
export const myAttendance = (employeeId, { month }) => {
  const from = `${month || new Date().toISOString().slice(0, 7)}-01`;
  return attendanceRepo.listAttendance({ employeeId, month: from.slice(0, 7), limit: 62 });
};
export const myContracts = (employeeId) => contractRepo.contractsOf(employeeId);
export const myTimeOff = (employeeId) => timeoffRepo.listRequests({ employeeId, limit: 50 });
/** Per-type totals — see balancesFor() for why the raw window rows are not what a person should read. */
export const myBalances = (employeeId) => timeoffRepo.balancesFor(employeeId);
export const myCalendar = async (employeeId, { month }) => {
  const anchor = month || new Date().toISOString().slice(0, 7);
  const rows = await attendanceRepo.listAttendance({ employeeId, month: anchor, limit: 62 });
  const holidays = await query(`select day, name, type from holidays where to_char(day,'YYYY-MM') = $1 order by day`, [anchor]).then((r) => r.rows);
  const byDay = new Map(rows.rows.map((r) => [toIso(r.day), r]));
  const holidayBy = new Map(holidays.map((h) => [toIso(h.day), h]));
  const monthEnd = new Date(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), 0);
  const lastDay = `${anchor.slice(0, 7)}-${String(monthEnd.getDate()).padStart(2, '0')}`;
  const days = await query(`select d::date as day, extract(isodow from d)::int as dow,
                                   day_hours(ws.start_time, ws.end_time, ws.break_minutes) as scheduled
                            from generate_series($1::date, $2::date, '1 day') d
                            left join employees e on e.id = $3
                            left join working_schedules w on w.id = coalesce((select working_schedule_id from contracts c
                                              where c.employee_id = e.id order by c.is_primary desc nulls last limit 1), e.working_schedule_id)
                            left join working_schedule_days ws on ws.schedule_id = w.id and ws.day_of_week = extract(isodow from d)::int
                            order by d`, [`${anchor}-01`, lastDay, employeeId]).then((r) => r.rows);
  return { month: anchor, days: days.map((d) => {
    const key = toIso(d.day); const a = byDay.get(key); const h = holidayBy.get(key);
    return { date: key, dow: Number(d.dow), scheduled_hours: Number(d.scheduled || 0),
             holiday: h ? { name: h.name, type: h.type } : null,
             attendance: a ? { id: a.id, status: a.status, check_in: a.check_in, check_out: a.check_out, worked_hours: Number(a.worked_hours || 0), overtime_hours: Number(a.overtime_hours || 0) } : null };
  }) };
};
