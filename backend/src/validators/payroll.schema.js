import { z } from 'zod';
import { uuid, dateStr, optDate, money, signedMoney, trimmed, optText, pagination, boolish, pct, intIn, hours } from './common.js';
export const idParam = z.object({ id: uuid });
export const structureBody = z.object({ name: trimmed(80), code: optText(30), description: optText(500), is_active: z.enum(['ACTIVE', 'INACTIVE']).optional() });
export const ruleBody = z.object({
  salary_structure_id: uuid.optional(), name: trimmed(80), code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,20}$/, 'Code: A–Z, 0–9, underscore'),
  category: z.enum(['BASIC', 'ALLOWANCE', 'REIMBURSEMENT', 'DEDUCTION', 'GROSS', 'NET']),
  line_kind: z.enum(['EARNING', 'DEDUCTION', 'ADJUSTMENT', 'REPORT']).optional(), sequence: intIn(1, 999).optional(),
  computation_type: z.enum(['FIXED', 'PERCENTAGE', 'FORMULA']).default('FIXED'),
  amount: z.coerce.number().min(-999999).max(999999).optional(), percentage: pct.optional(), base_code: optText(30),
  formula: z.string().max(600).optional().nullable(), condition_expr: z.string().max(300).optional().nullable(),
  quantity_expr: z.string().max(200).optional().nullable(), pro_rata: z.boolean().default(true),
  evaluation_period: z.enum(['PERIOD', 'MONTH', 'MONTH_ONCE', 'FISCAL_YEAR']).default('PERIOD'),
  cap_amount: z.coerce.number().min(0).max(9999999).optional(), annual_cap: z.coerce.number().min(0).max(99999999).optional(),
  rounding_mode: z.enum(['half_up', 'down', 'up']).optional(), is_taxable: z.boolean().optional(), is_report_only: z.boolean().optional(),
  appears_on_payslip: z.boolean().default(true), appears_in_report: z.boolean().optional(), statutory: z.boolean().default(false),
  active_from: optDate, active_to: optDate, notes: optText(500),
});
export const validateRuleBody = z.object({ formula: z.string().max(600), wage: z.coerce.number().min(0).max(10000000).optional(), days: intIn(1, 31).optional() });
export const previewBody = z.object({ structure_id: uuid, wage: money, days: intIn(1, 31).optional(), employee_id: uuid.optional(),
  period_start: optDate, period_end: optDate });
export const wizardStep1 = z.object({ salary_structure_id: uuid, period_start: dateStr, period_end: dateStr.optional(),
  pay_frequency: z.enum(['MONTHLY', 'HALF_MONTH_FIRST', 'HALF_MONTH_SECOND', 'BI_MONTHLY', 'WEEKLY', 'CUSTOM']).optional(),
  compute_mode: z.enum(['PRO_RATA', 'ADVANCE_50']).optional() });
export const wizardStep2 = wizardStep1.extend({ employee_ids: z.array(uuid).min(1, 'Select at least one employee').max(500),
  name: z.string().trim().max(120).optional(), notes: optText(500), idempotency_key: optText(120) });
export const payrunListQuery = z.object({ year: intIn(1990, 2200).optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  status: z.enum(['DRAFT', 'COMPUTED', 'VALIDATED', 'PAID', 'VOID']).optional(), structure_id: uuid.optional(), q: z.string().max(60).optional(), ...pagination });
export const candidateQuery = wizardStep1.extend({ q: z.string().max(80).optional(), department_id: uuid.optional(), employee_type: z.enum(['FULL_TIME','PART_TIME','CONTRACT','INTERN']).optional(), page: intIn(1, 9999).optional(), page_size: intIn(1, 200).optional() });
export const payslipListQuery = z.object({ employee_id: uuid.optional(), payrun_id: uuid.optional(), status: z.enum(['DRAFT','COMPUTED','VALIDATED','PAID','VOID']).optional(),
  period_key: optText(30), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), from: optDate, to: optDate, q: z.string().max(80).optional(),
  missing_bank: boolish.optional(), ...pagination });
/** POST /payslips/send — bulk release for a selection; at least one selector has to narrow it. */
export const bulkSendBody = z.object({ payslip_ids: z.array(uuid).min(1).max(500).optional(), employee_ids: z.array(uuid).min(1).max(500).optional(),
  payrun_id: uuid.optional(), period_key: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM').optional(),
  cc_hr: z.boolean().optional(), only_missing: z.boolean().optional() })
  .refine((b) => b.payslip_ids?.length || b.payrun_id || b.period_key || b.employee_ids?.length,
    { message: 'Choose payslips, a payrun or a period (YYYY-MM) to send', path: ['payslip_ids'] });
