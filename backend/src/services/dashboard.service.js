import { toIso, monthLabel, AppError } from '../lib/shared/index.js';
import * as repo from '../repositories/dashboard.repo.js';
import * as timeoffRepo from '../repositories/timeoff.repo.js';
import * as attendanceRepo from '../repositories/attendance.repo.js';
import { query } from '../db/pool.js';

const range = (f) => {
  const anchor = f.month || new Date().toISOString().slice(0, 7);
  return { anchor, from: f.from || `${anchor}-01`,
           to: f.to || null, };
};
/**
 * One call feeds the whole dashboard. Panels are filtered by what the role may see, so an HR manager
 * simply never receives payroll numbers (they are not "hidden client-side").
 */
export async function load(f, { auth }) {
  const { can } = await import('../lib/shared/index.js');
  const r = range(f);
  const [from, to] = await window(r);
  const filters = { from, to, departmentId: f.departmentId || null, employeeType: f.employeeType || null };
  const seesPayroll = can('dashboard:payroll', { roles: auth.roles, permissions: auth.permissions });
  const out = { period: { from, to, label: monthLabel(`${to.slice(0, 7)}-01`), month: r.anchor }, filters, panels: {} };
  if (seesPayroll) {
    const [kpis, byDept, trend, runs, alerts, depts] = await Promise.all([
      repo.salaryKpis(filters), repo.salaryByDepartment(filters), repo.netTrend({ months: 12, departmentId: filters.departmentId }),
      repo.payrunStatusPanel(), repo.payrollAlerts({ from, to }), repo.departmentOverview(),
    ]);
    out.kpis = { net_paid: Number(kpis.net_paid), change_pct: kpis.change_pct, payslips_generated: Number(kpis.payslips),
                payslips_paid: Number(kpis.paid), payslips_pending: Number(kpis.pending), avg_per_employee: Number(kpis.avg_per_employee),
                employees: Number(kpis.employees), gross_paid: Number(kpis.gross_paid), deductions: Number(kpis.deductions),
                employer_cost: Number(kpis.employer_cost) };
    Object.assign(out.panels, { salary_by_department: byDept, net_trend: trend, payruns: runs, alerts, departments: depts });
  }
  const [att, byEmployee, leave] = await Promise.all([
    repo.attendanceOverview({ from, to, departmentId: filters.departmentId }),
    repo.monthlyAttendanceByEmployee({ from, to, limit: 8 }),
    timeoffRepo.timeOffOverview({ from, to, departmentId: filters.departmentId }),
  ]);
  if (!seesPayroll) out.panels.departments = await repo.departmentOverview();
  out.panels.attendance = att;
  out.panels.attendance_by_employee = byEmployee;
  out.panels.time_off = (leave.rows ?? leave).map((x) => ({ type: x.type, unit: x.unit, approved_days: Number(x.approved_days || 0),
    pending: Number(x.pending || 0), remaining_balance: Number(x.remaining_balance || 0) }));
  out.alerts = out.panels.alerts || [];
  out.restricted = !seesPayroll ? 'Payroll figures are hidden for your role' : null;
  return out;
}
async function window(r) {
  const from = r.from;
  const to = r.to || await query(`select (date_trunc('month', $1::date) + interval '1 month - 1 day')::date as d`, [from]).then((x) => toIso(x.rows[0].d));
  return [toIso(from), toIso(to)];
}
export const trend = (f) => repo.netTrend({ months: Number(f.months) || 12, departmentId: f.departmentId || null });
export const attendance = (f) => repo.attendanceOverview({ from: f.from, to: f.to, departmentId: f.departmentId || null });
