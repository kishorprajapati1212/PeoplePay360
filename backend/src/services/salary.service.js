import { AppError } from '../lib/shared/index.js';
import { compile, explain } from '../lib/formula/index.js';
import * as repo from '../repositories/salary.repo.js';
import { transaction } from '../db/tx.js';
import { query } from '../db/pool.js';
import { run } from '../lib/formula/index.js';

export const listStructures = (f) => repo.listStructures(f);
export const getStructure = async (id) => {
  const s = await repo.getStructure(id);
  if (!s) throw AppError.notFound('Salary structure not found');
  return { ...s, rules: await repo.rulesOfStructure(id) };
};
export const createStructure = (d) => repo.createStructure(d);
export const updateStructure = async (id, p) => { const s = await repo.updateStructure(id, p); if (!s) throw AppError.notFound('Salary structure not found'); return s; };
export async function deleteStructure(id) {
  const impact = await repo.structureImpact(id);
  if (Number(impact.employees) > 0) throw new AppError('STRUCTURE_IN_USE', `${impact.employees} active contract(s) still use this structure`, { status: 409, details: impact });
  const done = await repo.deleteStructure(id);
  if (!done) throw AppError.notFound('Salary structure not found');
  return { ok: true, id };
}
export const listRules = (f) => repo.listRules(f);
export const getRule = async (id) => { const r = await repo.getRule(id); if (!r) throw AppError.notFound('Salary rule not found'); return r; };
export const impact = (id) => repo.structureImpact(id);
/**
 * Saving a formula is validated at save time: parsed, field-checked and dry-run against a sample
 * context, so a typo never reaches a payslip. This is why "Python Code" style rules are safe here.
 */
