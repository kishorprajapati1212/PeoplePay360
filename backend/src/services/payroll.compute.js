import { toIso, addDays, daysInMonth, toPaise, fromPaise, AppError } from '../lib/shared/index.js';
import { settingsFrom, expectedDays, attendanceStats, leaveStats, computePayslip, resolvePeriod, scaleToNet, trueUp, byCode, netOf, payslipWarnings } from '../lib/payroll/index.js';
import * as employeeRepo from '../repositories/employee.repo.js';
import * as contractRepo from '../repositories/contract.repo.js';
import * as payslipRepo from '../repositories/payslip.repo.js';
import * as attendanceRepo from '../repositories/attendance.repo.js';
import * as timeoffRepo from '../repositories/timeoff.repo.js';
import * as salaryRepo from '../repositories/salary.repo.js';
import * as orgRepo from '../repositories/org.repo.js';
import { logger } from '../logger.js';

const INPUT_MAP = { BONUS: 'bonus_amount', BONUS_RATE: 'bonus_rate', ARREAR: 'arrear_amount', TDS: 'tds',
                   LOAN: 'loan_deduction', OT_MULTIPLIER: 'ot_multiplier', OT_WAGE: 'ot_wage', LOP_DAYS: 'lop_days' };
const asRupees = (v) => Number(fromPaise(toPaise(v)));

/**
 * Compute ONE payslip. Split out from the payrun loop so the same code serves:
 *   • the payrun batch        • the payslip screen's COMPUTE button
 *   • the rule editor's preview (persist = false)
 */
