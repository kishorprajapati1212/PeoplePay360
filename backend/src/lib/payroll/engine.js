import { compile, run as runFormula, FormulaError } from '../formula/index.js';
import { toPaise, mulPct, round2p, toIso } from '../shared/index.js';
import { RESOLVERS } from './resolvers.js';
import { buildFormulaContext } from './context.js';

const CAT_ORDER = { BASIC: 0, ALLOWANCE: 1, REIMBURSEMENT: 2, DEDUCTION: 3, GROSS: 4, NET: 5 };
const EarningCat = new Set(['BASIC', 'ALLOWANCE', 'REIMBURSEMENT']);

/**
 * Compute one payslip from ordered rules. Pure: nothing here touches the DB, so the same engine
 * backs the UI "preview computation" button, the payrun batch and the tests.
 *
 * The whole calculation is four steps, and each step writes one line that the payslip prints verbatim:
 *   1. order the rules (sequence, with a dependency pulled in front of what needs it);
 *   2. for each rule: condition gate → statutory resolver / FIXED / PERCENTAGE / FORMULA → caps → rounding;
 *   3. total the lines (gross, deductions, adjustments, net, employer cost) — totals are never stored
 *      separately, so the printed slip cannot disagree with the arithmetic;
 *   4. add the two lines the rules did not produce: a carry-in arrear line, and a rounding-off line.
 * docs/13-how-a-payslip-is-computed.md walks through a real month with numbers.
 *
 * input = { employee, contract, structure, rules, ptSlabs, period, attendance, leaves, inputs,
 *           arrears, prior, settings, worksheetSeed }
 * period  = { from, to, key, half, factor, expectedMonthDays, expectedSliceDays, monthEquivalent,
 *             computeMode, payFrequency, prorateStatutory }
 */
