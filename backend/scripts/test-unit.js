#!/usr/bin/env node
/**
 * Unit tests for the parts that must not be wrong: money parsing, period math, the formula
 * sandbox, the payroll engine (pro-rata halves, advance + true-up, statutory caps) and access control.
 * Run: npm test
 */
import assert from 'node:assert/strict';
import { toPaise, fromPaise, mulPct, rupeesInWords } from '../src/lib/shared/index.js';
import { expectedDays, attendanceStats, leaveStats } from '../src/lib/payroll/index.js';
import { computePayslip } from '../src/lib/payroll/index.js';
import { resolvePeriod, scaleToNet, trueUp, netOf, byCode } from '../src/lib/payroll/index.js';
import { settingsFrom } from '../src/lib/payroll/index.js';
import { resolvePeriodEnd } from '../src/lib/shared/index.js';
import { readFileSync } from 'node:fs';
import { payslipWarnings } from '../src/lib/payroll/index.js';
import { compile, run } from '../src/lib/formula/index.js';
import { can, permissionsFor, navFor, scopeFor, isDenied } from '../src/lib/shared/index.js';

// Two modules that are pure enough to load in a test: the seed data (no database, no config) and the schedule
// validator. Both are read as values below rather than as text, so a change in behaviour fails a test instead of
// failing a grep.
const SEED = await import('../db/seed/data.js');
const CONFIG = (await import('../src/config.js')).config;
const ORG_SCHEMA = await import('../src/validators/org.schema.js');
const { linkTtlSentence } = await import('../src/lib/mailer/template.js');

let passed = 0; const fails = [];
// A test that returns a promise has to be awaited before it is counted: `fn()` alone reports ✓ for a test that
// then rejects, so the summary said "all N passed" while node died on an unhandled rejection underneath it.
// The pending list is drained just before that summary line.
const pending = [];
const t = (name, fn) => {
  let out;
  try { out = fn(); } catch (e) { fails.push([name, e]); console.log(`  ✗ ${name}\n      ${e.message}`); return; }
  if (out && typeof out.then === 'function') {
    pending.push(out.then(() => { passed += 1; console.log(`  ✓ ${name}`); },
      (e) => { fails.push([name, e]); console.log(`  ✗ ${name}\n      ${e.message}`); }));
    return;
  }
  passed += 1; console.log(`  ✓ ${name}`);
};

// ── money ──────────────────────────────────────────────────────────────────────────────────
console.log('\nmoney');
t('numeric strings from pg become exact paise', () => {
  assert.equal(toPaise('85000.00'), 8500000);
  assert.equal(toPaise('46000.567'), 4600057);           // half-up, no float drift
  assert.equal(toPaise('0.1'), 10);
  assert.equal(toPaise(1234.55), 123455);
  assert.equal(toPaise(null), 0);
  assert.equal(toPaise('-1.005'), -101);
  assert.equal(fromPaise(1), '0.01');
  assert.equal(fromPaise(8500000), '85000.00');
});
t('percentage uses integer paise (₹15,000 × 12% = 1800.00)', () => {
  assert.equal(mulPct(1500000, 12), 180000);
  assert.equal(mulPct(8500000, 45.5), 3867500);
});
t('rupees in words uses lakh/crore', () => {
  assert.equal(rupeesInWords(85000), 'Eighty Five Thousand Rupees Only');
  assert.equal(rupeesInWords(100000.5), 'One Lakh Rupees and Fifty Paise Only');
  assert.equal(rupeesInWords(12345678.91), 'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees and Ninety One Paise Only');
});

// ── dates / periods ──────────────────────────────────────────────────────────────────────────
console.log('\nperiods');
// ISO weekdays: 1=Mon … 7=Sun. A weekday with no row is not scheduled at all.
const five8 = Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, { start_time: '09:00', end_time: '18:00', break_minutes: 60 }]));
const schedule = { ...five8, 6: { is_rest_day: true }, 7: { is_rest_day: true } };
t('February 2026 splits 10 / 10 expected days', () => {
  const month = expectedDays({ scheduleDays: schedule, holidays: [], from: '2026-02-01', to: '2026-02-28' });
  const h1 = expectedDays({ scheduleDays: schedule, holidays: [], from: '2026-02-01', to: '2026-02-15' });
  const h2 = expectedDays({ scheduleDays: schedule, holidays: [], from: '2026-02-16', to: '2026-02-28' });
  assert.deepEqual([month.days, h1.days, h2.days], [20, 10, 10]);   // 20 working days, split 10/10
  assert.equal(month.hours, 160);   // 20 working days × 8 h
  assert.equal(h1.hours, 80);
});
t('a holiday inside only one half makes the halves uneven (that is the point)', () => {
  const h1 = expectedDays({ scheduleDays: schedule, holidays: ['2026-02-13'], from: '2026-02-01', to: '2026-02-15' });
  assert.equal(h1.days, 9);
});
t('joining / exit dates clamp the expected days', () => {
  const e = expectedDays({ scheduleDays: schedule, holidays: [], from: '2026-02-01', to: '2026-02-28', joining: '2026-02-11' });
  assert.equal(e.days, 13);   // 11–13, 16–20, 23–27 (the 28th is a Saturday)
  const x = expectedDays({ scheduleDays: schedule, holidays: [], from: '2026-02-01', to: '2026-02-28', exit: '2026-02-13' });
  assert.equal(x.days, 10);   // last working day 13 Feb
});
t('night shift spans midnight instead of going negative', () => {
  const night = Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, { start_time: '22:00', end_time: '06:00', break_minutes: 60 }]));
  // 22:00→06:00 crosses midnight: 8 h gross − 1 h break = 7 h a night, 35 h a week (not −16 h)
  assert.equal(expectedDays({ scheduleDays: night, holidays: [], from: '2026-02-02', to: '2026-02-06' }).hours, 35);
  assert.equal(expectedDays({ scheduleDays: five8, from: '2026-02-02', to: '2026-02-02' }).days, 1, 'Monday is scheduled');
  assert.equal(expectedDays({ scheduleDays: {}, from: '2026-02-02', to: '2026-02-06' }).days, 0, 'a schedule with no day rows means zero expected days');
});
t('period_key names the slice', async () => {
  const { periodKey, inferKind, fmtDate } = await import('../src/lib/shared/index.js');
  assert.equal(periodKey('2026-02-01', '2026-02-28'), '2026-02');
  assert.equal(inferKind('2026-02-01', '2026-02-15'), 'HALF_FIRST');
  assert.equal(inferKind('2026-02-16', '2026-02-28'), 'HALF_SECOND');
  assert.equal(periodKey('2026-02-16', '2026-02-28', 'HALF_MONTH_SECOND'), '2026-02-H2');
  assert.equal(fmtDate('2026-09-02'), '02-Sep-2026');
});

// ── formula sandbox ────────────────────────────────────────────────────────────────────────────
console.log('\nformula');
t('reads worksheet references like Odoo hints', () => {
  const v = run("result = worksheet['BASIC'] * 0.5", { worksheet: { BASIC: 34000 } });
  assert.equal(v, 17000);
});
t('guards division by zero with a ternary', () => {
  assert.equal(run('days > 0 ? wage / days * 3 : 0', { days: 20, wage: 85000 }), 12750);
  assert.throws(() => run('wage / days', { days: 0, wage: 85000 }), /Division by zero/);
});
t('min/max/round work', () => {
  assert.equal(run('min(wage * 0.2, 5000)', { wage: 85000 }), 5000);
  assert.equal(run('round(wage / 3, 2)', { wage: 100 }), 33.33);
});
t('rejects anything that is not arithmetic', () => {
  for (const bad of ['require("fs")', 'process.exit(0)', 'this.constructor', 'x => x', '{}', '[][0]', 'new Date()',
                     'globalThis', 'eval("1")', 'worksheet.constructor', 'import("fs")', '(function(){})()', 'a?.b', '`x`', '1;2']) {
    assert.throws(() => compile(bad), /./, `should reject: ${bad}`);
  }
});
t('rejects unknown fields (no probing the host object)', () => {
  assert.throws(() => run('globalThis.process.pid', {}), /cannot be read|Unknown field|is not allowed/);
  assert.throws(() => run("worksheet['BASIC'].toString()", { worksheet: { BASIC: 1 } }), /is not a number|not available|Nothing expected/);
  assert.throws(() => run("worksheet['BASIC']['x']", { worksheet: { BASIC: 1 } }), /./);
});
t('reports a usable error position', () => {
  assert.throws(() => compile('basic * (1'), /closing/);
  assert.throws(() => compile('basic +* 1'), /not allowed|Unexpected|Expected/);
  assert.throws(() => compile('pow(basic,2)'), /Unknown function/);
});

// ── engine ─────────────────────────────────────────────────────────────────────────────────────
console.log('\npayroll engine');
const settingsRow = {
  company_name: 'OXP Pvt Ltd', state: 'Gujarat', payroll_day_basis: 'ACTUAL_WORKING_DAYS', default_hours_per_day: 8,
  overtime_multiplier: 2, round_net_to_rupee: false, pf_enabled: true, pf_employee_pct: 12, pf_employer_pct: 12,
  pf_wage_ceiling: 15000, esi_enabled: true, esi_employee_pct: 0.75, esi_employer_pct: 3.25, esi_wage_limit: 21000,
  pt_enabled: true, pt_monthly: 200, pt_annual_cap: 2500, pt_charge_slice: 'MONTH', advance_percentage: 50,
};
const settings = settingsFrom(settingsRow);
const employee = { id: 'e1', employee_code: 'EMP0042', name: 'Aarav Mehta', status: 'ACTIVE', employee_type: 'FULL_TIME',
                   job_position: 'Payroll Specialist', department: 'Finance', date_of_joining: '2025-04-01', bank_account_number: '1234', work_email: 'aarav@oxp.com' };
