import { inr, num } from './format.js';

/**
 * What one salary rule does, in a sentence.
 *
 * A rule row is eight columns of field names (`computation_type`, `base_code`, `evaluation_period`…), and a
 * field name is not an explanation — the review asked "what is this line, specifically?". So the same facts are
 * read here in one place and put in the order a person reads a payslip: what kind of line it is, how the money
 * is found, whether a short month cuts it, and whether it appears at all.
 *
 * `amount` is filled in from the preview endpoint when one is available (the structure screen runs a preview for
 * a chosen wage); the sentence never invents a number the engine did not produce.
 */
export function explainRule(rule, { amount = null } = {}) {
  const parts = [kindOf(rule)];
  parts.push(howFound(rule));
  if (rule.cap_amount) parts.push(`capped at ${inr(rule.cap_amount)}`);
  if (rule.annual_cap) parts.push(`${inr(rule.annual_cap)} a year at most`);
  parts.push(rule.pro_rata ? 'cut for a short month' : 'paid in full whatever the days');
  if (rule.evaluation_period && rule.evaluation_period !== 'PERIOD') parts.push(periodNote(rule.evaluation_period));
  if (rule.condition_expr) parts.push(`only when ${rule.condition_expr}`);
  if (rule.statutory) parts.push('fixed by law');
  if (!rule.appears_on_payslip) parts.push('kept off the payslip');
  if (amount !== null && amount !== undefined) parts.push(`${inr(amount)} this month`);
  return parts.filter(Boolean).join(' · ');
}

function kindOf(rule) {
  switch (String(rule.line_kind || rule.category || '').toUpperCase()) {
    case 'BASIC': return 'basic pay';
    case 'ALLOWANCE': return 'an allowance';
    case 'REIMBURSEMENT': return 'a reimbursement';
    case 'DEDUCTION': return 'a deduction';
    case 'GROSS': return 'the gross total';
    case 'NET': return 'the net pay';
    default: return rule.line_kind === 'EARNING' ? 'an earning' : rule.line_kind === 'REPORT' ? 'a figure shown for reference' : 'a line on the slip';
  }
}

/** The one thing that changes a number: what the rule is measured against, and how. */
function howFound(rule) {
  const type = String(rule.computation_type || 'FIXED').toUpperCase();
  if (type === 'PERCENTAGE') {
    const pct = num(rule.percentage ?? 0);
    return `${pct}% of ${rule.base_code || 'BASIC'}`;
  }
  if (type === 'FORMULA') return `formula: ${String(rule.formula || '').trim() || 'not written yet'}`;
  return `fixed ${inr(rule.amount ?? 0)} a month`;
}

function periodNote(period) {
  if (period === 'MONTH_ONCE') return 'once in the calendar month, so a half-month run does not charge it twice';
  if (period === 'MONTH') return 'measured on the whole calendar month';
  if (period === 'FISCAL_YEAR') return 'measured across the financial year';
  return period.toLowerCase().replace(/_/g, ' ');
}

/** The three cross-field rules the engine relies on, in the form's own shape: `[field, message]` or null. */
export function ruleProblem(values) {
  const type = String(values.computation_type || 'FIXED').toUpperCase();
  const blank = (v) => v === '' || v === null || v === undefined;
  if (type === 'FIXED' && blank(values.amount)) return ['amount', 'A fixed line needs its amount.'];
  if (type === 'PERCENTAGE' && blank(values.percentage)) return ['percentage', 'A percentage line needs the percent.'];
  if (type === 'FORMULA' && blank(values.formula)) return ['formula', 'A formula line needs the formula, or the engine has nothing to evaluate.'];
  if (type === 'PERCENTAGE' && Number(values.percentage) > 1000) return ['percentage', 'Above 1000% is not a share of anything.'];
  // Only one of the three may carry a number, or the last one the engine reads wins and nobody can tell from
  // the row which one that was.
  const filled = [['amount', values.amount], ['percentage', values.percentage], ['formula', values.formula]].filter(([, v]) => !blank(v));
  if (filled.length > 1) return [type === 'FIXED' ? filled[1][0] : 'amount', `Only ${type.toLowerCase()} decides this line — clear the other boxes so the row says one thing.`];
  return null;
}
