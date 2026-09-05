import { round2p } from '../shared/index.js';

/**
 * Half-month payroll, the two supported policies:
 *
 • PRO_RATA      each half is computed on its own expected days. factor = expectedDaysInSlice /
                 expectedDaysInMonth, so a 15-day half in a 20-working-day month is 0.75 — never a
                 hardcoded 0.5, and a month with a holiday inside only the first half comes out uneven
                 on purpose (that is what "pro rata" means).
 • ADVANCE_50    first half pays a percentage of the *whole month's* expected net (an advance); the
                 second half then settles: month-equivalent lines minus what was actually paid in H1.
                 The subtraction uses the ACTUAL stored H1 lines, so a manual bonus or an attendance
                 correction in H1 is honoured, and the residual rides on an ADJUSTMENT line so
                 H1 + H2 equals the month net to the paise.
 */
export function resolvePeriod({ payFrequency = 'MONTHLY', from, to, key, computeMode = 'PRO_RATA', settings, month, slice }) {
  const expectedMonthDays = Math.max(0, month?.expectedDays ?? 0);
  const expectedSliceDays = Math.max(0, slice?.expectedDays ?? expectedMonthDays);
  const isHalf = payFrequency === 'HALF_MONTH_FIRST' || payFrequency === 'HALF_MONTH_SECOND';
  const half = payFrequency === 'HALF_MONTH_FIRST' ? 'FIRST' : payFrequency === 'HALF_MONTH_SECOND' ? 'SECOND' : null;
  const factor = isHalf || month?.clamped ? (expectedMonthDays > 0 ? round6(expectedSliceDays / expectedMonthDays) : 0) : 1;
  return {
    from, to, key, payFrequency, computeMode, half,
    isHalf, factor,
    expectedSliceDays, expectedSliceHours: slice?.hours ?? 0,
    expectedMonthDays, expectedMonthHours: month?.hours ?? 0,
    monthFrom: month?.from, monthTo: month?.to,
    calendarDays: slice?.calendarDays ?? 0,
    prorateStatutory: computeMode === 'PRO_RATA',
    advancePct: computeMode === 'ADVANCE_50' ? Number(settings.advancePct ?? 50) : null,
  };
}
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** Scale a month-equivalent computation so its net lands exactly on `targetNetPaise`. */
export function scaleToNet(lines, targetNetPaise, { label = 'ADVANCE', note = '' } = {}) {
  const cur = netOf(lines);
  if (cur === 0 || targetNetPaise === cur) return { lines: lines.map((l) => ({ ...l })), scale: 1 };
  const scale = targetNetPaise / cur;
  const out = lines.map((l) => ({ ...l, amount: Math.round(l.amount * scale), computation_log: `₹${round2p(l.amount)} × ${scale.toFixed(4)} = ₹${round2p(Math.round(l.amount * scale))} · ${note}` }));
  // residual on the largest earning line so the pieces add up to the target with no drift
  const diff = targetNetPaise - netOf(out);
  if (diff !== 0) {
    let idx = out.reduce((best, l, i) => (l.line_kind === 'EARNING' && (best.i === -1 || l.amount > out[best.i].amount) ? { i } : best), { i: -1 }).i;
    if (idx === -1) idx = out.findIndex((l) => l.line_kind === 'EARNING');
    if (idx >= 0) out[idx] = { ...out[idx], amount: out[idx].amount + diff, computation_log: `${out[idx].computation_log} · +₹${round2p(diff)} residual to hit the target` };
  }
  return { lines: out, scale };
}
/** H2 = whole-month computation − actual H1. */
export function trueUp({ monthLines, h1ByCode = {}, h1Net = 0, monthNet, sequenceAfter }) {
  const out = [];
  let seq = sequenceAfter;
  for (const l of monthLines) {
    const paid = Math.round(Number(h1ByCode[l.rule_code]) || 0);
    if (!paid) { out.push({ ...l }); continue; }
    if (l.line_kind === 'REPORT') { out.push({ ...l, amount: 0, computation_log: `Month figure ₹${round2p(l.amount)} − ₹${round2p(paid)} already paid in H1` }); continue; }
    const remaining = l.amount - paid;
    if (remaining === 0) { out.push({ ...l, amount: 0, is_hidden: true, computation_log: `Fully paid in the first half (₹${round2p(paid)})` }); continue; }
    out.push({ ...l, amount: Math.abs(remaining), line_kind: remaining < 0 ? 'DEDUCTION' : l.line_kind,
               computation_log: `Month ₹${round2p(l.amount)} − H1 ₹${round2p(paid)} = ₹${round2p(Math.abs(remaining))}` });
  }
  const netAfter = netOf(out);
  const target = Math.round(Number(monthNet) || 0) - Math.round(h1Net);
  const residual = target - netAfter;
  if (residual !== 0) {
    out.push({ rule_id: null, rule_code: 'TRUE_UP', rule_name: 'Half-Month True-Up', category: 'DEDUCTION',
               line_kind: 'ADJUSTMENT', sequence: ++seq, amount: residual, base_amount: null, quantity: null, is_hidden: false,
               computation_log: `Month net ₹${round2p(monthNet)} − H1 paid ₹${round2p(h1Net)} − H2 lines ₹${round2p(netAfter)} = ₹${round2p(residual)}` });
  }
  return { lines: out, residual, target };
}
export const netOf = (lines) => lines.reduce((a, l) => a + (l.line_kind === 'DEDUCTION' ? -l.amount : l.line_kind === 'REPORT' ? 0 : l.amount), 0);
/** {rule_code → magnitude in paise} of what a payslip actually paid, for the true-up subtraction. */
export function byCode(lines) {
  const o = {};
  for (const l of lines) if (l.line_kind !== 'REPORT') o[l.rule_code] = (o[l.rule_code] || 0) + l.amount;
  return o;
}