export function computePayslip(input) {
  const { employee, contract, structure, rules = [], ptSlabs = [], period, attendance = {}, leaves = {},
          inputs = {}, arrears = [], prior = {}, settings } = input;
  if (!contract) throw new Error('NO_CONTRACT');
  const factor = Number(period.factor ?? 1);
  const ctx = buildFormulaContext({ employee, contract, period, expected: { days: period.expectedSliceDays ?? 0, hours: period.expectedSliceHours ?? 0, calendarDays: period.calendarDays ?? 0 },
                                    attendance, leaves, worksheet: {}, inputs, run: period.run, structure, prior });
  const worksheet = {};           // rule_code -> paise
  const lines = [];
  const warnings = [];
  const stats = { prorated: 0, skipped: 0 };   // only two numbers are ever reported, so only two are counted

  const earningsSoFar = () => lines.filter((l) => l.line_kind === 'EARNING').reduce((a, l) => a + l.amount, 0);
  const ordered = orderRules([...rules].filter((rl) => rl.active !== false && isRuleActive(rl, period))
    .sort((a, b) => a.sequence - b.sequence || (CAT_ORDER[a.category] ?? 9) - (CAT_ORDER[b.category] ?? 9)));
  const inStructure = new Set(ordered.map((rl) => rl.code));
  for (const rl of ordered) {
    for (const dep of (rl.depends_on || []).map((x) => String(x).toUpperCase())) {
      if (!inStructure.has(dep)) warnings.push({ severity: 'WARN', code: 'DEPENDENCY_MISSING', rule: rl.code,
        message: `${rl.name} depends on ${dep}, which is not in this structure — anything measured against it will be 0.` });
    }
  }

  for (const rule of ordered) {
    const code = rule.code;
    let res = null;
    try {
      res = evaluateRule({ rule, contract, employee, period, settings, prior, ptSlabs, worksheet, ctx, inputs, arrears, attendance, leaves, factor, earningsSoFar });
    } catch (e) {
      warnings.push({ severity: 'ERROR', code: 'RULE_ERROR', rule: code,
                      message: `${rule.name}: ${e.message}` });
      res = { paise: 0, log: `ERROR: ${e.message}`, error: true };
    }
    let paise = applyRoundingMode(Math.round(Number(res.paise) || 0), rule.rounding_mode);
    if (rule.rounding_mode === 'down' || rule.rounding_mode === 'up') res.log = `${res.log ?? ''}${res.log ? ' · ' : ''}₹${round2p(Math.round(Number(res.paise) || 0))} rounded ${rule.rounding_mode} to ₹${round2p(paise)}`;
    const isReport = rule.category === 'GROSS' || rule.category === 'NET' || rule.is_report_only || res.reportOnly;
    const kind = isReport ? 'REPORT' : (rule.category === 'DEDUCTION' || rule.line_kind === 'DEDUCTION' ? 'DEDUCTION' : (EarningCat.has(rule.category) ? 'EARNING' : rule.line_kind || 'EARNING'));

    if (!isReport && kind === 'EARNING' && factor < 1 && res.prorate !== false && rule.pro_rata && paise > 0) stats.prorated += 1;
    if (res.skipped) stats.skipped += 1;

    worksheet[code] = paise;
    lines.push({
      rule_id: rule.id ?? null, rule_code: code, rule_name: rule.name, category: rule.category, line_kind: kind,
      sequence: rule.sequence, amount: paise, base_amount: res.base ?? null, quantity: res.quantity ?? null,
      is_taxable: rule.is_taxable !== false, in_report: rule.appears_in_report !== false,
      is_hidden: rule.appears_on_payslip === false || (paise === 0 && rule.hide_zero !== false && !isReport),
      computation_log: res.log ?? null,
    });
    if (paise < 0 && kind !== 'ADJUSTMENT' && !res.allowNegative) {
      warnings.push({ severity: 'WARN', code: 'NEGATIVE_LINE', rule: code, message: `${rule.name} computed to a negative amount (₹${round2p(paise)}) and is shown as a deduction` });
    }
  }

  // ── totals (derived from the lines so what is stored always matches what is printed) ──
  // carry-in arrears must never be silently dropped just because the structure has no ARREAR rule
  if (arrears.length && !lines.some((l) => l.rule_code === 'ARREAR')) {
    const a = RESOLVERS.ARREAR({ arrears });
    if (a && a.paise) lines.push({ rule_id: null, rule_code: 'ARREAR', rule_name: 'Arrears / True-Up', category: 'DEDUCTION',
                                  line_kind: 'ADJUSTMENT', sequence: maxSeq(lines) + 1, amount: a.paise, base_amount: null, quantity: 1,
                                  is_hidden: false, computation_log: a.log });
  }
  const gross = lines.filter((l) => l.line_kind === 'EARNING').reduce((a, l) => a + l.amount, 0);
  // is_taxable is what the exemption table is measured against, so it is computed here rather than guessed
  // downstream: reimbursements and conveyance are flagged false in the seeded structures on purpose.
  const taxableGross = lines.filter((l) => l.line_kind === 'EARNING' && l.is_taxable !== false).reduce((a, l) => a + l.amount, 0);
  const inReport = lines.filter((l) => l.in_report !== false && l.line_kind !== 'REPORT');
  const reportGross = inReport.filter((l) => l.line_kind === 'EARNING').reduce((a, l) => a + l.amount, 0);
  const reportDeductions = inReport.filter((l) => l.line_kind === 'DEDUCTION').reduce((a, l) => a + l.amount, 0);
  const deductions = lines.filter((l) => l.line_kind === 'DEDUCTION').reduce((a, l) => a + l.amount, 0);
  let adjustments = lines.filter((l) => l.line_kind === 'ADJUSTMENT').reduce((a, l) => a + l.amount, 0);
  let net = gross - deductions + adjustments;
  const employer = lines.filter((l) => l.line_kind === 'REPORT' && /EMPLOYER/.test(l.rule_code)).reduce((a, l) => a + l.amount, 0);

  // GROSS / NET echo lines: filled from the computation so the payslip table matches the mockup.
  for (const l of lines) {
    if (l.line_kind !== 'REPORT') continue;
    if (l.category === 'GROSS' || l.rule_code === 'GROSS') l.amount = gross;
    else if (l.category === 'NET' || l.rule_code === 'NET') l.amount = net;
    else if (l.rule_code === 'TOTAL_DEDUCTIONS') l.amount = deductions;
  }

  // ── rounding: one residual, applied to the net, never spread across lines ──
  const rounded = settings.roundNetToRupee ? Math.round(net / 100) * 100 : net;
  if (rounded !== net) {
    lines.push({ rule_id: null, rule_code: 'ROUND_OFF', rule_name: 'Rounding Off', category: 'DEDUCTION', line_kind: 'ADJUSTMENT',
                 sequence: maxSeq(lines) + 1, amount: rounded - net, base_amount: null, quantity: null, is_hidden: false,
                 computation_log: `Net ₹${round2p(net)} → ₹${round2p(rounded)} (nearest rupee)` });
    adjustments += rounded - net;
    net = rounded;
  }

  if (net < 0) {
    if (!settings.allowNegativeNet) {
      warnings.push({ severity: 'WARN', code: 'NEGATIVE_NET', message: `Net pay is negative (₹${round2p(net)}). Carry-in disabled: ₹${round2p(-net)} recorded as an arrear for the next run.`, amountPaise: -net });
    } else warnings.push({ severity: 'WARN', code: 'NEGATIVE_NET_ALLOWED', message: `Negative net pay allowed by company settings (₹${round2p(net)})` });
  }

  ctx.worksheet = Object.fromEntries(Object.entries(worksheet).map(([k, v]) => [k, round2p(v)]));
  ctx.gross = round2p(gross);
  ctx.total_deductions = round2p(deductions);
  ctx.net = round2p(net);
  return {
    lines, totals: { gross, deductions, adjustments, net, employerCost: gross + employer, taxableGross, reportGross, reportDeductions }, warnings, stats,
    context: ctx,
    meta: {
      expected_working_days: period.expectedSliceDays ?? 0,
      paid_days: period.expectedSliceDays - (leaves.lop ?? 0) - (attendance.absent ?? 0),
      worked_days: Math.round((attendance.present ?? 0) + (attendance.onLeave ?? 0)),
      half_days: attendance.halfDay ?? 0,
      leave_days: leaves.total ?? 0,
      unpaid_leave_days: leaves.lop ?? 0,
      absent_days: attendance.absent ?? 0,
      holiday_days: attendance.holiday ?? 0,
      worked_hours: attendance.workedHours ?? 0,
      overtime_hours: attendance.overtimeHours ?? 0,
      pro_rata_factor: factor,
      computation_summary: {
        dayBasis: settings.dayBasis, factor, mode: period.computeMode, half: period.half ?? null,
        expectedSliceDays: period.expectedSliceDays, expectedMonthDays: period.expectedMonthDays,
        divisorDays: Math.max(1, period.expectedMonthDays || settings.divisorFor(period)),
        proratedLines: stats.prorated, skippedLines: stats.skipped,
        taxableGross: round2p(taxableGross), nonTaxableEarnings: round2p(gross - taxableGross),
        reportGross: round2p(reportGross), reportDeductions: round2p(reportDeductions),
        monthEquivalentNet: period.monthEquivalent?.net ? round2p(period.monthEquivalent.net) : null,
        advanceFrom: period.advanceFrom ?? null,
        rules: lines.map((l) => ({ code: l.rule_code, seq: l.sequence, kind: l.line_kind, amount: round2p(l.amount), log: l.computation_log })),
        leaves: leaves.detail ?? [],
      },
    },
  };
}