const contract = { id: 'c1', wage: 85000, start_date: '2025-04-01', end_date: null };
const ptSlabs = [{ state: 'Gujarat', wage_from: 0, wage_to: 50000, monthly_amount: 150 }, { state: 'Gujarat', wage_from: 50000, wage_to: null, monthly_amount: 200 }];
const rules = [
  { id: 'r1', code: 'BASIC', name: 'Basic Salary', category: 'BASIC', line_kind: 'EARNING', sequence: 1, computation_type: 'PERCENTAGE', percentage: 40, base_code: 'CONTRACT_WAGE', pro_rata: true },
  { id: 'r2', code: 'HRA', name: 'House Rent Allowance', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 2, computation_type: 'PERCENTAGE', percentage: 50, base_code: 'BASIC', pro_rata: true },
  { id: 'r3', code: 'MEDA', name: 'Medical Allowance', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 3, computation_type: 'FIXED', amount: 1250, pro_rata: true },
  { id: 'r4', code: 'CONV', name: 'Conveyance Allowance', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 4, computation_type: 'FIXED', amount: 1600, pro_rata: true },
  { id: 'r5', code: 'PERB', name: 'Performance Bonus', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 5, computation_type: 'FORMULA', formula: 'bonus_rate * wage', pro_rata: false, evaluation_period: 'MONTH_ONCE' },
  { id: 'r6', code: 'OT', name: 'Overtime', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 6, computation_type: 'FORMULA', statutory: true, pro_rata: false, condition_expr: 'overtime_hours > 0' },
  { id: 'r7', code: 'GROSS', name: 'Gross Earnings', category: 'GROSS', line_kind: 'REPORT', sequence: 100, computation_type: 'FIXED', amount: 0, is_report_only: true },
  { id: 'r8', code: 'PF', name: 'Provident Fund', category: 'DEDUCTION', line_kind: 'DEDUCTION', sequence: 110, computation_type: 'PERCENTAGE', percentage: 12, base_code: 'CONTRACT_WAGE', statutory: true, pro_rata: true },
  { id: 'r9', code: 'PT', name: 'Professional Tax', category: 'DEDUCTION', line_kind: 'DEDUCTION', sequence: 120, computation_type: 'FIXED', amount: 200, statutory: true, pro_rata: false },
  { id: 'r10', code: 'NET', name: 'Net Pay', category: 'NET', line_kind: 'REPORT', sequence: 200, computation_type: 'FIXED', amount: 0, is_report_only: true },
];
const monthPeriod = (over = {}) => ({ from: '2026-02-01', to: '2026-02-28', key: '2026-02', payFrequency: 'MONTHLY', computeMode: 'PRO_RATA', factor: 1, expectedSliceDays: 20, expectedMonthDays: 20, calendarDays: 28, expectedSliceHours: 80, ...over });

t('full month: 40% basic, 50% HRA of basic, PF capped at the wage ceiling', () => {
  const out = computePayslip({ employee, contract, structure: { name: 'Regular Salary' }, rules, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: { bonus_rate: 0.1 }, prior: {}, settings });
  const g = (c) => out.lines.find((l) => l.rule_code === c).amount;
  assert.equal(g('BASIC'), 3400000);          // 40% of 85000
  assert.equal(g('HRA'), 1700000);             // 50% of BASIC, not of wage
  assert.equal(g('PERB'), 850000);             // formula: 0.10 × wage
  assert.equal(g('PF'), 180000);               // 12% of 15000 ceiling (not of 85000)
  assert.equal(out.totals.gross, 6235000);
  assert.equal(out.totals.deductions, 200000); // PF 1800.00 + PT 200.00
  assert.equal(out.totals.net, 6035000);
  assert.equal(fromPaise(out.lines.find((l) => l.rule_code === 'GROSS').amount), '62350.00');
});
t('computation_log explains each line in rupees', () => {
  const out = computePayslip({ employee, contract, rules, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: { bonus_rate: 0.1 }, prior: {}, settings });
  assert.match(out.lines.find((l) => l.rule_code === 'PF').computation_log, /12% of ₹15000\.00 \(ceiling applied: wage ₹85000\.00\)/);
  assert.match(out.lines.find((l) => l.rule_code === 'PT').computation_log, /Slab ₹50000\.00–∞ → ₹200\.00\/month \(Gujarat\)/);
});
t('PRO_RATA half month: 10 of 20 expected days → factor 0.5 on prorable lines only', () => {
  const p = monthPeriod({ from: '2026-02-01', to: '2026-02-15', key: '2026-02-H1', half: 'FIRST', isHalf: true, factor: 0.5, expectedSliceDays: 10, payFrequency: 'HALF_MONTH_FIRST', computeMode: 'PRO_RATA' });
  const out = computePayslip({ employee, contract, rules, ptSlabs, period: p, attendance: {}, leaves: {}, inputs: { bonus_rate: 0.1 }, prior: {}, settings });
  const g = (c) => out.lines.find((l) => l.rule_code === c).amount;
  assert.equal(p.factor, 0.5);
  assert.equal(g('BASIC'), 1700000);
  assert.equal(g('HRA'), 850000);
  assert.equal(g('MEDA'), 62500);
  assert.equal(g('PERB'), 850000);            // MONTH_ONCE, formula, pro_rata false → full amount once
  assert.equal(g('PT'), 20000);                // pt_charge_slice MONTH → charged in every payslip
  assert.equal(g('PF'), 90000);                // PF is wage-based → halved along with the salary
  assert.equal(out.totals.gross, 3542500);
  assert.equal(out.totals.net, 3432500);
});
t('LOP and unpaid leave reduce paid days, absence reduces nothing else', () => {
  const att = attendanceStats({ rows: [
    { day: '2026-02-02', status: 'PRESENT', worked_hours: 9, overtime_hours: 0, overtime_approved: false },
    { day: '2026-02-03', status: 'LATE', worked_hours: 8.5, overtime_hours: 0, overtime_approved: false },
    { day: '2026-02-04', status: 'ABSENT', worked_hours: 0 },
    { day: '2026-02-05', status: 'OVERTIME', worked_hours: 9.5, overtime_hours: 1.5, overtime_approved: true },
    { day: '2026-02-06', status: 'HALF_DAY', worked_hours: 4 },
  ], from: '2026-02-01', to: '2026-02-28', expectedHours: 80 });
  assert.equal(att.present, 3.5);   // a half day is worth half a day, which is what LOP needs
  assert.equal(att.halfDay, 1); assert.equal(att.absent, 1); assert.equal(att.late, 1);
  assert.equal(att.overtimeHours, 1.5);                 // only the approved row counts
  assert.equal(att.workedHours, 31);   // 9 + 8.5 + 0 + 9.5 + 4
  // fixture mirrors the real time_off_types columns: unit DAYS|HOURS, is_unpaid, sandwich_rule
  const types = new Map([['SL', { name: 'Sick Leave', code: 'SL', unit: 'DAYS', is_unpaid: true }],
                         ['PL', { name: 'Privilege Leave', code: 'PL', unit: 'DAYS', is_unpaid: false }],
                         ['HALF', { name: 'Half Day', code: 'HALF', unit: 'HOURS', is_unpaid: true }]]);
  const scheduleDays = { 1: { start_time: '09:30', end_time: '18:30', break_minutes: 60 }, 2: { start_time: '09:30', end_time: '18:30', break_minutes: 60 },
                         3: { start_time: '09:30', end_time: '18:30', break_minutes: 60 }, 4: { start_time: '09:30', end_time: '18:30', break_minutes: 60 },
                         5: { start_time: '09:30', end_time: '18:30', break_minutes: 60 }, 6: { is_rest_day: true }, 7: { is_rest_day: true } };
  const reqs = [
    { status: 'APPROVED', start_date: '2026-02-09', end_date: '2026-02-10', duration: 2, approved_days: 2, time_off_type_id: 'SL' },
    { status: 'APPROVED', start_date: '2026-02-12', end_date: '2026-02-13', duration: 2, time_off_type_id: 'PL' },   // Thu+Fri, no approved_days → derived
    { status: 'APPROVED', start_date: '2026-02-16', end_date: '2026-02-16', duration: 4, time_off_type_id: 'HALF' }, // 4 h of an 8 h day
    { status: 'TO_APPROVE', start_date: '2026-02-20', end_date: '2026-02-20', duration: 1, time_off_type_id: 'SL' },// not approved → ignored
  ];
  const leaves = leaveStats({ requests: reqs, from: '2026-02-01', to: '2026-02-28', expectedDays: 20, typesById: types, scheduleDays, holidays: [], hoursPerDay: 8 });
  assert.equal(leaves.lop, 2.5, 'unpaid = 2 sick days + half a day, pending request excluded');
  assert.equal(leaves.paid, 2, 'approved privilege leave does not cost the employee anything');
  assert.equal(leaves.byType['Sick Leave'], 2);
  assert.equal(leaves.byCode.PL, 2);
  assert.equal(leaves.sick, 2);
});
t('overtime pays hours × (wage ÷ expected days ÷ hours per day) × multiplier', () => {
  const out = computePayslip({ employee, contract, rules, ptSlabs, period: monthPeriod(), attendance: { overtimeHours: 1.5 }, leaves: {}, inputs: {}, prior: {}, settings });
  const ot = out.lines.find((l) => l.rule_code === 'OT').amount;
  // 85000 / 20 days / 8 h = 531.25 ; × 1.5 h × 2 = 1593.75
  assert.equal(fromPaise(ot), '1593.75');
  assert.match(out.lines.find((l) => l.rule_code === 'OT').computation_log, /1.5 approved OT hrs × \(₹85000\.00 ÷ 20 days ÷ 8 h\) × 2/);
});
t('ESI applies under the wage limit and not above it', () => {
  const esiRules = [...rules.filter((r) => !['PF', 'PT'].includes(r.code)), { id: 're', code: 'ESI', name: 'ESI', category: 'DEDUCTION', line_kind: 'DEDUCTION', sequence: 130, computation_type: 'PERCENTAGE', statutory: true, pro_rata: true }];
  const low = computePayslip({ employee: { ...employee }, contract: { ...contract, wage: 20000 }, rules: esiRules, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: {}, prior: {}, settings });
  assert.equal(fromPaise(low.lines.find((l) => l.rule_code === 'ESI').amount), '150.00'); // 0.75% of 20000
  const high = computePayslip({ employee, contract, rules: esiRules, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: {}, prior: {}, settings });
  assert.equal(high.lines.find((l) => l.rule_code === 'ESI').amount, 0);
});
t('PT annual cap stops the 13th month charge', () => {
  const prior = { ytd_pt: 250000 };   // paise: ₹2,500 already booked against the ₹2,500 annual cap
  const out = computePayslip({ employee, contract, rules, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: {}, prior, settings });
  assert.equal(out.lines.find((l) => l.rule_code === 'PT').amount, 0);
});
t('the PT annual cap trims the last month instead of erasing it', () => {
  const cap = settingsFrom({ ...settingsRow, pt_annual_cap: 500 });   // ₹500 a year, ₹200 a month
  const feb = computePayslip({ employee, contract, rules, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: { bonus_rate: 0.1 }, prior: {}, settings: cap });
  const mar = computePayslip({ employee, contract, rules, ptSlabs, period: monthPeriod({ key: '2026-03', from: '2026-03-01', to: '2026-03-31' }),
                               attendance: {}, leaves: {}, inputs: { bonus_rate: 0.1 }, prior: { ytd_pt: 20000 }, settings: cap });   // ₹200 booked
  const last = computePayslip({ employee, contract, rules, ptSlabs, period: monthPeriod({ key: '2026-04', from: '2026-04-01', to: '2026-04-30' }),
                                attendance: {}, leaves: {}, inputs: { bonus_rate: 0.1 }, prior: { ytd_pt: 40000 }, settings: cap });   // ₹400 booked
  assert.equal(fromPaise(feb.lines.find((l) => l.rule_code === 'PT').amount), '200.00');
  assert.equal(fromPaise(mar.lines.find((l) => l.rule_code === 'PT').amount), '200.00');
  assert.equal(fromPaise(last.lines.find((l) => l.rule_code === 'PT').amount), '100.00');   // only ₹100 of the ₹500 cap is left
  assert.match(last.lines.find((l) => l.rule_code === 'PT').computation_log, /Annual PT cap/);
});
t('MONTH_ONCE stops a bonus repeating across the two halves', () => {
  const p = monthPeriod({ half: 'SECOND', from: '2026-02-16', to: '2026-02-28', key: '2026-02-H2', factor: 0.5, expectedSliceDays: 10,
                          prior: null, isHalf: true, payFrequency: 'HALF_MONTH_SECOND' });
  const out = computePayslip({ employee, contract, rules, ptSlabs, period: p, attendance: {}, leaves: {}, inputs: { bonus_rate: 0.1 }, prior: { month_codes: ['PERB'] }, settings });
  assert.equal(out.lines.find((l) => l.rule_code === 'PERB').amount, 0);
});
t('an ADJUSTMENT/arrear line is signed and still lands in the net', () => {
  const out = computePayslip({ employee, contract, rules, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {},
                               inputs: { bonus_rate: 0.1 }, arrears: [{ reason: 'Underpaid Jan', amount: '500.00' }, { reason: 'Loan recovery short', amount: '-100.00' }], prior: {}, settings });
  assert.equal(out.lines.find((l) => l.rule_code === 'ARREAR')?.amount, toPaise(400));
});
t('rounding off touches the net once, not every line', () => {
  const s2 = settingsFrom({ ...settingsRow, round_net_to_rupee: true });
  const c2 = { ...contract, wage: 85003.33 };
  const out = computePayslip({ employee, contract: c2, rules, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: { bonus_rate: 0.1 }, prior: {}, settings: s2 });
  assert.ok(out.lines.some((l) => l.rule_code === 'ROUND_OFF'));
  assert.equal(out.totals.net % 100, 0);
});
t('negative net is reported and flagged, not silently paid', () => {
  const out = computePayslip({ employee, contract: { ...contract, wage: 0 }, rules: [...rules, { id: 'rz', code: 'ADV', name: 'Salary Advance', category: 'DEDUCTION', line_kind: 'DEDUCTION', sequence: 150, computation_type: 'FIXED', amount: 5000, pro_rata: false }],
                               ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: {}, prior: {}, settings });
  assert.ok(out.totals.net < 0);
  const w = payslipWarnings({ employee, contract: { ...contract, wage: 0 }, period: monthPeriod(), attendance: {}, leaves: {}, totals: out.totals, rules, settings });
  assert.ok(w.some((x) => x.code === 'NEGATIVE_NET') && w.some((x) => x.code === 'ZERO_WAGE'));
});