export function validateFormula({ formula, name = 'Formula' }, { wage = 85000, days = 22 } = {}) {
  if (!formula || !String(formula).trim()) return { ok: true, fields: [], nodes: 0, note: 'No formula to check' };
  const preview = explain(formula);
  if (!preview.ok) return { ok: false, error: preview.error, hint: hintFor(preview.error) };
  const ctx = sampleContext({ wage, days });
  try {
    const value = run(formula, ctx, { roundTo: 2 });
    return { ok: true, nodes: preview.nodes, fields: preview.fields, sample_value: value, sample: `wage ${wage}, days ${days} → ${value}` };
  } catch (e) {
    return { ok: false, error: e.message, hint: hintFor(e.message) };
  }
}
const hintFor = (msg = '') => {
  if (/Unknown field/i.test(msg)) return 'Type a field from the allowed list — e.g. wage, days, worksheet[\'BASIC\'], overtime_hours.';
  if (/Division by zero/i.test(msg)) return 'Guard the divisor: days > 0 ? amount / days : 0';
  if (/not allowed/i.test(msg)) return 'Salary formulas are arithmetic only: no function calls on objects, no host access.';
  if (/Expected|Unexpected/i.test(msg)) return 'Check for a missing bracket or an operator with nothing after it.';
  return 'Fix the expression; the editor shows the position of the problem.';
};
export function sampleContext({ wage = 85000, days = 22 } = {}) {
  const basic = Math.round(wage * 0.4 * 100) / 100;
  return { wage, basic, days, expected_days: days, paid_days: days, present_days: days, absent_days: 0, leave_days: 0, unpaid_days: 0, lop_days: 0,
           half_days: 0, period_days: 30, month_days: 30, worked_hours: days * 8, scheduled_hours: days * 8, overtime_hours: 0, overtime_earnings: 0,
           gross: Math.round(basic * 1.5 * 100) / 100, net: 0, total_deductions: 0, pt: 200, tds: 0, loan_deduction: 0, professional_tax: 0,
           pf_employee: 1800, pf_employer: 1800, esi_employee: 0, esi_employer: 0, allowance: 0, bonus: 0, arrear: 0, bonus_rate: 0,
           worksheet: { BASIC: basic, HRA: Math.round(basic * 0.5 * 100) / 100, MEDA: 1250, CONV: 1600, GROSS: Math.round(basic * 1.5 * 100) / 100, PF: 1800, PT: 200 },
           attendance: { days, present: days, absent: 0, late: 0, half_days: 0, on_leave: 0, worked_hours: days * 8, overtime_hours: 0, shortfall: 0, missing_checkout: 0, manual_edits: 0 },
           timeoff: { paid: 0, unpaid: 0, total: 0, by_type: {} },
           employee: { id: 'sample', code: 'EMP0001', name: 'Sample Employee', status: 'ACTIVE', employee_type: 'FULL_TIME', job_position: 'Engineer', department: 'Engineering' },
           contract: { id: 'sample', wage, start_date: '2025-04-01', end_date: null, salary_structure: 'Regular Salary', working_hours_per_week: 40 },
           inputs: {}, run: { period_start: '2026-02-01', period_end: '2026-02-28', period_key: '2026-02', pay_frequency: 'MONTHLY', compute_mode: 'PRO_RATA', factor: 1, is_half_month: false, half: null },
           ytd: { net: 0, gross: 0, basic: 0, pt: 0, pf_employee: 0, esi_employee: 0, bonus: 0 } };
}
const SEQUENCE_BANDS = { BASIC: [1, 9], ALLOWANCE: [10, 99], GROSS: [100, 109], DEDUCTION: [110, 199], NET: [200, 299], REIMBURSEMENT: [10, 99] };
export async function saveRule(structureId, data, { ruleId } = {}) {
  const rule = { ...data, salary_structure_id: structureId };
  if (!rule.code || !rule.name) throw AppError.badRequest('Rule Name and Code are both required');
  if (rule.computation_type === 'PERCENTAGE') {
    const pct = Number(rule.percentage ?? rule.amount);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 1000) throw AppError.badRequest('Percentage must be between 0 and 1000', { code: 'PCT_RANGE' });
    rule.percentage = pct;
  }
  if (rule.computation_type === 'FIXED') {
    if (rule.amount == null || !Number.isFinite(Number(rule.amount))) throw AppError.badRequest('Fixed Amount must be a number', { code: 'AMOUNT_REQUIRED' });
  }
  if (rule.computation_type === 'FORMULA') {
    const v = validateFormula({ formula: rule.formula, name: rule.name });
    if (!v.ok) throw new AppError('FORMULA_INVALID', v.error, { status: 422, details: { hint: v.hint, fields: v.fields } });
  }
  if (rule.condition_expr) {
    try { compile(rule.condition_expr); } catch (e) { throw new AppError('CONDITION_INVALID', e.message, { status: 422 }); }
  }
  if (rule.quantity_expr) {
    try { compile(rule.quantity_expr); } catch (e) { throw new AppError('QUANTITY_INVALID', e.message, { status: 422 }); }
  }
  // One line, one way to be computed. The engine reads `computation_type` and then exactly one of
  // amount / percentage / formula, so a percentage rule with no percentage is a rule that quietly pays nothing
  // while looking configured on the screen. Only the missing case is refused here: an older row may legitimately
  // carry a leftover value in another column, and editing its name must not become impossible because of it —
  // the form refuses that combination before it is ever stored.
  {
    const needed = { FIXED: 'amount', PERCENTAGE: 'percentage', FORMULA: 'formula' }[String(rule.computation_type || 'FIXED')];
    const blank = (v) => v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v));
    if (needed && blank(rule[needed])) {
      throw AppError.badRequest(`A ${String(rule.computation_type || 'FIXED').toLowerCase()} rule needs its ${needed} — without it this line pays nothing`,
        { code: 'RULE_INPUT_MISSING', details: { fieldErrors: { [needed]: `A ${String(rule.computation_type || 'FIXED').toLowerCase()} rule needs its ${needed} — without it this line pays nothing` } } });
    }
  }

  const band = SEQUENCE_BANDS[rule.category];
  if (band && rule.sequence != null && (rule.sequence < band[0] || rule.sequence > band[1])) {
    // not fatal, but the payslip prints in sequence order, so a deduction at 5 lands above Basic
    rule.sequence_warning = `${rule.category} rules normally sit between ${band[0]} and ${band[1]} (Odoo convention)`;
  }
  if (rule.sequence == null) rule.sequence = await nextSequence(structureId, rule.category);
  return transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    await repo.makeRoom(structureId, rule.sequence, ruleId, q);
    const saved = ruleId ? await repo.updateRule(ruleId, rule, q) : await repo.createRule(rule, q);
    return { ...saved, sequence_warning: rule.sequence_warning };
  });
}
async function nextSequence(structureId, category) {
  const band = SEQUENCE_BANDS[category] || [10, 99];
  const { rows } = await query(`select coalesce(max(sequence), $2 - 1) + 1 as n from salary_rules where salary_structure_id = $1 and sequence between $2 and $3`,
    [structureId, band[0], band[1]]);
  return Math.min(band[1], Math.max(band[0], Number(rows[0].n)));
}
export async function updateRule(id, data) {
  const existing = await repo.getRule(id);
  if (!existing) throw AppError.notFound('Salary rule not found');
  const drop = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  return saveRule(data.salary_structure_id || existing.salary_structure_id, { ...existing, ...drop }, { ruleId: id });
}
export async function deleteRule(id) {
  const used = await repo.ruleUsage(id);
  if (used > 0) throw new AppError('RULE_IN_USE', `${used} payslip line(s) reference this rule`, { status: 409, details: { used } });
  const done = await repo.deleteRule(id);
  if (!done) throw AppError.notFound('Salary rule not found');
  return { ok: true, id };
}
export const listPtSlabs = (state) => repo.ptSlabs(state);
export const createPtSlab = (d) => repo.createPtSlab(d);
export const deletePtSlab = (id) => repo.deletePtSlab(id);
/** Live "what would this employee's slip look like" number for the rule editor. */
export async function previewStructure({ structureId, wage, days = 22, employeeId, periodStart, periodEnd }) {
  const rules = await repo.rulesOfStructure(structureId);
  const { computePayslip } = await import('../lib/payroll/index.js');
  const settings = await (await import('../repositories/company.repo.js')).getCompany();
  const { settingsFrom } = await import('../lib/payroll/index.js');
  const employee = employeeId ? await (await import('../repositories/employee.repo.js')).getEmployee(employeeId) : { id: 'preview', name: 'Preview', employee_code: 'PREVIEW', status: 'ACTIVE' };
  const out = computePayslip({ employee, contract: { id: 'preview', wage, start_date: '2025-04-01' }, structure: { name: 'preview' }, rules,
    ptSlabs: await repo.ptSlabs(settings?.pt_state || settings?.state), period: { from: periodStart || '2026-02-01', to: periodEnd || '2026-02-28', key: 'preview', factor: 1, expectedSliceDays: days, expectedMonthDays: days, calendarDays: days },
    attendance: {}, leaves: {}, inputs: { bonus_rate: 0 }, arrears: [], prior: {}, settings: settingsFrom(settings || {}) });
  return { lines: out.lines.map((l) => ({ code: l.rule_code, name: l.rule_name, category: l.category, kind: l.line_kind, sequence: l.sequence,
    amount: l.amount / 100, log: l.computation_log })), totals: { gross: out.totals.gross / 100, deductions: out.totals.deductions / 100, net: out.totals.net / 100 }, warnings: out.warnings };
}