function evaluateRule({ rule, contract, employee, period, settings, prior, ptSlabs, worksheet, ctx, inputs, arrears, attendance, leaves, factor, earningsSoFar }) {
  // condition gate, e.g. "overtime_hours > 0" — false means the line is 0 with a logged reason
  if (rule.condition_expr && String(rule.condition_expr).trim()) {
    let pass = true;
    try { pass = !!runFormula(rule.condition_expr, { ...ctx, worksheet: ctx.worksheet, result: 0 }, { roundTo: 0 }); }
    catch (e) { if (e instanceof FormulaError) throw new FormulaError(`Condition “${rule.condition_expr}” — ${e.message}`); throw e; }
    if (!pass) return { paise: 0, log: `Skipped: condition “${rule.condition_expr}” is false`, skipped: true, allowNegative: true };
  }
  const resolver = rule.statutory ? RESOLVERS[rule.code] : null;
  // a FORMULA typed over a statutory rule wins — admins can override without a code change
  if (resolver && !(rule.computation_type === 'FORMULA' && rule.formula)) {
    const out = resolver({ contract, employee, settings, period, prior, ptSlabs, inputs, arrears, attendance, leaves,
                           // earnings accumulated so far, so LOP/PT are measured against what was actually earned
                           grossSoFar: earningsSoFar() });
    // a resolver returning 0 is a decision (exempt, capped, charged on the other half) — never fall through
    if (out) return out;
  }
  switch (rule.computation_type) {
    case 'FIXED': {
      const rupees = toPaise(rule.amount ?? 0);
      const qty = quantityOf(rule, ctx);
      let paise = Math.round(rupees * qty);
      if (rule.pro_rata && factor < 1 && period.factor != null) paise = Math.round(paise * factor);
      // caps and the once-per-month marker apply to fixed rules too: a per-day allowance with a quantity
      // expression (₹500 × paid_days, capped at 10 days) and any half-month "month once" rule are FIXED.
      paise = capPaise(paise, { rule, prior, period, settings });
      return { paise, base: rupees, quantity: qty,
               log: `₹${round2p(rupees)} fixed${qty !== 1 ? ` × ${qty}` : ''}${rule.pro_rata && factor < 1 ? ` × factor ${factor.toFixed(4)}` : ''}${rule.pro_rata && factor < 1 ? ` = ₹${round2p(paise)}` : ''}`,
               allowNegative: true };
    }
    case 'PERCENTAGE': {
      const pct = Number(rule.percentage ?? rule.amount ?? 0);
      const base = baseOf(rule, { worksheet, contract, gross: null });
      const qty = quantityOf(rule, ctx);
      let paise = mulPct(base, pct);
      if (qty !== 1) paise = Math.round(paise * qty);
      // a percentage of another rule is already prorated by that rule — applying the factor twice is the
      // classic half-month bug (HRA of an already-prorated Basic would pay a quarter, not a half).
      const derivedFromRule = String(rule.base_code || '').toUpperCase() in worksheet;
      if (rule.pro_rata && factor < 1 && !derivedFromRule) paise = Math.round(paise * factor);
      paise = capPaise(paise, { rule, prior, period, settings });
      return { paise, base, quantity: qty,
        log: `${pct}% of ${rule.base_code || 'CONTRACT_WAGE'} ₹${round2p(base)}${rule.pro_rata && factor < 1 && !derivedFromRule ? ` × factor ${factor.toFixed(4)}` : rule.pro_rata && factor < 1 ? ' (base already prorated, factor not applied twice)' : ''}${qty !== 1 ? ` × qty ${qty}` : ''} = ₹${round2p(paise)}`,
        allowNegative: true };
    }
    case 'FORMULA': {
      const value = runFormula(rule.formula, { ...ctx, worksheet: { ...ctx.worksheet } }, { roundTo: 2 });
      let paise = Math.round(value * 100);
      paise = capPaise(paise, { rule, prior, period, settings });
      return { paise, quantity: 1, log: `formula → ₹${round2p(paise)}`, allowNegative: true };
    }
    default:
      throw new FormulaError(`Unsupported computation type “${rule.computation_type}”`);
  }
}
/** Per-run multipliers on a rule: quantity_expr (e.g. "paid_days") or a plain number. */
function quantityOf(rule, ctx) {
  if (rule.quantity_expr && String(rule.quantity_expr).trim()) {
    const v = runFormula(rule.quantity_expr, ctx, { roundTo: 4 });
    if (!Number.isFinite(v)) throw new FormulaError(`quantity_expr “${rule.quantity_expr}” is not numeric`);
    return v;
  }
  const n = Number(rule.quantity ?? 1);
  return Number.isFinite(n) && n !== 0 ? n : 1;
}
function baseOf(rule, { worksheet, contract }) {
  const key = (rule.base_code || 'CONTRACT_WAGE').toUpperCase();
  if (key === 'CONTRACT_WAGE' || key === 'WAGE') return toPaise(contract?.wage ?? 0);
  if (key === 'BASIC') return worksheet.BASIC ?? toPaise(contract?.wage ?? 0);
  if (key === 'GROSS') return worksheet.GROSS ?? 0;
  if (key in worksheet) return worksheet[key];
  throw new FormulaError(`base_code “${rule.base_code}” does not match any rule in this structure (and is not CONTRACT_WAGE/BASIC/GROSS)`);
}
/**
 * Caps and the "once per month" marker, measured against what this employee has already been paid.
 *  · cap_amount   — the most the line may be in one window (MONTH / FISCAL_YEAR, per evaluation_period),
 *                   less whatever earlier slips in that window already used up.
 *  · annual_cap   — the same idea over the financial year.
 *  · MONTH_ONCE   — a half-month payrun asks the question twice, so the second slip gets 0 for this rule
 *                   unless it is a per-day amount (see evaluation_period on the rule).
 */