t('LOP: absences and unpaid leave cost a per-day amount driven by day_basis', () => {
  const lopRules = [...rules, { id: 'rlop', code: 'LOP', name: 'Loss of Pay', category: 'DEDUCTION', line_kind: 'DEDUCTION', sequence: 115, computation_type: 'FIXED', amount: 0, statutory: true, pro_rata: false }];
  const out = computePayslip({ employee, contract, rules: lopRules, ptSlabs, period: monthPeriod(),
                               attendance: { absent: 2, present: 18 }, leaves: { lop: 0 }, inputs: { bonus_rate: 0.1 }, prior: {}, settings });
  const lop = out.lines.find((l) => l.rule_code === 'LOP');
  // gross for the month is 62350.00 over 20 expected days → 3117.50 a day → 2 days = 6235.00
  assert.equal(fromPaise(lop.amount), '6235.00');
  const fixed = settingsFrom({ ...settingsRow, payroll_day_basis: 'FIXED_26' });
  const out2 = computePayslip({ employee, contract, rules: lopRules, ptSlabs, period: monthPeriod(),
                                attendance: { absent: 2, present: 18 }, leaves: { lop: 0 }, inputs: { bonus_rate: 0.1 }, prior: {}, settings: fixed });
  assert.equal(fromPaise(out2.lines.find((l) => l.rule_code === 'LOP').amount), '4796.15'); // 62350 / 26 × 2
  const withLeave = computePayslip({ employee, contract, rules: lopRules, ptSlabs, period: monthPeriod(),
                                     attendance: {}, leaves: { lop: 1, total: 1 }, inputs: { bonus_rate: 0.1 }, prior: {}, settings });
  assert.equal(fromPaise(withLeave.lines.find((l) => l.rule_code === 'LOP').amount), '3117.50');
});

// ── half-month policies (the headline feature) ───────────────────────────────────────────────
console.log('\nhalf-month payroll');
t('resolvePeriod derives the factor from expected days, not from 15/28', () => {
  const p = resolvePeriod({ payFrequency: 'HALF_MONTH_FIRST', from: '2026-02-01', to: '2026-02-15', key: '2026-02-H1', computeMode: 'PRO_RATA', settings,
                            month: { expectedDays: 20 }, slice: { expectedDays: 10, hours: 40, calendarDays: 15, from: '2026-02-01', to: '2026-02-15' } });
  assert.equal(p.factor, 0.5);
  assert.equal(p.half, 'FIRST');
  const q = resolvePeriod({ payFrequency: 'HALF_MONTH_FIRST', from: '2026-09-01', to: '2026-09-15', key: '2026-09-H1', computeMode: 'PRO_RATA', settings,
                            month: { expectedDays: 21 }, slice: { expectedDays: 12, hours: 48, calendarDays: 15, from: '2026-09-01', to: '2026-09-15' } });
  assert.equal(q.factor, 0.571429);   // 12/21 — a real pro-rata, not 0.5
});
t('scaleToNet hits the advance target exactly and keeps the pieces adding up', () => {
  const month = computePayslip({ employee, contract, rules, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: { bonus_rate: 0.1 }, prior: {}, settings });
  const target = Math.round(month.totals.net / 2);
  const { lines, scale } = scaleToNet(month.lines.filter((l) => l.line_kind !== 'REPORT'), target, { note: 'advance 50%' });
  assert.equal(netOf(lines), target);
  assert.ok(scale > 0.49 && scale < 0.51);
});
t('ADVANCE_50 then true-up: H1 + H2 = the month net, to the paise', () => {
  const month = computePayslip({ employee, contract, rules, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: { bonus_rate: 0.1 }, prior: {}, settings });
  const monthLines = month.lines.filter((l) => l.line_kind !== 'REPORT');
  const h1Target = Math.round(month.totals.net / 2);
  const h1 = scaleToNet(monthLines, h1Target, { note: 'advance' }).lines;
  const h1Net = netOf(h1);
  const { lines: h2, residual } = trueUp({ monthLines, h1ByCode: byCode(h1), h1Net, monthNet: month.totals.net, sequenceAfter: 900 });
  assert.equal(netOf(h2), month.totals.net - h1Net);
  assert.equal(h1Net + netOf(h2), month.totals.net, 'halves must add up to the month');
  assert.equal(residual, 0, 'true-up residual should be zero when nothing changed mid-month');
});
t('an H1 manual edit is honoured by the H2 settlement', () => {
  const month = computePayslip({ employee, contract, rules, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: { bonus_rate: 0.1 }, prior: {}, settings });
  const monthLines = month.lines.filter((l) => l.line_kind !== 'REPORT');
  const h1 = scaleToNet(monthLines, Math.round(month.totals.net / 2), { note: 'advance' }).lines.map((l) => (l.rule_code === 'MEDA' ? { ...l, amount: l.amount + 100000 } : l));
  const h1Net = netOf(h1);
  const { lines: h2 } = trueUp({ monthLines, h1ByCode: byCode(h1), h1Net, monthNet: month.totals.net, sequenceAfter: 900 });
  assert.equal(h1Net + netOf(h2), month.totals.net);
  const meda = h2.find((l) => l.rule_code === 'MEDA');
  assert.equal(meda.amount, 37500);                        // 1250.00 month − 1625.00 actually paid in H1 → recover 375.00
  assert.equal(meda.line_kind, 'DEDUCTION');
});

