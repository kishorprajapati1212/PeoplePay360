/**
 * Statutory components are data-driven: each resolver reads its numbers from company_settings /
 * pt_slabs, and writes a human-readable `computation_log` so a payroller can audit the payslip.
 * Any of them is bypassed the moment an admin puts a FORMULA in the matching rule.
 */
import { toPaise, mulPct, clampRange } from '../shared/index.js';

const R = (v) => Math.round(Number(v) || 0);
/** paise → "1234.56" for the audit log (a log that reads ₹50000 is suspicious next to ₹50000.00). */
const fmt = (paise) => (Math.round(Number(paise) || 0) / 100).toFixed(2);

const skip = (log) => ({ paise: 0, log, skipped: true });

/** Provident Fund — 12% of the PF-eligible wage, capped at the statutory ceiling. */
export function pfEmployee({ contract, settings, period }) {
  if (!settings.pf.enabled) return skip('PF disabled for this company');
  const eligible = clampRange(toPaise(contract?.wage ?? 0), 0, settings.pf.wageCeiling);
  const raw = mulPct(eligible, settings.pf.employeePct);
  const paise = period.factor != null && period.factor < 1 && period.prorateStatutory !== false
    ? Math.round(raw * period.factor) : raw;
  const capped = toPaise(contract?.wage ?? 0) > settings.pf.wageCeiling;
  return {
    paise, base: eligible, quantity: settings.pf.employeePct,
    log: `${settings.pf.employeePct}% of ₹${fmt(eligible)}${capped ? ` (ceiling applied: wage ₹${fmt(toPaise(contract.wage))})` : ''}`
       + (paise !== raw ? ` × factor ${period.factor.toFixed(4)} = ₹${fmt(paise)}` : ''),
  };
}
export function pfEmployer(a) {
  const e = pfEmployee(a);
  if (e.skipped) return e;
  const paise = mulPct(e.base, a.settings.pf.employerPct);
  return { paise, base: e.base, quantity: a.settings.pf.employerPct, reportOnly: true, log: `Employer PF ${a.settings.pf.employerPct}% of ₹${fmt(e.base)} (not deducted from net)` };
}
/** ESI — only while the wage is at or under the limit; employee and employer use separate rates. */
export function esiEmployee({ contract, settings, period }) {
  if (!settings.esi.enabled) return skip('ESI disabled for this company');
  const wage = toPaise(contract?.wage ?? 0);
  if (wage > settings.esi.wageLimit) return skip(`ESI not applicable: wage ₹${fmt(wage)} exceeds ₹${fmt(settings.esi.wageLimit)}`);
  const raw = mulPct(wage, settings.esi.employeePct);
  return { paise: period.factor < 1 ? Math.round(raw * period.factor) : raw, base: wage, quantity: settings.esi.employeePct,
           log: `ESI ${settings.esi.employeePct}% of ₹${fmt(wage)} (limit ₹${fmt(settings.esi.wageLimit)})` };
}
export function esiEmployer({ contract, settings, period }) {
  const wage = toPaise(contract?.wage ?? 0);
  if (!settings.esi.enabled || wage > settings.esi.wageLimit) return skip('ESI not applicable');
  return { paise: mulPct(wage, settings.esi.employerPct), base: wage, quantity: settings.esi.employerPct, reportOnly: true,
           log: `Employer ESI ${settings.esi.employerPct}% of ₹${fmt(wage)} (not deducted from net)` };
}
/** Professional Tax — slab table lookup; month-level levy charged on the slice settings.pt_charge_slice names. */
export function professionalTax({ contract, settings, ptSlabs = [], period, prior }) {
  if (!settings.pt.enabled) return skip('PT disabled for this company');
  const wage = toPaise(contract?.wage ?? 0);
  const state = settings.pt.state;
  const match = (slabs) => slabs.filter((s) => String(s.state || '').toLowerCase() === String(state).toLowerCase());
  const pool = match(ptSlabs);
  const use = pool.length ? pool : ptSlabs;
  const hit = use.filter((s) => wage >= toPaise(s.wage_from) && (s.wage_to == null || wage <= toPaise(s.wage_to)))
               .sort((a, b) => toPaise(a.wage_from) - toPaise(b.wage_from)).pop();
  if (!hit && !use.length) return { paise: settings.pt.monthly, base: wage, quantity: 1, log: `No ${state} slabs configured → company default ₹${fmt(settings.pt.monthly)}/month` };
  if (!hit) return { paise: 0, base: wage, log: `PT exempt: wage ₹${fmt(wage)} is above the top slab (₹${fmt(toPaise(use[use.length - 1].wage_to ?? use[use.length - 1].wage_from))}) in ${state}`, skipped: true };
  let paise = toPaise(hit.monthly_amount);
  // a month-level levy, charged on one slice only so the two halves never double-charge PT
  const slice = settings.pt.chargeOn;
  if (period.half && slice === 'HALF_FIRST' && period.half !== 'FIRST') paise = 0;
  if (period.half && slice === 'HALF_SECOND' && period.half !== 'SECOND') paise = 0;
  // `prior.ytd_pt` is already paise (the repository converts rupee columns once) — do not scale it again
  const ytdPt = Math.round(Number(prior?.ytd_pt ?? 0));
  if (settings.pt.annualCap > 0 && ytdPt + paise > settings.pt.annualCap) {
    paise = Math.max(0, settings.pt.annualCap - ytdPt);
    return { paise, base: wage, quantity: 1, capped: true,
             log: `Annual PT cap ₹${fmt(settings.pt.annualCap)} reached (₹${fmt(ytdPt)} booked) → ₹${fmt(paise)} left this year` };
  }
  return { paise, base: wage, quantity: 1,
    log: `Slab ₹${fmt(toPaise(hit.wage_from))}–${hit.wage_to ? `₹${fmt(toPaise(hit.wage_to))}` : '∞'} → ₹${fmt(toPaise(hit.monthly_amount))}/month (${hit.state})${paise === 0 ? ` · charged on ${slice}` : ''}` };
}
/** Overtime — approved hours only, at hourly rate × multiplier (hours/day from settings). */
export function overtimeEarnings({ attendance, contract, period, settings, inputs }) {
  const hrs = Number(attendance?.overtimeHours ?? 0);
  if (hrs <= 0) return skip('No approved overtime hours in this period');
  const basis = toPaise(inputs?.ot_wage ?? contract?.wage ?? 0);
  const divisorDays = Math.max(1, period.expectedMonthDays || settings.divisorFor(period));
  const hourly = basis / divisorDays / Math.max(1, settings.defaultHoursPerDay);
  const mult = Number(inputs?.ot_multiplier ?? settings.overtime.multiplier);
  const roundTo = Number(settings.overtime.roundTo || 0);
  const billedHours = roundTo > 0 ? Math.round(hrs / roundTo) * roundTo : hrs;
  const paise = R(hourly * billedHours * mult);
  if (settings.overtime.minHours && billedHours < Number(settings.overtime.minHours)) return skip(`OT ${billedHours} h below the ${settings.overtime.minHours} h minimum`);
  return { paise, base: basis, quantity: billedHours,
    log: `${hrs} approved OT hrs${billedHours !== hrs ? ` → billed ${billedHours} h (rounded to ${roundTo} h)` : ''} × (₹${fmt(basis)} ÷ ${divisorDays} days ÷ ${settings.defaultHoursPerDay} h) × ${mult}` };
}
/**
 * Loss of pay — the line that makes an absence or unpaid leave cost money.
 * divisor comes from company_settings.payroll_day_basis: ACTUAL_WORKING_DAYS uses the days really
 * expected in this slice, FIXED_26/FIXED_30/CALENDAR_DAYS use a constant per month (then scaled by the
 * slice factor), which is exactly the difference two companies can have with the same salary.
 */