function capPaise(paise, { rule, prior, period }) {
  let out = paise;
  const monthCap = toPaise(rule.cap_amount ?? 0);
  const yearCap = toPaise(rule.annual_cap ?? 0);
  const already = { MONTH: prior?.by_rule_month?.[rule.code], FISCAL_YEAR: prior?.by_rule_fy?.[rule.code], PERIOD: 0 }[rule.evaluation_period] ?? 0;
  if (rule.evaluation_period === 'MONTH_ONCE' && (prior?.month_codes || []).includes(rule.code)) {
    return 0;
  }
  if (monthCap > 0) {
    const allowed = Math.max(0, monthCap - Math.round(already * 100));
    if (allowed < out) out = allowed;
  }
  if (yearCap > 0) {
    const allowed = Math.max(0, yearCap - Math.round((prior?.ytd_by_rule?.[rule.code] ?? already) * 100));
    if (allowed < out) out = allowed;
  }
  return out;
}
/**
 * `half_up` keeps every paisa the rules produced (the default, and what the payslip prints today).
 * `down` / `up` floor or ceiling the line to a whole rupee — used for allowances an admin wants paid in
 * clean rupee amounts (e.g. a conveyance of ₹1,600.67 that should stay ₹1,600).
 */
function applyRoundingMode(paise, mode) {
  if (mode === 'down') return Math.floor(paise / 100) * 100;
  if (mode === 'up') return Math.ceil(paise / 100) * 100;
  return paise;
}
/** sequence order, with depends_on pulling a later-numbered dependency in front so no rule reads an empty worksheet. */
function orderRules(rules) {
  const byCode = new Map(rules.map((r) => [r.code, r]));
  const out = []; const done = new Set(); const visiting = new Set();
  const visit = (r) => {
    if (done.has(r.code) || visiting.has(r.code)) return;
    visiting.add(r.code);
    for (const dep of (r.depends_on || []).map((x) => String(x).toUpperCase())) {
      const d = byCode.get(dep);
      if (d && Number(d.sequence) > Number(r.sequence)) visit(d);
    }
    visiting.delete(r.code); done.add(r.code); out.push(r);
  };
  for (const r of rules) visit(r);
  return out;
}
const maxSeq = (lines) => lines.reduce((m, l) => Math.max(m, l.sequence || 0), 0);
function isRuleActive(rule, period) {
  // pg hands back date columns as Date objects, so normalise both sides to YYYY-MM-DD before comparing
  const from = toIso(rule.active_from), to = toIso(rule.active_to);
  if (from && toIso(period.to) < from) return false;
  if (to && toIso(period.from) > to) return false;
  return true;
}
export { CAT_ORDER };