t('a fixed rule honours cap_amount (a per-day allowance capped per month)', () => {
  const withCap = [...rules, { id: 'rcap', code: 'DAYA', name: 'Site Allowance', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 8,
                               computation_type: 'FIXED', amount: 500, quantity_expr: 'expected_days', cap_amount: 5000 }];
  const out = computePayslip({ employee, contract, rules: withCap, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: {}, prior: {}, settings });
  assert.equal(out.lines.find((l) => l.rule_code === 'DAYA').amount, 500000);   // ₹500 × 20 days = ₹10,000 → capped ₹5,000
  const noCap = computePayslip({ employee, contract, rules: withCap.map((r) => (r.code === 'DAYA' ? { ...r, cap_amount: null } : r)),
                                ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: {}, prior: {}, settings });
  assert.equal(noCap.lines.find((l) => l.rule_code === 'DAYA').amount, 1000000);
});
t('a fixed rule marked month_once is charged once per calendar month', () => {
  const monthlyOnce = [...rules, { id: 'rlta', code: 'LTA', name: 'Leave Travel Allowance', category: 'REIMBURSEMENT', line_kind: 'EARNING', sequence: 9,
                                   computation_type: 'FIXED', amount: 1000, pro_rata: false, evaluation_period: 'MONTH_ONCE' }];
  const first = computePayslip({ employee, contract, rules: monthlyOnce, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: {}, prior: {}, settings });
  const secondHalf = computePayslip({ employee, contract, rules: monthlyOnce, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: {},
                                     prior: { month_codes: ['LTA'], by_rule_month: { LTA: 1000 } }, settings });
  assert.equal(first.lines.find((l) => l.rule_code === 'LTA').amount, 100000);
  assert.equal(secondHalf.lines.find((l) => l.rule_code === 'LTA').amount, 0, 'the second half of the month must not pay it again');
});
t('rounding_mode floors or ceils a line to the rupee', () => {
  const meda = (mode) => rules.map((r) => (r.code === 'MEDA' ? { ...r, amount: 1250.44, rounding_mode: mode } : r));
  const calc = (rs) => computePayslip({ employee, contract, rules: rs, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: {}, prior: {}, settings })
    .lines.find((l) => l.rule_code === 'MEDA').amount;
  assert.equal(calc(meda('down')), 125000);
  assert.equal(calc(meda('up')), 125100);
  assert.equal(calc(meda('half_up')), 125044, 'the default keeps every paisa');
});
t('taxable gross excludes allowances flagged non-taxable', () => {
  const rs = rules.map((r) => (r.code === 'CONV' ? { ...r, is_taxable: false } : r));
  const out = computePayslip({ employee, contract, rules: rs, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: { bonus_rate: 0.1 }, prior: {}, settings });
  assert.equal(out.totals.taxableGross, out.totals.gross - 160000);
  assert.equal(out.meta.computation_summary.taxableGross, Number((out.totals.taxableGross / 100).toFixed(2)));
});
t('depends_on pulls a later-numbered dependency ahead instead of reading an empty worksheet', () => {
  const rs = [...rules, { id: 'rspec', code: 'SPEC', name: 'Special Allowance', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 2,
                           computation_type: 'PERCENTAGE', percentage: 10, base_code: 'LATE', depends_on: ['LATE'] },
                        { id: 'rlate', code: 'LATE', name: 'Arrears Component', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 60, computation_type: 'FIXED', amount: 2000 }];
  const out = computePayslip({ employee, contract, rules: rs, ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: { bonus_rate: 0.1 }, prior: {}, settings });
  assert.equal(out.lines.find((l) => l.rule_code === 'SPEC').amount, 20000, '10% of the ₹2,000 dependency = ₹200');
  assert.ok(!out.warnings.some((w) => w.code === 'RULE_ERROR'), 'no RULE_ERROR from a forward reference');
  const orphan = computePayslip({ employee, contract, rules: [...rules, { id: 'rx', code: 'RX', name: 'Orphan', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 9, computation_type: 'FIXED', amount: 10, depends_on: ['NOPE'] }],
                                  ptSlabs, period: monthPeriod(), attendance: {}, leaves: {}, inputs: { bonus_rate: 0.1 }, prior: {}, settings });
  assert.ok(orphan.warnings.some((w) => w.code === 'DEPENDENCY_MISSING'));
  assert.equal(out.warnings.filter((w) => w.code === 'RULE_ERROR').length, 0, 'no formula error from the forward reference');
});

// ── access control ─────────────────────────────────────────────────────────────────────────────
console.log('\naccess control');
const perms = (roles) => permissionsFor(roles).list;
t('an employee can raise leave but never sees a payslip of someone else', () => {
  const roles = ['EMPLOYEE'];
  assert.ok(can('timeoff:request', { roles, permissions: perms(roles) }));
  assert.ok(!can('payslip:read_all', { roles, permissions: perms(roles) }));
  assert.ok(!can('payroll:compute', { roles, permissions: perms(roles) }));
  assert.ok(!can('user:write', { roles, permissions: perms(roles) }));
  assert.equal(scopeFor(roles), 'own');
});
t('HR Manager can run HR but cannot compute payroll', () => {
  const roles = ['HR_MANAGER'];
  assert.ok(can('employee:write', { roles, permissions: perms(roles) }));
  assert.ok(can('attendance:approve_overtime', { roles, permissions: perms(roles) }));
  assert.ok(!can('payroll:compute', { roles, permissions: perms(roles) }));
  assert.ok(!can('salary:rule_write', { roles, permissions: perms(roles) }));
  assert.ok(!can('dashboard:payroll', { roles, permissions: perms(roles) }));
  assert.equal(scopeFor(roles), 'company');
});
t('Payroll User computes but cannot send bulk email or delete a payrun', () => {
  const roles = ['HR_PAYROLL_USER'];
  assert.ok(can('payroll:compute', { roles, permissions: perms(roles) }) && can('payroll:mark_paid', { roles, permissions: perms(roles) }));
  assert.ok(!can('payroll:send_bulk', { roles, permissions: perms(roles) }));
  assert.ok(!can('payroll:payrun_delete', { roles, permissions: perms(roles) }));
  assert.ok(!can('user:create', { roles, permissions: perms(roles) }));
});
t('Payroll Admin can send payslips and edit lines; still not manage users', () => {
  const roles = ['HR_PAYROLL_MANAGER'];
  assert.ok(can('payroll:send_bulk', { roles, permissions: perms(roles) }) && can('payslip:edit_lines', { roles, permissions: perms(roles) }));
  assert.ok(!can('user:write', { roles, permissions: perms(roles) }));
  assert.ok(isDenied('user:write', roles));
});
t('Admin has everything and drives the full nav', () => {
  const roles = ['ADMIN'];
  for (const p of ['user:write', 'audit:read', 'payroll:send_bulk', 'settings:write', 'system:seed']) assert.ok(can(p, { roles, permissions: perms(roles) }), p);
  assert.equal(navFor(roles).length, 8);
});
t('multi-role logins union their powers', () => {
  const roles = ['HR_MANAGER', 'HR_PAYROLL_USER'];
  assert.ok(can('payroll:validate', { roles, permissions: perms(roles) }));
  assert.ok(can('timeoff:approve', { roles, permissions: perms(roles) }));
  assert.ok(!can('user:reset_password', { roles, permissions: perms(roles) }));
});
t('nav follows the mockup for an HR manager (no Payroll dashboard, no User Access)', () => {
  const labels = navFor(['HR_MANAGER']).map((n) => n.label);
  assert.deepEqual(labels, ['Dashboard', 'Employees', 'Contracts', 'Attendance', 'Time Off', 'Payroll']);
  assert.deepEqual(navFor(['EMPLOYEE']).map((n) => n.to), ['/portal', '/attendance', '/time-off/my-requests', '/portal/payslips']);
});
// The bug this guards: a nav link to a screen the role cannot open, which answered with "not part of your role".
t('nav never offers a screen the role cannot open', () => {
  const payroll = navFor(['HR_MANAGER']).find((n) => n.key === 'payroll');
  assert.deepEqual(payroll.children.map((c) => c.label), ['Structures'], 'an HR manager may not open salary rules');
  const manager = navFor(['HR_PAYROLL_MANAGER']);
  assert.ok(manager.some((n) => n.key === 'settings'), 'the payroll admin keeps the company settings screen');
  assert.ok(!manager.some((n) => typeof n === 'string'), 'a nav entry is never left as a bare string');
  assert.ok(navFor(['HR_PAYROLL_USER']).find((n) => n.key === 'payroll').children.some((c) => c.to === '/payruns'));
  assert.ok(!navFor(['EMPLOYEE']).some((n) => n.to === '/payruns'), 'an employee has no payroll screens at all');
});