export async function computeOne({ payslip, payrun, company, structure, rules, ptSlabs, persist = true, q = null, actorUserId = null }) {
  const employee = await employeeRepo.getEmployee(payslip.employee_id);
  if (!employee) throw AppError.notFound('Employee not found');
  const from = toIso(payslip.period_start), to = toIso(payslip.period_end);
  const monthAnchor = toIso(payslip.month_anchor || from);
  const monthFrom = monthAnchor, monthTo = `${monthAnchor.slice(0, 7)}-${String(daysInMonth(+monthAnchor.slice(0, 4), +monthAnchor.slice(5, 7))).padStart(2, '0')}`;
  const contract = payslip.contract_id
    ? await contractRepo.getContract(payslip.contract_id)
    : await contractRepo.contractForPeriod(employee.id, from, to);
  if (!contract) throw AppError.unprocessable(`No contract covers ${from} → ${to}`, { code: 'NO_CONTRACT', employee: employee.name });

  const scheduleId = contract.working_schedule_id || employee.working_schedule_id || null;
  const [scheduleDays, holidays, attRows, requests, types, inputs, arrears, settingsRow] = await Promise.all([
    scheduleId ? orgRepo.scheduleDaysFor([scheduleId]) : Promise.resolve([]),
    (await import('../db/pool.js')).rows(`select day from holidays where day between $1 and $2`, [monthFrom, monthTo]).catch(() => []),
    (await import('../db/pool.js')).rows(`select * from attendance where employee_id = $1 and day between $2 and $3`, [employee.id, monthFrom, monthTo]).catch(() => []),
    timeoffRepo.listRequests({ employeeId: employee.id, from: monthFrom, to: monthTo, statuses: ['APPROVED'], limit: 200 }),
    timeoffRepo.listTypes({ includeInactive: true }),
    payslipRepo.listInputs(payslip.id, q),
    payslipRepo.pendingArrears(employee.id, monthAnchor, q),
    Promise.resolve(company),
  ]);
  const scheduleDaysByDow = Object.fromEntries((scheduleDays || []).map((d) => [Number(d.day_of_week), {
    start_time: d.start_time, end_time: d.end_time, break_minutes: d.break_minutes, is_rest_day: d.is_rest_day,
  }]));
  const holidayList = (holidays || []).map((h) => toIso(h.day));
  /* A period that has not ENDED yet pays only what has been earned so far. The whole engine measures a
     slice of days; clamping the slice to today reuses every existing rule (mid-month joiners already go
     through this exact path), so a run computed on the 6th pays the elapsed working days — not a full
     month for an employee who has attended four of them. The warning below says it in words, and the
     numbers are final only after a recompute at period end. */
  const todayIso = toIso(new Date());
  const periodOver = toIso(to) < todayIso;
  const earnedTo = periodOver ? toIso(to) : (toIso(from) > todayIso ? toIso(from) : todayIso);
  const inProgress = !periodOver && toIso(from) <= todayIso;
  const monthExpected = expectedDays({ scheduleDays: scheduleDaysByDow, holidays: holidayList, from: monthFrom, to: monthTo, joining: employee.date_of_joining, exit: employee.date_of_exit });
  const sliceExpected = expectedDays({ scheduleDays: scheduleDaysByDow, holidays: holidayList, from, to: earnedTo, joining: employee.date_of_joining, exit: employee.date_of_exit });
  const isWholeMonth = toIso(from) === monthFrom && toIso(to) === monthTo;
  const stats = attendanceStats({ rows: attRows || [], from, to: earnedTo, expectedHours: monthExpected.hours });
  const typesById = new Map((types?.rows || types || []).map((t) => [t.id, t]));
  const leaves = leaveStats({ requests: (requests?.rows || requests || []), from, to: earnedTo, expectedDays: sliceExpected.days, typesById,
    scheduleDays: scheduleDaysByDow, holidays: holidayList, hoursPerDay: Number(settingsRow?.default_hours_per_day) || 8 });
  // A mid-month joiner/leaver is prorated even on monthly payroll — that is what expected_days clamping is
  // for. The denominator has to be the WHOLE month: monthExpected is already clamped to the employee's
  // service dates, so comparing the slice against it yields factor 1 and a 13-day first month gets paid as a
  // full month. monthBase is the unclamped month, which is also the divisor overtime and LOP maths expect.
  const monthBase = expectedDays({ scheduleDays: scheduleDaysByDow, holidays: holidayList, from: monthFrom, to: monthTo });
  const clamped = monthBase.calendarDays !== sliceExpected.calendarDays || monthBase.days !== sliceExpected.days;
  const settings = settingsFrom(settingsRow || {});
  const payFrequency = payrun?.pay_frequency || 'MONTHLY';
  const computeMode = payrun?.compute_mode || 'PRO_RATA';
  const half = payslip.payslip_kind === 'HALF_FIRST' ? 'FIRST' : payslip.payslip_kind === 'HALF_SECOND' ? 'SECOND' : null;
  const monthKey = monthAnchor.slice(0, 7);
  const factor = isWholeMonth && !clamped ? 1 : (monthBase.days > 0 ? Math.round((sliceExpected.days / monthBase.days) * 1e6) / 1e6 : 0);
  const period = resolvePeriod({
    payFrequency: half ? (half === 'FIRST' ? 'HALF_MONTH_FIRST' : 'HALF_MONTH_SECOND') : payFrequency,
    from, to, key: payslip.period_key, computeMode, settings,
    month: { expectedDays: monthBase.days, hours: monthExpected.hours, from: monthFrom, to: monthTo, clamped },
    slice: { expectedDays: sliceExpected.days, hours: sliceExpected.hours, calendarDays: sliceExpected.calendarDays },
  });
  period.factor = half ? factor : (clamped ? factor : 1);
  period.half = half;
  period.monthEquivalent = null;
  period.monthFrom = monthFrom;
  period.monthTo = monthTo;
  period.priorLop = { lop_days: leaves.lop, expected_days: sliceExpected.days };

  const inputsMap = {};
  for (const i of inputs || []) { const key = INPUT_MAP[i.code] || i.code.toLowerCase(); inputsMap[key] = asRupees(i.amount); }
  const prior = await payslipRepo.priorTotals(employee.id, { monthAnchor, fyFrom: fyStart(monthAnchor, settings.fyStartMonth), fyTo: `${settings.fyStartMonth === 1 ? +monthAnchor.slice(0, 4) : +monthAnchor.slice(0, 4) + 1}-12-31`, excludePayslipId: payslip.id, monthKey }, q);
  const baseArgs = { employee, contract, structure, rules, ptSlabs, settings, inputs: inputsMap, arrears, leaves, attendance: stats, prior, period };
  const warnings = [];
  if (!periodOver) {
    warnings.push({ severity: 'WARN', code: 'PERIOD_IN_PROGRESS',
      message: toIso(from) > todayIso
        ? 'This period has not started yet — nothing has been earned, so every pro-rata line is zero. Recompute after the period begins.'
        : `This period is still running: computed up to ${todayIso} (${sliceExpected.days} of ${expectedDays({ scheduleDays: scheduleDaysByDow, holidays: holidayList, from, to: monthTo, joining: employee.date_of_joining, exit: employee.date_of_exit }).days} expected working days so far in the month). The number is an advance, not the month's final pay — recompute at period end.` });
  }
  let result;
  try {
    if (half) {
      // BOTH halves are settled against one shared whole-month basis, otherwise H1 + H2 drifts by exactly
      // the rules that behave differently in a half (PT on a chosen slice, MONTH_ONCE bonuses, annual caps).
      // The basis clears the *month* accumulators from `prior` (the advance already paid them) but keeps the
      // FY totals, so caps stay honest while nothing gets skipped as "already charged this month".
      const basisPeriod = { ...period, factor: 1, isHalf: false, half: null, payFrequency: 'MONTHLY', computeMode: 'PRO_RATA',
                            expectedSliceDays: monthExpected.days, expectedSliceHours: monthExpected.hours,
                            expectedMonthDays: monthExpected.days, expectedMonthHours: monthExpected.hours };
      const basisPrior = { ...prior, by_rule_month: {}, month_codes: [], month_gross: 0, month_net: 0, h1_net: 0 };
      const monthRun = computePayslip({ ...baseArgs, period: basisPeriod, prior: basisPrior });
      const keep = monthRun.lines.filter((l) => l.line_kind !== 'REPORT');
      if (half === 'FIRST' && computeMode === 'ADVANCE_50') {
        const target = Math.round(monthRun.totals.net * (settings.advancePct ?? 50) / 100);
        const { lines: scaled } = scaleToNet(keep, target, { note: `advance ${settings.advancePct}% of month-equivalent net ₹${fromPaise(monthRun.totals.net)}` });
        const merged = fillReportLines(scaled);
        result = { lines: merged, totals: totalsFrom(merged), warnings: monthRun.warnings, meta: monthRun.meta, context: monthRun.context };
        result.meta.computation_summary = { ...(monthRun.meta.computation_summary || {}), mode: 'ADVANCE_50', advancePct: settings.advancePct,
          monthEquivalentNet: Number(fromPaise(monthRun.totals.net)), factor: period.factor,
          note: 'First half pays an advance percentage of the whole month; the second half settles up.' };
      } else {
        const sibling = await payslipRepo.siblingHalf(employee.id, { monthKey, excludePayslipId: payslip.id }, q);
        const h1ByCode = sibling?.byCode || {};
        const h1Net = sibling?.netPaise ?? 0;
        const { lines: settled, residual } = trueUp({ monthLines: keep, h1ByCode, h1Net, monthNet: monthRun.totals.net,
                                                     sequenceAfter: Math.max(...monthRun.lines.map((l) => l.sequence || 0), 0) });
        const merged = fillReportLines(settled);
        result = { lines: merged, totals: totalsFrom(merged), warnings: monthRun.warnings, meta: monthRun.meta, context: monthRun.context };
        result.meta.computation_summary = { ...(monthRun.meta.computation_summary || {}), mode: 'H2_TRUE_UP', h1Paid: Number(fromPaise(h1Net)),
          monthEquivalentNet: Number(fromPaise(monthRun.totals.net)), h2Net: Number(fromPaise(totalsFrom(merged).net)),
          trueUpResidual: Number(fromPaise(residual)), factor: period.factor,
          note: 'Second half = whole-month computation minus what the first half actually paid.' };
      }
    } else {
      result = computePayslip({ ...baseArgs, period });
    }
  } catch (e) {
    if (e.message === 'NO_CONTRACT') throw AppError.unprocessable('No contract covers this period', { code: 'NO_CONTRACT' });
    throw e;
  }
  result.warnings = [...(result.warnings || []), ...warnings, ...payslipWarnings({ employee, contract, period, attendance: stats, leaves, totals: result.totals, rules, inputs: inputsMap, structure })];
  const ytd = { ytd_gross: Number(fromPaise(prior.ytd_gross + result.totals.gross)), ytd_deductions: Number(fromPaise(prior.ytd_deductions + result.totals.deductions)), ytd_net: Number(fromPaise(prior.ytd_net + result.totals.net)) };
  const meta = { ...result.meta, status: 'COMPUTED',
    computation_summary: { ...(result.meta.computation_summary || {}),
      warnings: result.warnings.map((w) => ({ code: w.code, severity: w.severity, message: w.message, rule: w.rule || null })),
      contract: { id: contract.id, number: contract.contract_number, wage: Number(contract.wage), start: toIso(contract.start_date), end: contract.end_date ? toIso(contract.end_date) : null },
      attendance: { worked_hours: stats.workedHours, overtime_hours: stats.overtimeHours, absent: stats.absent, missing_checkout: stats.missingCheckout },
      leave: leaves.byType },
    ...ytd,
    expected_working_days: sliceExpected.days, paid_days: Math.max(0, sliceExpected.days - (leaves.lop || 0) - (stats.absent || 0)),
    worked_days: Math.round(stats.present + stats.onLeave), half_days: stats.halfDay, leave_days: leaves.total,
    unpaid_leave_days: leaves.lop, absent_days: stats.absent, holiday_days: stats.holiday,
    worked_hours: stats.workedHours, overtime_hours: stats.overtimeHours, pro_rata_factor: period.factor };
  if (persist) {
    await payslipRepo.saveComputation(payslip.id, { meta, totals: totalsRupees(result.totals), lines: result.lines, documentVersion: (payslip.document_version || 1) + (payslip.status !== 'DRAFT' ? 1 : 0) }, q);
    if (arrears?.length) await payslipRepo.markArrearsApplied(arrears.map((a) => a.id), q);
  }
  return { payslipId: payslip.id, employeeId: employee.id, employeeName: employee.name, lines: result.lines, meta,
           totals: totalsRupees(result.totals), warnings: result.warnings, context: result.context, period };
}
/** GROSS / NET / TOTAL_DEDUCTIONS are echoes of the other lines, so they are refilled after any scaling. */
function fillReportLines(lines) {
  const t = totalsFrom(lines);
  return lines.map((l) => {
    if (l.line_kind !== 'REPORT') return l;
    if (l.category === 'GROSS' || l.rule_code === 'GROSS') return { ...l, amount: t.gross };
    if (l.category === 'NET' || l.rule_code === 'NET') return { ...l, amount: t.net };
    if (l.rule_code === 'TOTAL_DEDUCTIONS') return { ...l, amount: t.deductions };
    return l;
  });
}
function totalsFrom(lines) {
  const gross = lines.filter((l) => l.line_kind === 'EARNING').reduce((a, l) => a + l.amount, 0);
  const deductions = lines.filter((l) => l.line_kind === 'DEDUCTION').reduce((a, l) => a + l.amount, 0);
  const adjustments = lines.filter((l) => l.line_kind === 'ADJUSTMENT').reduce((a, l) => a + l.amount, 0);
  const employerCost = gross + lines.filter((l) => l.line_kind === 'REPORT' && /EMPLOYER/.test(l.rule_code)).reduce((a, l) => a + l.amount, 0);
  const taxableGross = lines.filter((l) => l.line_kind === 'EARNING' && l.is_taxable !== false).reduce((a, l) => a + l.amount, 0);
  const visible = lines.filter((l) => l.in_report !== false && l.line_kind !== 'REPORT');
  return { gross, deductions, adjustments, net: gross - deductions + adjustments, employerCost, taxableGross,
           reportGross: visible.filter((l) => l.line_kind === 'EARNING').reduce((a, l) => a + l.amount, 0),
           reportDeductions: visible.filter((l) => l.line_kind === 'DEDUCTION').reduce((a, l) => a + l.amount, 0) };
}
const totalsRupees = (t) => ({ gross: t.gross / 100, deductions: t.deductions / 100, adjustments: t.adjustments / 100, net: t.net / 100,
  employerCost: (t.employerCost ?? t.gross) / 100, taxableGross: (t.taxableGross ?? 0) / 100,
  reportGross: (t.reportGross ?? 0) / 100, reportDeductions: (t.reportDeductions ?? 0) / 100 });
const fyStart = (monthAnchor, startMonth) => {
  const y = +monthAnchor.slice(0, 4);
  const m = +monthAnchor.slice(5, 7);
  const fyYear = m >= startMonth ? y : y - 1;
  return `${fyYear}-${String(startMonth).padStart(2, '0')}-01`;
};
export const computeStructureFor = async (structureId, { at } = {}) => {
  const [structure, rules, company, ptSlabs] = await Promise.all([
    salaryRepo.getStructure(structureId), salaryRepo.rulesOfStructure(structureId, { at }),
    (await import('../repositories/company.repo.js')).getCompany(), salaryRepo.ptSlabs(),
  ]);
  if (!structure) throw AppError.notFound('Salary structure not found');
  if (!rules.length) throw AppError.unprocessable('This structure has no rules yet', { code: 'STRUCTURE_EMPTY' });
  return { structure, rules, company, ptSlabs };
};
export { logger };