export const linePatch = z.object({ replace: z.boolean().default(false), lines: z.array(z.object({
  id: uuid.optional(), rule_code: optText(30), rule_name: optText(80), category: z.enum(['BASIC','ALLOWANCE','REIMBURSEMENT','DEDUCTION','GROSS','NET']).optional(),
  line_kind: z.enum(['EARNING','DEDUCTION','ADJUSTMENT','REPORT']).optional(), sequence: intIn(1, 999).optional(),
  amount: signedMoney, is_hidden: z.boolean().optional(), computation_log: optText(400) })).min(1).max(80) });
export const inputsBody = z.object({ rows: z.array(z.object({ code: trimmed(30), name: trimmed(60), amount: signedMoney, reason: optText(300) })).max(40).optional(),
  remove: z.array(z.string().max(30)).max(40).optional() });
export const arrearBody = z.object({ amount: signedMoney, reason: trimmed(300), rule_code: optText(30), target_payrun_id: uuid.optional() });
export const sendBody = z.object({ force: z.boolean().default(false), cc_hr: z.boolean().default(false) });
export const computeBody = z.object({ employee_ids: z.array(uuid).max(500).optional() });
export const companyBody = z.object({ company_name: optText(120), legal_name: optText(120), address: optText(300), city: optText(80), state: optText(80),
  postal_code: optText(20), country: optText(60), timezone: optText(60), currency: optText(10), currency_symbol: optText(6),
  fiscal_year_start_month: intIn(1, 12).optional(), payroll_day_basis: z.enum(['ACTUAL_WORKING_DAYS','CALENDAR_DAYS','FIXED_30','FIXED_26']).optional(),
  default_hours_per_day: z.coerce.number().min(1).max(24).optional(), overtime_multiplier: z.coerce.number().min(1).max(4).optional(),
  overtime_round_to: z.coerce.number().min(0).max(4).optional(), overtime_min_hours: z.coerce.number().min(0).max(8).optional(),
  round_net_to_rupee: boolish.optional(), sandwich_rule: boolish.optional(), pf_enabled: boolish.optional(), pf_employee_pct: pct.optional(),
  pf_employer_pct: pct.optional(), pf_wage_ceiling: money.optional(), esi_enabled: boolish.optional(), esi_employee_pct: pct.optional(),
  esi_employer_pct: pct.optional(), esi_wage_limit: money.optional(), pt_enabled: boolish.optional(), pt_monthly: money.optional(),
  pt_annual_cap: money.optional(), pt_charge_slice: z.enum(['MONTH','HALF_FIRST','HALF_SECOND']).optional(), pt_state: optText(60),
  advance_percentage: z.coerce.number().min(1).max(100).optional(), allow_negative_net: boolish.optional(),
  payslip_footer: optText(400), mail_from: optText(160), mail_daily_limit: intIn(1, 100000).optional(), document_retention_years: intIn(1, 40).optional(),
  // The SMTP login an admin pastes in. They are ordinary company settings so one PATCH saves them with the
  // rest, with two differences: smtp_password is write-only (never returned, see company.repo.withoutSecret)
  // and an empty string means "keep what is stored", not "erase it" — a settings screen that re-posts its own
  // blank boxes must not be able to switch the company off mid-week.
  mail_enabled: boolish.optional(), smtp_host: optText(160), smtp_port: intIn(1, 65535).optional(),
  smtp_secure: boolish.optional(), smtp_user: optText(160), smtp_password: z.string().max(400).optional(),
  }).partial();
/** POST /company/mail/test — the address is optional on purpose: blank means "send it to whoever asked". */
/** POST /payruns/:id/generate-pdfs — `force` re-renders slips that already have a file. */
export const pdfBody = z.object({ force: boolish.optional(), reason: optText(40).optional() });
export const mailTestBody = z.object({ to: z.string().trim().email('A test mail needs an address that looks like one').max(160).nullable().optional() });
export const ptSlabBody = z.object({ state: trimmed(40), wage_from: money, wage_to: money.optional(), monthly_amount: money,
  effective_from: optDate, effective_to: optDate });
export const dashboardQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), from: optDate, to: optDate,
  department_id: uuid.optional(), employee_type: z.enum(['FULL_TIME','PART_TIME','CONTRACT','INTERN']).optional() });