export function lossOfPay({ grossSoFar = 0, period, attendance = {}, leaves = {}, settings, inputs }) {
  const lop = Number(inputs?.lop_days ?? ((leaves.lop || 0) + (attendance.absent || 0) + 0.5 * (attendance.halfDay || 0)));
  if (lop <= 0) return skip('No unpaid absence in this period');
  const monthly = period.monthEquivalentGrossPaise ?? grossSoFar / Math.max(0.000001, period.factor || 1);
  const divisor = settings.dayBasis === 'ACTUAL_WORKING_DAYS'
    ? Math.max(1, period.expectedSliceDays || period.expectedMonthDays || 26)
    : Math.max(1, settings.divisorFor({ from: period.monthFrom || period.from, to: period.monthTo || period.to }));
  const perDay = monthly / divisor;
  const paise = Math.round(Math.min(perDay * lop, grossSoFar));
  return { paise: Math.max(0, paise), quantity: lop, base: Math.round(monthly), allowNegative: false,
    log: `${lop} unpaid day(s) × (₹${fmt(monthly)} ÷ ${divisor} ${settings.dayBasis === 'ACTUAL_WORKING_DAYS' ? 'expected' : 'calendar'} days) = ₹${fmt(Math.round(perDay * lop))}${paise > grossSoFar ? ' (capped at gross)' : ''}` };
}
/** Arrears carried forward from an earlier run (signed: + pays more, − recovers). */
export function arrears({ arrears: rows = [] }) {
  if (!rows.length) return skip('No arrears pending');
  const paise = rows.reduce((a, x) => a + toPaise(x.amount), 0);
  return { paise, quantity: 1, log: rows.map((x) => `${x.reason}: ₹${fmt(toPaise(x.amount))}`).join(' · ') };
}
export const RESOLVERS = { PF: pfEmployee, PF_EMPLOYER: pfEmployer, ESI: esiEmployee, ESI_EMPLOYER: esiEmployer,
                           PT: professionalTax, OT: overtimeEarnings, ARREAR: arrears, LOP: lossOfPay };
