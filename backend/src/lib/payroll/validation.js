import { toPaise, round2p, toIso } from '../shared/index.js';

/**
 * Warnings worth a red badge on the payrun (the mockup shows "⚠ 1 warning" per run and a
 * warning column per payslip). Deliberately non-blocking, except NO_CONTRACT which cannot compute.
 */
export function payslipWarnings({ employee, contract, period, attendance, leaves, totals, rules, inputs = {}, structure }) {
  const out = [];
  const push = (severity, code, message, extra = {}) => out.push({ severity, code, message, ...extra });
  if (!contract) push('ERROR', 'NO_CONTRACT', 'No contract covers this period — the payslip cannot be computed.');
  else {
    if (toPaise(contract.wage) <= 0) push('WARN', 'ZERO_WAGE', 'Contract wage is 0, so the payslip comes out empty.');
    if (contract.end_date && toIso(contract.end_date) < toIso(period.to)) {
      push('WARN', 'CONTRACT_ENDS_MID_PERIOD', `Contract ends ${toIso(contract.end_date)}; days after that are unpaid.`);
    }
  }
  if (!structure) push('WARN', 'NO_STRUCTURE', 'Employee has no salary structure attached to the contract.');
  if (!rules?.length) push('ERROR', 'STRUCTURE_EMPTY', 'The salary structure has no rules.');
  if (period.expectedSliceDays === 0) push('WARN', 'NO_EXPECTED_DAYS', '0 expected days in this period (schedule gap, holiday, or the employee had not joined yet).');
  if (attendance?.missingCheckout > 0) push('WARN', 'MISSING_PUNCH', `${attendance.missingCheckout} day(s) have a check-in but no check-out — worked hours may be understated.`);
  if (attendance?.manual > 0) push('INFO', 'MANUAL_ATTENDANCE', `${attendance.manual} attendance row(s) were entered manually for this period.`);
  if ((leaves?.lop ?? 0) > 0) push('INFO', 'LOP_APPLIED', `${leaves.lop} unpaid leave day(s) reduced the pay.`, { days: leaves.lop });
  if (employee?.bank_account_number == null || String(employee.bank_account_number).trim() === '') push('WARN', 'MISSING_BANK', 'No bank account on file — the salary register will flag this employee.');
  if (employee?.pan_number == null || String(employee.pan_number).trim() === '') push('WARN', 'MISSING_PAN', 'PAN is missing; the annual payslip is still generated but the tax report will be incomplete.');
  if (toPaise(totals.net) < 0) push('WARN', 'NEGATIVE_NET', `Net pay is negative (₹${round2p(totals.net)}) and will be carried to the next run as an arrear.`, { amountPaise: toPaise(totals.net) });
  if (inputs.arrears_applied) push('INFO', 'ARREAR_APPLIED', `₹${round2p(inputs.arrears_applied)} carried in from earlier periods.`);
  return out;
}
/** One line per employee in the payrun "select employees" table (the mockup's 1–22 / 22 grid). */
export function previewRow({ employee, contract, period, attendance, totals, warnings }) {
  return {
    employee_id: employee.id, employee: employee.name, employee_code: employee.employee_code, department: employee.department,
    working_hours: attendance?.workedHours ?? 0, expected_hours: period.expectedSliceHours ?? 0,
    start_date: employee.date_of_joining, wages: round2p(toPaise(contract?.wage ?? 0)),
    net: round2p(totals?.net ?? 0), warnings: warnings.length,
    has_error: warnings.some((w) => w.severity === 'ERROR'),
  };
}