// The other half of the same bug class: a role that HOLDS a permission but has no menu link to the screen
// that uses it. On screen that is indistinguishable from "the approve button was never built".
t('a role that can approve leave can reach the approve list', () => {
  for (const role of ['HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN']) {
    const bag = permissionsFor([role]);
    const holds = (p) => bag.all || bag.list.includes(p);
    assert.ok(holds('timeoff:approve'), role + ' is supposed to be able to approve leave');
    const links = navFor([role]).flatMap((g) => [g.to, ...(g.children || []).map((c) => c.to)]);
    assert.ok(links.includes('/time-off/requests'), role + ' holds timeoff:approve but no menu link to /time-off/requests');
    // the general rule, one table: a write permission implies a menu entry for its screen
    for (const [perm, to] of [['schedule:write', '/working-schedules'], ['employee:write', '/employees'],
      ['contract:write', '/contracts'], ['attendance:approve_overtime', '/attendance'],
      ['user:write', '/users'], ['settings:write', '/company'], ['payroll:payrun_create', '/payruns']]) {
      if (holds(perm))
        assert.ok(links.includes(to), role + ' holds ' + perm + ' but the menu has no link to ' + to);
    }
  }
  const employeeLinks = navFor(['EMPLOYEE']).flatMap((g) => [g.to, ...(g.children || []).map((c) => c.to)]);
  assert.ok(!employeeLinks.includes('/time-off/requests'), 'an employee files leave, never approves it');
});

