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
  // In a half-month run every slice is computed on its own, so a fixed amount that is deliberately not
  // pro-rated ("₹1,000 a month") lands in BOTH halves unless the rule is marked once-per-month.
  if (period?.half) {
    const monthly = (rules || []).filter((r) => r.active !== false && !r.pro_rata && r.computation_type === 'FIXED'
      && r.evaluation_period !== 'MONTH_ONCE' && Number(r.amount) > 0 && !r.statutory && r.evaluation_period !== 'PERIOD');
    for (const r of monthly) push('WARN', 'HALF_MONTH_MONTHLY_RULE', `${r.name} is a fixed monthly amount on a half-month run: it pays in each half unless its evaluation window is "month once".`);
  }
  return out;
}