// ── round 4: period resolution, the routes the UI now calls, and who may call them ──────────
console.log('\nround 4');
t('a blank period end resolves to the last day of the start month', () => {
  assert.equal(resolvePeriodEnd('2028-02-03', ''), '2028-02-29', 'leap February');
  assert.equal(resolvePeriodEnd('2027-02-05', null), '2027-02-28', 'ordinary February');
  assert.equal(resolvePeriodEnd('2026-12-01', undefined), '2026-12-31');
  assert.equal(resolvePeriodEnd('2026-09-01', '2026-09-15'), '2026-09-15', 'a chosen end date is never overwritten');
  // The bug this pins: `to = period_end || period_start` gave a one-day run, so pro-rata paid ~1/30th.
  assert.notEqual(resolvePeriodEnd('2026-09-01', ''), '2026-09-01');
});
t('the routes every new button calls are registered where the UI expects them', () => {
  const payroll = readFileSync(new URL('../src/routes/payroll.routes.js', import.meta.url), 'utf8');
  const hr = readFileSync(new URL('../src/routes/hr.routes.js', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../src/routes/auth.routes.js', import.meta.url), 'utf8');
  assert.ok(payroll.includes("post('/send', { perm: 'payroll:send_bulk', body: v.bulkSendBody"), 'bulk payslip mail: POST /api/payslips/send');
  assert.ok(hr.includes("post('/allocations/bulk', { perm: 'timeoff:allocation_write', body: v.allocateManyBody"), 'bulk balances: POST /api/time-off/allocations/bulk');
  assert.ok(auth.includes("post('/change-password', { body: v.changePasswordBody"), 'self-service password: POST /api/auth/change-password');
});
t('the leave-type list is readable by the role that fills the request form', () => {
  const hr = readFileSync(new URL('../src/routes/hr.routes.js', import.meta.url), 'utf8');
  const line = hr.split('\n').find((l) => l.includes("get('/types',"));
  assert.ok(line && line.includes("'timeoff:type_read'"), `GET /time-off/types must accept timeoff:type_read, saw: ${line}`);
  const employee = permissionsFor(['EMPLOYEE']);
  assert.ok(employee.list.includes('timeoff:type_read'), 'and EMPLOYEE must actually hold it');
  assert.ok(!employee.list.includes('timeoff:approve'), 'without letting an employee approve their own leave');
});
t('bulk mail is a payroll-manager power, not a payroll-officer one', () => {
  const officer = permissionsFor(['HR_PAYROLL_USER']);
  const manager = permissionsFor(['HR_PAYROLL_MANAGER']);
  const holds = (bag, perm) => bag.all || bag.list.includes(perm);
  assert.ok(holds(manager, 'payroll:send_bulk'), 'the payroll manager may mail a selection');
  assert.ok(!holds(officer, 'payroll:send_bulk'), 'the payroll officer may not — the line the README draws');
});
t('a retired salary rule is written as a date, not a flag', () => {
  const src = readFileSync(new URL('../src/validators/payroll.schema.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export const ruleBody'), src.indexOf('export const', src.indexOf('export const ruleBody') + 10));
  assert.ok(!/is_active/.test(body), 'ruleBody has no is_active — the UI must not PATCH one');
  assert.ok(/active_to/.test(body), 'active_to is the switch that exists');
});

/* ── round 5: one role, invitation links, categories, and a refused delete that explains itself ── */
import * as userSchema from '../src/validators/user.schema.js';
import * as hrSchema from '../src/validators/hr.schema.js';
import { mapDbError, AppError } from '../src/lib/shared/errors.js';
t('an account is given exactly one role, and the older list shape says so', () => {
  const one = userSchema.createBody.parse({ name: 'A', work_email: 'a@x.com', role: 'HR_MANAGER' });
  assert.equal(one.role, 'HR_MANAGER');
  const legacy = userSchema.createBody.parse({ name: 'A', work_email: 'a@x.com', roles: ['ADMIN'] });
  assert.equal(legacy.role, 'ADMIN', 'a one-item list arrives as that role');
  const two = userSchema.createBody.safeParse({ name: 'A', work_email: 'a@x.com', roles: ['ADMIN', 'HR_MANAGER'] });
  assert.equal(two.success, false, 'two roles in the list must not be accepted here');
  assert.match(JSON.stringify(two.error?.issues || []), /one role/i, 'and the message has to name the rule');
  // Both keys have to arrive at the same answer, or the boundary is where the two shapes drift apart.
  const alsoTwo = userSchema.createBody.safeParse({ name: 'A', work_email: 'a@x.com', role: 'ADMIN', roles: ['HR_MANAGER', 'EMPLOYEE'] });
  assert.equal(alsoTwo.success, false, 'a two-item list is refused next to a role as well as instead of one');
  const none = userSchema.createBody.parse({ name: 'A', work_email: 'a@x.com' });
  assert.equal(none.role, 'EMPLOYEE', 'and no answer at all is the lowest role, as documented');
  const upd = userSchema.updateBody.parse({ roles: ['HR_MANAGER'] });
  assert.deepEqual(upd.roles, ['HR_MANAGER'], 'PATCH keeps the list shape for older clients');
});
t('the invite body takes the send-by-mail switch, and nothing else', () => {
  assert.equal(userSchema.inviteBody.parse({}).send_email, true, 'the link goes out by e-mail unless told otherwise');
  assert.equal(userSchema.inviteBody.parse({ send_email: false }).send_email, false);
  // The schema strips what it does not know rather than erroring, which is the property that matters:
  // an invitation body has no way to hand over a password, so the service never sees one.
  const junk = userSchema.inviteBody.parse({ password: 'hunterhunterhunter', send_email: true });
  assert.equal(junk.password, undefined, 'a password in an invite body is dropped, not stored');
  assert.equal(Object.keys(junk).join(','), 'send_email', 'and nothing else survives that body');
});
t('leave types are categorised, and the payoff is one of two answers', () => {
  for (const c of ['CASUAL', 'SICK', 'EARNED', 'PRIVILEGED', 'MATERNITY']) {
    assert.ok(hrSchema.LEAVE_CATEGORIES.includes(c), c + ' is a category the problem statement names');
  }
  const body = hrSchema.timeOffTypeBody;
  const okCase = body.safeParse({ name: 'Casual', code: 'CL', category: 'CASUAL', pay_treatment: 'PAID' });
  assert.equal(okCase.success, true, 'a plain casual type parses: ' + JSON.stringify(okCase.error?.issues || []));
  const bad = body.safeParse({ name: 'Weekend', code: 'WE', category: 'WEEKEND' });
  assert.equal(bad.success, false, 'and an invented category is refused, not stored');
});
t('a refused delete names the table holding the row', () => {
  const err = mapDbError({ code: '23503', constraint: 'employees_department_id_fkey',
    message: 'update or delete on table "departments" violates foreign key constraint "employees_department_id_fkey" on table "employees"',
    detail: 'Key (id)=(7) is still referenced from table "employees".' });
  assert.ok(err instanceof AppError, 'the driver error becomes an AppError');
  assert.equal(err.status, 409);
  assert.match(err.message, /employee rows/i, 'the sentence says who holds it: ' + err.message);
  assert.match(err.message, /Deactivate it instead/i, 'and offers the way round');
  assert.equal(err.details.can_deactivate, true, 'so the UI can show the button');
  assert.equal(err.details.referenced_by, 'employees');
});
t('a role change signs the account out, because the repo says so', () => {
  const repo = readFileSync(new URL('../src/repositories/user.repo.js', import.meta.url), 'utf8');
  const body = repo.slice(repo.indexOf('export async function setRoles'), repo.indexOf('export const patchUser'));
  assert.ok(/token_version = token_version \+ 1/.test(body), 'setRoles bumps token_version: ' + body.slice(0, 60));
  assert.ok(/refresh_tokens set revoked_at/.test(body), 'and drops the refresh tokens with it');
  const svc = readFileSync(new URL('../src/services/user.service.js', import.meta.url), 'utf8');
  assert.ok(/must_sign_in: true/.test(svc), 'so the answer can promise it to the UI');
});
t('a password link cannot be mailed to a peer administrator either', () => {
  const svc = readFileSync(new URL('../src/services/user.service.js', import.meta.url), 'utf8');
  const invite = svc.slice(svc.indexOf('export async function createInvite'), svc.indexOf('async function mailInvite'));
  assert.ok(/assertNotAnotherAdmin\(auth, target, 'send a password link to'\)/.test(invite),
    'createInvite has to carry the same rule the role and password routes carry');
});
t('the invitation routes are public where they must be and guarded where they must not be', () => {
  const auth = readFileSync(new URL('../src/routes/auth.routes.js', import.meta.url), 'utf8');
  const users = readFileSync(new URL('../src/routes/user.routes.js', import.meta.url), 'utf8');
  const read = auth.split('\n').find((l) => l.includes("get('/invite/:token'"));
  const set = auth.split('\n').find((l) => l.includes("post('/set-password'"));
  assert.ok(read && /public: true/.test(read), 'a person with a link has no session: ' + read);
  assert.ok(set && /public: true/.test(set), 'and the password post is the same: ' + set);
  const inv = users.split('\n').find((l) => l.includes("post('/:id/invite'"));
  assert.ok(inv && /'user:write'/.test(inv), 'issuing a link is a user-administration power: ' + inv);
  assert.ok(users.includes("post('/:id/role'"), 'the single-role route is registered');
});

t('an invitation is mailed by the request, not parked in a queue', () => {
  const cfg = readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
  const line = cfg.split('\n').find((l) => l.includes('viaQueue'));
  assert.ok(line && /INVITE_VIA_QUEUE', false/.test(line), 'the default is the direct send: ' + line);
  const svc = readFileSync(new URL('../src/services/user.service.js', import.meta.url), 'utf8');
  const direct = svc.indexOf('config.invite.viaQueue');
  assert.ok(direct > 0, 'the service must branch on that switch');
  assert.ok(svc.slice(direct, direct + 2400).includes('mailInvite('), 'both branches end up able to send');
  assert.ok(/mail_sent: mail.ok === true/.test(svc), 'and the answer says whether it was actually sent');
  const bulk = /export async function sendPendingInvites/.test(svc);
  assert.ok(bulk, 'the one-by-one bulk sender exists');
  assert.ok(/for \(const u of waiting\)/.test(svc), 'and walks accounts in order rather than in parallel');
});
t('the bulk send is bounded where it is declared, not by a queue', () => {
  const okCall = userSchema.sendPendingBody.parse({});
  assert.equal(okCall.limit, 50, 'a default that fits a morning of hiring');
  assert.equal(userSchema.sendPendingBody.parse({ limit: '7' }).limit, 7, 'a query string is coerced');
  assert.equal(userSchema.sendPendingBody.safeParse({ limit: 5000 }).success, false, 'and 5000 SMTP conversations in one request are refused');
  assert.equal(userSchema.sendPendingBody.safeParse({ token: 'x' }).token, undefined, 'nothing else survives that body');
});

// ── round 9: the four things that were reported, each pinned by what the code must now do ────────────────
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

t('an invitation answer cannot reference a name that does not exist', () => {
  // The last round's "the mail never sends" was this: the success sentence interpolated a bare `driver` while the
  // value in scope is `mailDriver`. The mail went out and the request still died, and no build step noticed.
  const src = read('../src/services/user.service.js');
  const body = src.slice(src.indexOf('export async function createInvite'), src.indexOf('async function mailInvite('))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');   // prose may talk about a driver
  const bare = [...body.matchAll(/(?<![$.\w])\bdriver\b(?!\s*:)/g)];
  assert.equal(bare.length, 0, `createInvite must not name \`driver\` on its own (found ${bare.length}) — use mailDriver`);
  assert.ok(/mailDriver/.test(body), 'and it does report the live driver, by its real name');
});

t('an invitation link is issued in minutes, and says so in the same words everywhere', () => {
  assert.equal(CONFIG.invite.ttlMinutes, 10, 'ten minutes, out of the box');
  assert.equal(linkTtlSentence(10), '10 minutes');
  assert.equal(linkTtlSentence(1), '1 minute');
  assert.equal(linkTtlSentence(60), '1 hour');
  const repo = read('../src/repositories/user.repo.js');
  assert.ok(/make_interval\(mins =>/.test(repo), 'the row is extended by minutes, not hours');
  assert.ok(/ttlMinutes = 10/.test(repo), 'and the parameter says so');
  const svc = read('../src/services/user.service.js');
  assert.ok(svc.includes('expires_in_minutes'), 'the response gives the screen the number in the same unit');
  assert.ok(!/expires_in_hours/.test(svc), 'and the old one is gone, so nothing can show "72h" again');
});

t('a time-off request waiting for approval is called what the enum calls it', () => {
  const enums = read('../db/migrations/001_enums.sql');
  const line = enums.split('\n').find((l) => l.includes('CREATE TYPE request_status'));
  assert.ok(line && /'TO_APPROVE'/.test(line) && !/PENDING/.test(line), 'the ground truth: ' + line.trim());
  for (const rel of ['../../frontend/src/pages/timeoff/LeaveRequestsPage.jsx', '../../frontend/src/pages/timeoff/MyTimeOffPage.jsx',
                     '../../frontend/src/pages/timeoff/TimeOffOverviewPage.jsx']) {
    const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');   // comments may explain the old bug
    assert.ok(!/'PENDING'/.test(code), `${rel.split('/').pop()} still uses 'PENDING' as a status`);
    assert.ok(code.includes('utils/leaveStatus.js'), `${rel.split('/').pop()} should use the shared words`);
  }
});

t('a weekly-grid row survives a day name, an empty off-day, and still refuses a bad time', () => {
  const ok = ORG_SCHEMA.scheduleBody.safeParse({ name: 'Standard', days: [
    { day: 'mon', start: '09:30', end: '18:30', break: 60 }, { day: 'SAT', rest: true }, { day: 7, start: '', end: '', break: '' }] });
  assert.equal(ok.success, true, 'a save must not die on a Sunday nobody works: ' + JSON.stringify(ok.error?.issues));
  const days = ok.data.days;
  assert.equal(days[0].day, 1, 'a name is read as the number the column stores');
  assert.deepEqual(Object.keys(days[1]).sort(), ['break', 'day', 'rest'], 'an off day carries no clock time');
  assert.ok(!('start' in days[2]) && !('start' in days[1]), 'and neither does one sent with empty boxes');
  assert.equal(ORG_SCHEMA.scheduleBody.safeParse({ name: 'X', days: [{ day: 2, start: '9am', end: '18:00' }] }).success, false,
    'a worked day with a time nobody can read is still refused');
  assert.equal(ORG_SCHEMA.scheduleBody.safeParse({ name: 'X', days: [{ day: 9 }] }).success, false, 'and a 9th day is');
});

t('the demo company is big enough to run payroll, and every generated row is possible', () => {
  const { EMPLOYEES, RUNS, ATTENDANCE_MONTHS, DEPARTMENTS, STRUCTURES, TODAY, HEADCOUNT } = SEED;
  assert.ok(EMPLOYEES.length >= 100, `a payroll demo needs a crowd, has ${EMPLOYEES.length}`);
  assert.equal(EMPLOYEES.length, HEADCOUNT, 'the knob and the list agree');
  assert.ok(EMPLOYEES.length <= 400, 'and stays small enough to seed on a laptop');
  const emails = new Set(EMPLOYEES.map((e) => e.email.toLowerCase()));
  assert.equal(emails.size, EMPLOYEES.length, 'two people cannot share a sign-in address');
  const codes = new Set(EMPLOYEES.map((e) => e.key));
  assert.equal(codes.size, EMPLOYEES.length, 'and no two rows share a key');
  const structureCodes = new Set(STRUCTURES.map((x) => x.code));
  const deptNames = new Set(DEPARTMENTS.map((d) => d.name));
  const byKey = new Map();
  EMPLOYEES.forEach((e, i) => byKey.set(e.key, i));
  for (const [i, e] of EMPLOYEES.entries()) {
    assert.ok(e.joining <= TODAY, `${e.key} joins in the future`);
    assert.ok(!e.exit || (e.exit >= e.joining && e.exit <= TODAY), `${e.key} has an impossible exit date`);
    const years = (new Date(e.joining) - new Date(e.dob)) / 3.15576e10;
    assert.ok(years >= 18 && years <= 60, `${e.key} is ${years.toFixed(1)} years old on day one`);
    assert.ok(/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(e.pan), `${e.key} has a PAN the employee form would refuse: ${e.pan}`);
    assert.ok(/^[A-Z]{4}0[A-Z0-9]{6}$/.test(e.ifsc), `${e.key}: ${e.ifsc}`);
    assert.ok(/^[0-9]{12}$/.test(e.uan), `${e.key} UAN`);
    assert.ok(/^[0-9]{6,18}$/.test(e.bank_account), `${e.key} bank account`);
    assert.ok(/^[1-9][0-9]{5}$/.test(e.pin), `${e.key} pincode`);
    assert.ok(/^[6-9][0-9]{9}$/.test(e.phone), `${e.key} phone`);
    if (e.esic) {
      assert.ok(/^[0-9]{17}$/.test(e.esic), `${e.key} ESIC number`);
      assert.ok(e.wage <= 21000, `${e.key} is insured above the ESI wage limit`);
    }
    assert.ok(deptNames.has(e.dept), `${e.key} is in a department that does not exist`);
    assert.ok(structureCodes.has(e.structure), `${e.key} is on an unknown structure`);
    assert.ok(!e.manager || byKey.get(e.manager) < i, `${e.key} reports to someone who joins after them`);
    assert.notEqual(e.manager, e.key, `${e.key} is their own manager`);
  }
  // The complaint this answers: the current period had nobody on the payroll.
  const current = RUNS[RUNS.length - 1];
  assert.equal(current.status, 'DRAFT', 'this month is left for a person to compute');
  assert.equal(current.from, `${TODAY.slice(0, 7)}-01`, 'and it is this month, not a month written in a file');
  assert.ok(ATTENDANCE_MONTHS.includes(TODAY.slice(0, 7)), 'with attendance for it');
  const onPayroll = EMPLOYEES.filter((e) => !e.exit && e.joining <= current.to);
  assert.ok(onPayroll.length >= 100, `only ${onPayroll.length} people could be paid in the current period`);
  const spread = new Set(onPayroll.map((e) => e.structure));
  assert.ok(spread.size >= 2, 'across more than one pay structure');
  for (const code of spread) {
    const n = onPayroll.filter((e) => e.structure === code).length;
    assert.ok(n >= 5, `${code} has ${n} people — a run on it would look empty`);
  }
});

t('the seeder does not hard-code a financial year or a month again', () => {
  const src = read('../db/seed/seed.js');
  assert.ok(!/'20\d\d-\d\d-\d\d/.test(src.replace(/period_start|period_end/g, '')), 'no literal date left in the seeder');
  assert.ok(src.includes('FY.from'), 'allocations follow the financial year from the data module');
  assert.ok(/status: 'TO_APPROVE'/.test(src), 'and a waiting request uses the enum word');
});

// ── round 10: mail needs an address and a password, nothing else ───────────────────────────
console.log('\nmail from the address alone');
const MAILER = await import('../src/lib/mailer/index.js');
const RUNTIME = await import('../src/lib/mailer/runtime.js');
const { providerFor, providerList, describeServer } = MAILER;
t('a known address names its own server, and an unknown one does not', () => {
  assert.equal(providerFor('Payroll@Gmail.COM').host, 'smtp.gmail.com');
  assert.equal(providerFor('hr@user@gmailmail.com'), null, 'a look-alike domain is not Gmail');
  assert.equal(providerFor('hr@payroll@gmail.com.').key, 'google', 'a trailing dot is nothing');
  assert.equal(providerFor('hr@acme-biz.example'), null, 'nor is an unknown company domain');
  assert.equal(providerFor('no-at-sign'), null, 'and a box still being typed is not an address');
  // The settings panel reads this list off the API rather than keeping its own copy, so it has to carry the fields.
  for (const p of providerList()) {
    assert.ok(Array.isArray(p.domains) && p.domains.length, `${p.key} states the domains it answers for`);
    assert.ok(p.domains.includes(providerFor(`x@${p.domains[0]}`).domains[0]), `${p.key} matches on its own domains`);
    for (const k of ['label', 'host', 'port', 'secure', 'appPassword', 'note'])
      assert.ok(p[k] !== undefined && p[k] !== '', `the panel reads ${k} from the API, so it has to be in the list`);
  }
});
t('resolveDriver: two values are a complete configuration', () => {
  const gmail = MAILER.resolveDriver({ EMAIL_NAME: 'payroll@gmail.com', EMAIL_PASSWORD: 'abcd efgh ijkl mnop' });
  assert.equal(gmail.driver, 'gmail', 'a Gmail box is sent Gmail\u2019s own way');
  assert.deepEqual(gmail.server, { host: 'smtp.gmail.com', port: 465, secure: true });
  assert.equal(gmail.needsAppPassword, true, 'and the panel can warn about the password kind');
  assert.equal(describeServer(gmail.server), 'smtp.gmail.com:465 · implicit TLS');
  const leftovers = MAILER.resolveDriver({ EMAIL_NAME: 'payroll@gmail.com', EMAIL_PASSWORD: 'x', SMTP_PORT: '587', SMTP_SECURE: 'false' });
  assert.deepEqual(leftovers.server, { host: 'smtp.gmail.com', port: 465, secure: true },
    'an env that still carries the old SMTP_PORT line does not split Gmail across two ports');
  const live = MAILER.resolveDriver({ EMAIL_NAME: 'payroll@outlook.in', EMAIL_PASSWORD: 'x' });
  assert.equal(live.driver, 'smtp');
  assert.deepEqual(live.server, { host: 'smtp.office365.com', port: 587, secure: false }, 'Microsoft is STARTTLS');
  const unknown = MAILER.resolveDriver({ EMAIL_NAME: 'hr@acme-biz.example', EMAIL_PASSWORD: 'x' });
  assert.equal(unknown.driver, 'preview', 'we do not guess a host for a domain we do not know');
  assert.match(unknown.note, /Google, Microsoft[^.]*are recognised from the address alone/);
  assert.match(unknown.note, /acme-biz\.example is not one of them/);
  const forced = MAILER.resolveDriver({ MAIL_DRIVER: 'smtp' });
  assert.equal(forced.driver, 'preview', 'a forced driver with no host is still not a licence to dial nothing');
  assert.match(forced.note, /no host is known/);
});
t('what you typed beats the table, box for box', () => {
  const typed = MAILER.resolveDriver({ EMAIL_NAME: 'payroll@gmail.com', EMAIL_PASSWORD: 'x',
                                        SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_SECURE: 'false' });
  assert.deepEqual(typed.server, { host: 'smtp.gmail.com', port: 587, secure: false });
  assert.equal(typed.inferred, null, 'nothing was inferred, so nothing is claimed as inferred');
  const relay = MAILER.resolveDriver({ EMAIL_NAME: 'hr@acme.com', EMAIL_PASSWORD: 'x', SMTP_HOST: 'smtp.acme.com', SMTP_PORT: '2525' });
  assert.equal(relay.driver, 'smtp');
  assert.deepEqual(relay.server, { host: 'smtp.acme.com', port: 2525, secure: false });
});
t('a saved row with only an address gets the same treatment as the environment', () => {
  const merged = RUNTIME.resolveMailConfig({ smtp_user: 'payroll@gmail.com', smtp_password: 'app pw', mail_enabled: true, smtp_secure: false }, {});
  const plan = MAILER.resolveDriver(merged);
  assert.equal(plan.driver, 'gmail', 'the settings screen asks for two fields, so two fields must be enough');
  assert.equal(plan.server.port, 465, 'an unticked TLS box is not a refusal of implicit TLS when no host was typed');
  const withHost = RUNTIME.resolveMailConfig({ smtp_user: 'payroll@gmail.com', smtp_password: 'x', smtp_host: 'smtp.acme.com', smtp_port: 587, smtp_secure: false }, {});
  assert.deepEqual(MAILER.resolveDriver(withHost).server, { host: 'smtp.acme.com', port: 587, secure: false },
    'a company relay behind a Gmail-shaped address is still the relay');
  const off = MAILER.resolveDriver(RUNTIME.resolveMailConfig({ smtp_user: 'payroll@gmail.com', smtp_password: 'x', mail_enabled: false }, {}));
  assert.equal(off.driver, 'preview', 'the switch on the screen is the last word');
});
t('a placeholder host is ignored, a real one never is', () => {
  // The whole point: a box left holding an example value must not out-rank the address, and a company relay
  // that happens to be called smtp.acme.com must keep working exactly as typed.
  const ignored = ['smtp.reply.example', 'smtp.relay.example', 'mail.example.com', 'smtp.test', 'smtp.yourdomain.com', 'smtp.changeme.net'];
  const kept = ['smtp.acme.com', 'smtp.zoho.com', 'smtp.gmail.com', 'mail.silverton-industries.co.in', 'localhost', '10.0.0.8'];
  for (const h of ignored) assert.ok(MAILER.isPlaceholderHost(h), h + ' is not a server');
  for (const h of kept) assert.ok(!MAILER.isPlaceholderHost(h), h + ' has to be taken at its word');
  const state = RUNTIME.resolveMailConfig({ smtp_user: 'payroll@gmail.com', smtp_password: 'x', smtp_host: 'smtp.reply.example', smtp_port: 587, smtp_secure: false, mail_enabled: true }, {});
  const plan = MAILER.resolveDriver(state);
  assert.equal(plan.driver, 'gmail', 'the address decides, so Gmail is dialed Gmail\u2019s way');
  assert.deepEqual(plan.server, { host: 'smtp.gmail.com', port: 465, secure: true }, 'and the port typed with the fake host goes with it');
  assert.equal(plan.ignoredHost, 'smtp.reply.example');
  assert.match(plan.note, /names no server/);
  assert.match(plan.note, /Clear that box in Settings/);
  const relay = MAILER.resolveDriver(RUNTIME.resolveMailConfig({ smtp_user: 'payroll@gmail.com', smtp_password: 'x', smtp_host: 'smtp.acme.com', smtp_port: 2525, smtp_secure: false }, {}));
  assert.deepEqual(relay.server, { host: 'smtp.acme.com', port: 2525, secure: false }, 'a real relay wins, placeholder or not in nobody\u2019s business');
  assert.ok(!relay.ignoredHost, 'a real host is not ignored, so there is nothing to report');
});

t('an app password of the wrong shape is counted, not read', async () => {
  const { appPasswordShapeHint } = await import('../src/lib/mailer/providers.js');
  // The real case from this round: a Google app password pasted with one group lost — 14 characters, not 16.
  assert.equal(MAILER.resolveDriver({ EMAIL_USER: 'kjhgfdsa1014@gmail.com', EMAIL_PASS: 'yhnvojirypukfc' }).passwordLength, 14);
  assert.match(appPasswordShapeHint('Google', 14), /16 characters, four groups of four/);
  assert.equal(appPasswordShapeHint('Google', 16), null, 'the right shape is not commented on');
  assert.equal(appPasswordShapeHint(null, 14), null, 'and a provider that takes any password gets no lecture');
  const never = JSON.stringify(MAILER.resolveDriver({ EMAIL_USER: 'a@gmail.com', EMAIL_PASS: 'yhnvojirypukfc' }));
  assert.ok(!never.includes('yhnvojirypukfc'), 'the plan never carries the password out of the process');
  const aliases = MAILER.resolveDriver({ EMAIL_USER: 'a@outlook.com', EMAIL_PASS: 'pw' });
  assert.deepEqual(aliases.server, { host: 'smtp.office365.com', port: 587, secure: false }, 'EMAIL_USER / EMAIL_PASS are read like any other name');
});
t('the invitation link is copy-pasteable, and one letter is built in one place', () => {
  const mail = MAILER.inviteMail({ name: 'Aarav Mehta', link: 'http://10.0.0.5:5173/set-password?token=abc123', minutes: 10, inviter: 'Nita Shah' });
  assert.match(mail.text, /\nhttp:\/\/10\.0\.0\.5:5173\/set-password\?token=abc123\n/, 'the bare URL is on its own line in the plain-text part');
  assert.match(mail.text, /Copy that address into your browser/);
  assert.match(mail.text, /Nita Shah/, 'it names who sent it');
  assert.match(mail.text, /10 minutes/, 'and how long the link lives');
  assert.match(mail.html, /word-break:break-all/, 'the HTML copy does not break the token across lines');
  assert.match(mail.subject, /choose a password/i);
  // The API request and the worker retry must not send two different letters.
  const svc = readFileSync(new URL('../src/services/user.service.js', import.meta.url), 'utf8');
  const job = readFileSync(new URL('../src/worker/jobs/email.job.js', import.meta.url), 'utf8');
  assert.ok(/inviteMail\(/.test(svc) && /inviteMail\(/.test(job), 'both call inviteMail()');
  assert.ok(!/An account has been created for you on \{\{company\}\}/.test(svc + job), 'no hand-copied copy left behind');
});
t('an invitation cannot be built before its own expiry is computed', () => {
  // The bug this locks out: `ttlMinutes: minutes` read from a `const minutes` declared lines later, which threw
  // a ReferenceError on every invite — and looked exactly like a broken mail server.
  const src = readFileSync(new URL('../src/services/user.service.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function createInvite'), src.indexOf('/** The wording lives in'));
  assert.ok(body.indexOf('const minutes =') > -1 && body.indexOf('const minutes =') < body.indexOf('ttlMinutes: minutes'),
    'minutes must be computed before the invitation row is written');
  assert.ok(body.indexOf('const link =') < body.indexOf('return {'), 'and the link must exist before the answer is built');
});
t('the seeder can leave the demo without a single pay run', () => {
  const src = readFileSync(new URL('../db/seed/seed.js', import.meta.url), 'utf8');
  assert.match(src, /has\('--no-payruns'\)/, '--no-payruns is a name a person would guess');
  assert.match(src, /SKIP_PAYRUNS = has\('--skip-payroll'\) \|\| has\('--no-payruns'\)/, 'and it means the same as the old flag');
  assert.match(src, /if \(SKIP_PAYRUNS\)[\s\S]{0,200}else await seedPayroll/, 'payroll is skipped, not half-run');
  // The number the seeder actually computes, read from the module rather than from its text.
  assert.ok(SEED.HEADCOUNT >= 100 && SEED.HEADCOUNT <= 200,
    `the default company is ${SEED.HEADCOUNT} people; the ask was 100-200`);
  assert.equal(SEED.EMPLOYEES.length, SEED.HEADCOUNT, 'the rows match the headcount, not a hand-picked list');
  const data = readFileSync(new URL('../db/seed/data.js', import.meta.url), 'utf8');
  assert.match(data, /SEED_EMPLOYEES \|\| 160/, 'it is a knob, defaulted inside the asked range');
});

t('a failed mail setup is told apart from a blocked port, in the provider\u2019s own words', async () => {
  const { refusalHint } = await import('../src/services/mail.service.js');
  // This is the exact sentence Gmail sent when this round was written: 465 with implicit TLS connected, then
  // refused a login password. It must land on the App Password advice, not on the firewall advice.
  const gmail = refusalHint('Invalid login: 535-5.7.8 Username and Password not accepted. For more information,');
  assert.match(gmail, /App Password/i, 'a refused Google login is a password problem');
  assert.match(gmail, /network/, 'and it has to say the network is not at fault');
  const blocked = refusalHint('connect ETIMEDOUT 142.251.183.109:465');
  assert.match(blocked, /smtp\.gmail\.com:465/, 'an unanswered port names what was dialed');
  assert.match(blocked, /firewall/i, 'and calls it a firewall, not a password');
  const other = refusalHint('550 5.7.1 Relaying denied for this sender');
  assert.match(other, /server\u2019s own/, 'anything else is quoted, not reinterpreted');
});

t('nothing leaves the machine unless both boxes are filled', () => {
  for (const cfg of [{}, { EMAIL_NAME: 'payroll@gmail.com' }, { EMAIL_PASSWORD: 'x' }]) {
    const plan = MAILER.resolveDriver(cfg);
    assert.equal(plan.driver, 'preview', 'no login or no password means preview: ' + JSON.stringify(cfg));
    assert.match(plan.note, /address and its password are the only two things needed/);
  }
});

t('createInvite imports what it calls before it calls it', () => {
  // A dynamic import inside the function is a function-local binding, so its line number is part of correctness.
  const src = readFileSync(new URL('../src/services/user.service.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function createInvite'), src.indexOf('if (!sendEmail)'));
  assert.ok(body.length > 200, 'and the function is there to read at all');
  // The specifier is matched with a character class around one letter on purpose: scripts/check-api-imports.js
  // reads every file in this folder for imports, and a plain string naming ../services/mail.service.js here
  // would be reported as a broken import path in a test that only quotes it.
  const IMPORT = /await import\((['"])\.\/mail\.[s]ervice\.js\1\)/;
  assert.ok(IMPORT.test(body), 'the local import is still at the top of createInvite');
  assert.ok(body.search(IMPORT) < body.search(/await inviteTtlMinutes\(\)/),
    'mail.service is imported before inviteTtlMinutes() runs — the other order threw ReferenceError on every invite');
  assert.ok(!/const \{[^}]*inviteTtlMinutes[^}]*\} = await import[^;]*;\s*const \{[^}]*mailStatus/.test(body),
    'the import is not repeated lower down, which would shadow it');
  // (no dynamic import of the service here: this suite stays free of Redis and BullMQ, and the order is what
  // broke in the first place \u2014 evaluating the module would not see it.)
});

t('the preview .eml is a real message with a copyable link in its text part', async () => {
  // On a box with no SMTP login this file is the delivery, so the URL has to be readable without a browser:
  // multipart/alternative, text part first, and the raw link on a line of its own inside that text part.
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'pp-eml-'));
  try {
    const mailer = await MAILER.createMailer({ mail: { driver: 'preview', from: 'payroll@oxp.com' } });
    const { inviteMail } = await import('../src/lib/mailer/template.js');
    const body = inviteMail({ name: 'Aarav', link: 'http://localhost:5173/set-password?token=AbCd_123', minutes: 10, inviter: 'Anita', company: 'OXP' });
    const out = await mailer.send({ to: 'a@b.co', ...body, previewDir: dir });
    const raw = await readFile(out.file, 'utf8');
    assert.match(raw, /^Content-Type: multipart\/alternative; boundary="[^"]+"/m, 'declares the alternative parts');
    assert.ok(raw.indexOf('Content-Type: text/plain') < raw.indexOf('Content-Type: text/html'), 'text part comes first');
    const textPart = raw.slice(raw.indexOf('text/plain'), raw.indexOf('Content-Type: text/html'));
    assert.ok(textPart.includes('http://localhost:5173/set-password?token=AbCd_123'), 'the link is inside the text part, not only in an href');
    assert.ok(/(?:\r?\n)http:\/\/localhost:5173\/set-password\?token=AbCd_123(?:\r?\n)/.test(textPart), 'on a line of its own, so a double-click selects it whole');
    assert.match(raw, /^--\S+\r\nContent-Type: text\/plain/m, 'a boundary line opens the first part');
    assert.match(raw.trimEnd(), /--$/, 'and the message ends with the closing boundary');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await Promise.all(pending);
console.log(`\n${fails.length ? `FAILED ${fails.length}/${passed + fails.length}` : `all ${passed} unit tests passed`}`);
if (fails.length) { for (const [n, e] of fails) console.log(`\n--- ${n}\n${e.stack}`); process.exit(1); }
