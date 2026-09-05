/**
 * Demo data for PeoplePay360. Everything here is *shape*, not money: payslip numbers are produced by the
 * payroll engine when the seeder drives the real services (see seed.js), so a rule change is immediately
 * visible in the seeded company.
 *
 * Every date is counted back from **today**, on purpose. An earlier version wrote "2026-04" into the file, and a
 * month later the demo company was a museum: the last payrun was four months old, this month had no attendance,
 * and creating a run for the current period found nobody who was on the payroll for it — which reads to a person
 * looking at the screen as "the payrun is broken". Nothing here may go stale that way again.
 */
export const TODAY = new Date().toISOString().slice(0, 10);

/** `2026-09-06` → months, oldest first, including the current one. Used by attendance, runs and leave. */
export function monthKeysBack(count, { includeCurrent = true } = {}) {
  const out = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return includeCurrent ? out : out.slice(0, -1);
}
/** ISO date `n` days from `from` (string or Date), in UTC so a timezone cannot move a person's joining date. */
export function shiftDays(from, n) {
  const d = new Date(`${String(from).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Same, in months — a birthday or a joining date does not drift by a day at the end of February. */
export function shiftMonths(from, n) {
  const base = new Date(`${String(from).slice(0, 10)}T00:00:00Z`);
  const day = base.getUTCDate();
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + n, 1));
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}
/** The first and last day of the financial year `from` falls in, given a start month (April = 4 here). */
export function fiscalYear(from, startMonth = 4) {
  const y = +String(from).slice(0, 4);
  const m = +String(from).slice(5, 7);
  const first = m >= startMonth ? y : y - 1;
  return { from: `${first}-${String(startMonth).padStart(2, '0')}-01`, to: shiftDays(`${first + 1}-${String(startMonth).padStart(2, '0')}-01`, -1),
           label: `FY ${String(first).slice(2)}-${String(first + 1).slice(2)}` };
}

export const COMPANY = {
  company_name: 'OXP Pvt Ltd', legal_name: 'OXP Private Limited',
  address: 'Unit 402, Tower 1, Pragya I, GIFT City', city: 'Gandhinagar', state: 'Gujarat', postal_code: '382310',
  country: 'India', timezone: 'Asia/Kolkata', currency: 'INR', currency_symbol: '₹',
  fiscal_year_start_month: 4, payroll_day_basis: 'ACTUAL_WORKING_DAYS', default_hours_per_day: 8,
  overtime_multiplier: 2, overtime_round_to: 0.25, overtime_min_hours: 0.5,
  round_net_to_rupee: false, sandwich_rule: false,
  pf_enabled: true, pf_employee_pct: 12, pf_employer_pct: 12, pf_wage_ceiling: 15000,
  esi_enabled: true, esi_employee_pct: 0.75, esi_employer_pct: 3.25, esi_wage_limit: 21000,
  pt_enabled: true, pt_monthly: 200, pt_annual_cap: 2500, pt_charge_slice: 'HALF_SECOND', pt_state: 'Gujarat',
  advance_percentage: 50, allow_negative_net: false,
  payslip_footer: 'System generated payslip by PeoplePay360. This payslip does not require a signature.',
  mail_from: 'OXP Payroll <payroll@oxp.com>', mail_daily_limit: 200, document_retention_years: 8,
};

export const DEPARTMENTS = [
  { name: 'Engineering', code: 'ENG' },
  { name: 'People Operations', code: 'HR' },
  { name: 'Payroll & Finance', code: 'FIN' },
  { name: 'Sales', code: 'SLS' },
  { name: 'Customer Support', code: 'SUP' },
];

const weekdays = (start, end, brk) => [1, 2, 3, 4, 5].map((day) => ({ day, start, end, break: brk }));
export const SCHEDULES = [
  { name: 'OXP Standard — Mon to Fri', type: 'FIXED', timezone: 'Asia/Kolkata',
    description: 'Default five-day week: 09:30–18:30 with a 60 minute break (40 h).',
    days: [...weekdays('09:30', '18:30', 60), { day: 6, rest: true }, { day: 7, rest: true }] },
  { name: 'Support Rotation — Mon to Sat', type: 'SHIFT', timezone: 'Asia/Kolkata',
    description: 'Support desk keeps Saturdays short: 7.5 h Mon–Fri, 4 h Sat, Sunday off.',
    days: [...[1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:30', break: 60 })),
           { day: 6, start: '10:00', end: '14:00', break: 0 }, { day: 7, rest: true }] },
  { name: 'Interns — 6 h day', type: 'PART_TIME', timezone: 'Asia/Kolkata',
    description: 'Six hours, no break, Monday to Friday.',
    days: [...[1, 2, 3, 4, 5].map((day) => ({ day, start: '10:00', end: '16:00', break: 0 })), { day: 6, rest: true }, { day: 7, rest: true }] },
];

/** 2025-26 and 2026-27 (the seeded payroll window). Diwali/Navratri shift each year, so these are fixed. */
export const HOLIDAYS = [
  { day: '2025-08-15', name: 'Independence Day', type: 'PUBLIC' },
  { day: '2025-10-02', name: 'Gandhi Jayanti', type: 'PUBLIC' },
  { day: '2025-10-20', name: 'Diwali', type: 'PUBLIC' },
  { day: '2025-12-25', name: 'Christmas Day', type: 'PUBLIC' },
  { day: '2026-01-01', name: 'New Year', type: 'COMPANY' },
  { day: '2026-01-26', name: 'Republic Day', type: 'PUBLIC' },
  { day: '2026-03-04', name: 'Holi', type: 'PUBLIC' },
  { day: '2026-03-26', name: 'Day after Holi — Ugly Day', type: 'COMPANY' },
  { day: '2026-05-01', name: 'Gujarat Day', type: 'PUBLIC' },
  { day: '2026-08-15', name: 'Independence Day', type: 'PUBLIC' },
  { day: '2026-11-08', name: 'Diwali', type: 'PUBLIC' },
  { day: '2026-12-25', name: 'Christmas Day', type: 'PUBLIC' },
];
export const HOLIDAY_TEMPLATES = [
  { name: 'Republic Day', month: 1, day: 26, type: 'PUBLIC' },
  { name: 'Independence Day', month: 8, day: 15, type: 'PUBLIC' },
  { name: 'Gandhi Jayanti', month: 10, day: 2, type: 'PUBLIC' },
  { name: 'Gujarat Day', month: 5, day: 1, type: 'PUBLIC' },
  { name: 'Christmas Day', month: 12, day: 25, type: 'PUBLIC' },
];

/** The rule set behind the validated fixture: ₹85,000 wage → ₹63,350 gross → ₹61,350 net for a full month. */
const standardRules = (over = {}) => ([
  { code: 'BASIC', name: 'Basic Salary', category: 'BASIC', line_kind: 'EARNING', sequence: 1,
    computation_type: 'PERCENTAGE', percentage: 40, base_code: 'CONTRACT_WAGE', pro_rata: true, is_taxable: true },
  { code: 'HRA', name: 'House Rent Allowance', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 2,
    computation_type: 'PERCENTAGE', percentage: 50, base_code: 'BASIC', pro_rata: true, is_taxable: true },
  { code: 'MEDA', name: 'Medical Allowance', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 3,
    computation_type: 'FIXED', amount: 1250, pro_rata: true, is_taxable: true },
  { code: 'CONV', name: 'Conveyance Allowance', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 4,
    computation_type: 'FIXED', amount: 1600, pro_rata: true, is_taxable: false },
  { code: 'PERB', name: 'Performance Bonus', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 5,
    computation_type: 'PERCENTAGE', percentage: 10, base_code: 'CONTRACT_WAGE', pro_rata: false, evaluation_period: 'MONTH_ONCE', is_taxable: true },
  // MONTH_ONCE, not FISCAL_YEAR: LTA is a monthly quantum, and a half-month run must pay it once for the
  // month — an FISCAL_YEAR marker without an annual_cap would happily charge ₹1,000 in each half.
  { code: 'LTA', name: 'Leave Travel Allowance', category: 'REIMBURSEMENT', line_kind: 'EARNING', sequence: 6,
    computation_type: 'FIXED', amount: 1000, pro_rata: false, evaluation_period: 'MONTH_ONCE', appears_on_payslip: false, is_taxable: false, ...over.lta },
  { code: 'OT', name: 'Overtime', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 7,
    computation_type: 'FORMULA', statutory: true, pro_rata: false, condition_expr: 'overtime_hours > 0' },
  { code: 'GROSS', name: 'Gross Earnings', category: 'GROSS', line_kind: 'REPORT', sequence: 100,
    computation_type: 'FIXED', amount: 0, is_report_only: true, appears_in_report: false },
  { code: 'PF', name: 'Provident Fund (Employee)', category: 'DEDUCTION', line_kind: 'DEDUCTION', sequence: 110,
    computation_type: 'PERCENTAGE', percentage: 12, base_code: 'CONTRACT_WAGE', statutory: true, pro_rata: true, is_taxable: false },
  { code: 'LOP', name: 'Loss of Pay', category: 'DEDUCTION', line_kind: 'DEDUCTION', sequence: 115,
    computation_type: 'FIXED', amount: 0, statutory: true, pro_rata: false, is_taxable: false },
  { code: 'PT', name: 'Professional Tax', category: 'DEDUCTION', line_kind: 'DEDUCTION', sequence: 120,
    computation_type: 'FIXED', amount: 200, statutory: true, pro_rata: false, is_taxable: false },
  { code: 'PF_EMPLOYER', name: 'Provident Fund (Employer)', category: 'DEDUCTION', line_kind: 'REPORT', sequence: 130,
    computation_type: 'PERCENTAGE', percentage: 12, base_code: 'CONTRACT_WAGE', statutory: true, pro_rata: true,
    appears_on_payslip: false, is_taxable: false },
  { code: 'NET', name: 'Net Pay', category: 'NET', line_kind: 'REPORT', sequence: 200,
    computation_type: 'FIXED', amount: 0, is_report_only: true, appears_in_report: false },
]);
export const STRUCTURES = [
  { name: 'OXP Standard Salaried', code: 'STD', description: 'Monthly salaried staff: 40% basic, HRA at 50% of basic, PF/PT statutory deductions.',
    rules: standardRules() },
  { name: 'OXP Sales + Incentive', code: 'SLS', description: 'Same base as standard, plus a formula-driven incentive capped per month.',
    rules: [...standardRules({ lta: { amount: 1500 } }),
      { code: 'INCENT', name: 'Sales Incentive', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 8,
        computation_type: 'FORMULA', formula: "min(round(inputs['target'] * inputs['attainment'] * 0.06, 2), 40000)", pro_rata: false,
        condition_expr: "inputs['attainment'] > 0", is_taxable: true,
        notes: 'target × attainment × 6%, capped at ₹40,000 — reads the payslip inputs, so HR can change it per month' }],
    inputs: { target: 250000, attainment: 0.9 } },
  { name: 'Intern & Contract Stipend', code: 'INT', description: 'Flat stipend, no PF, ESI only (wage sits under the limit).',
    rules: [
      { code: 'STIP', name: 'Stipend', category: 'BASIC', line_kind: 'EARNING', sequence: 1,
        computation_type: 'PERCENTAGE', percentage: 100, base_code: 'CONTRACT_WAGE', pro_rata: true, is_taxable: true },
      { code: 'OT', name: 'Overtime', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 7,
        computation_type: 'FORMULA', statutory: true, pro_rata: false, condition_expr: 'overtime_hours > 0' },
      { code: 'GROSS', name: 'Gross Earnings', category: 'GROSS', line_kind: 'REPORT', sequence: 100,
        computation_type: 'FIXED', amount: 0, is_report_only: true },
      { code: 'LOP', name: 'Loss of Pay', category: 'DEDUCTION', line_kind: 'DEDUCTION', sequence: 115,
        computation_type: 'FIXED', amount: 0, statutory: true, pro_rata: false },
      { code: 'ESI', name: 'ESI (Employee)', category: 'DEDUCTION', line_kind: 'DEDUCTION', sequence: 120,
        computation_type: 'PERCENTAGE', percentage: 0.75, base_code: 'CONTRACT_WAGE', statutory: true, pro_rata: false },
      { code: 'ESI_EMPLOYER', name: 'ESI (Employer)', category: 'DEDUCTION', line_kind: 'REPORT', sequence: 125,
        computation_type: 'PERCENTAGE', percentage: 3.25, base_code: 'CONTRACT_WAGE', statutory: true, pro_rata: false,
        appears_on_payslip: false, notes: 'Employer share — reported as cost, never deducted from net pay.' },
      { code: 'NET', name: 'Net Pay', category: 'NET', line_kind: 'REPORT', sequence: 200,
        computation_type: 'FIXED', amount: 0, is_report_only: true },
    ] },
];

export const PT_SLABS = [
  { state: 'Gujarat', wage_from: 0, wage_to: 50000, monthly_amount: 150 },
  { state: 'Gujarat', wage_from: 50000, wage_to: null, monthly_amount: 200 },
  { state: 'Maharashtra', wage_from: 0, wage_to: 7500, monthly_amount: 0 },
  { state: 'Maharashtra', wage_from: 7500, wage_to: null, monthly_amount: 200 },
];

export const USERS = [
  // One role per login, one login per role: the specification's five roles, five staff accounts, nothing
  // extra to sign in as. Rahul Verma (the old sixth row) was a second ADMIN whose only job was to
  // demonstrate that an admin cannot edit a peer admin — that rule is still enforced by the API, it just
  // no longer needs a spare account sitting in every demo list.
  { key: 'admin', name: 'Anita Rao', work_email: 'admin@oxp.com', role: 'ADMIN', roles: ['ADMIN'] },
  { key: 'hr', name: 'Kunal Shah', work_email: 'hr@oxp.com', role: 'HR_MANAGER', roles: ['HR_MANAGER'] },
  { key: 'hr_user', name: 'Sneha Kulkarni', work_email: 'hr2@oxp.com', role: 'HR_PAYROLL_USER', roles: ['HR_PAYROLL_USER'] },
  // "payroll" owns a run end to end (compute → validate → release) and nothing else, which is the point of
  // the split: the person who can pay people is not the person who can hire them.
  { key: 'payroll', name: 'Meera Iyer', work_email: 'payroll@oxp.com', role: 'HR_PAYROLL_MANAGER', roles: ['HR_PAYROLL_MANAGER'] },
  // (An EMPLOYEE login is not listed here on purpose: every seeded person in EMPLOYEES gets their own
  // account when the employees are created, so aarav.mehta@oxp.com exists without being declared twice.)
];

/**
 * `structure` is a code from STRUCTURES, `schedule` an index into SCHEDULES.
 * Wages are the monthly contract wage (the base every percentage rule reads).
 */
const HAND_WRITTEN = [
  { key: 'aarav', name: 'Aarav Mehta', email: 'aarav.mehta@oxp.com', dept: 'Engineering', position: 'Senior Backend Engineer', type: 'FULL_TIME', wage: 85000, joining: '2023-06-12', schedule: 0, structure: 'STD', city: 'Ahmedabad', gender: 'Male', manager: null },
  { key: 'diya', name: 'Diya Patel', email: 'diya.patel@oxp.com', dept: 'Engineering', position: 'Frontend Engineer', type: 'FULL_TIME', wage: 62000, joining: '2024-02-04', schedule: 0, structure: 'STD', city: 'Ahmedabad', gender: 'Female', manager: 'aarav' },
  { key: 'rohan', name: 'Rohan Desai', email: 'rohan.desai@oxp.com', dept: 'People Operations', position: 'HR Executive', type: 'FULL_TIME', wage: 48000, joining: '2024-08-19', schedule: 0, structure: 'STD', city: 'Gandhinagar', gender: 'Male', manager: null },
  { key: 'fatima', name: 'Fatima Sheikh', email: 'fatima.sheikh@oxp.com', dept: 'Payroll & Finance', position: 'Payroll Officer', type: 'FULL_TIME', wage: 56000, joining: '2023-11-06', schedule: 0, structure: 'STD', city: 'Ahmedabad', gender: 'Female', manager: null },
  { key: 'vikram', name: 'Vikram Singh', email: 'vikram.singh@oxp.com', dept: 'Payroll & Finance', position: 'Finance Analyst', type: 'FULL_TIME', wage: 44000, joining: '2025-01-13', schedule: 0, structure: 'STD', city: 'Ahmedabad', gender: 'Male', manager: 'fatima' },
  { key: 'neha', name: 'Neha Gupta', email: 'neha.gupta@oxp.com', dept: 'Sales', position: 'Account Manager', type: 'FULL_TIME', wage: 52000, joining: '2024-05-20', schedule: 0, structure: 'SLS', city: 'Surat', gender: 'Female', manager: null, inputs: { target: 300000, attainment: 1.15 } },
  { key: 'arjun', name: 'Arjun Nair', email: 'arjun.nair@oxp.com', dept: 'Sales', position: 'Sales Executive', type: 'FULL_TIME', wage: 34000, joining: '2025-07-01', schedule: 0, structure: 'SLS', city: 'Kochi', gender: 'Male', manager: 'neha', inputs: { target: 200000, attainment: 0.72 } },
  { key: 'sana', name: 'Sana Qureshi', email: 'sana.qureshi@oxp.com', dept: 'Customer Support', position: 'Support Lead', type: 'FULL_TIME', wage: 41000, joining: '2024-03-11', schedule: 1, structure: 'STD', city: 'Ahmedabad', gender: 'Female', manager: null },
  { key: 'tarun', name: 'Tarun Bhatt', email: 'tarun.bhatt@oxp.com', dept: 'Customer Support', position: 'Support Engineer', type: 'FULL_TIME', wage: 26000, joining: '2025-03-03', schedule: 1, structure: 'STD', city: 'Rajkot', gender: 'Male', manager: 'sana' },
  { key: 'priya', name: 'Priya Menon', email: 'priya.menon@oxp.com', dept: 'Engineering', position: 'QA Engineer (Contract)', type: 'CONTRACT', wage: 38000, joining: '2026-02-02', exit: '2026-07-15', schedule: 0, structure: 'STD', city: 'Bengaluru', gender: 'Female', manager: 'aarav' },
  { key: 'aditya', name: 'Aditya Joshi', email: 'aditya.joshi@oxp.com', dept: 'Engineering', position: 'Backend Intern', type: 'INTERN', wage: 18000, joining: '2026-06-16', schedule: 2, structure: 'INT', city: 'Pune', gender: 'Male', manager: 'aarav' },
  { key: 'isha', name: 'Isha Reddy', email: 'isha.reddy@oxp.com', dept: 'People Operations', position: 'Talent Acquisition Intern', type: 'INTERN', wage: 16000, joining: '2026-04-20', schedule: 2, structure: 'INT', city: 'Hyderabad', gender: 'Female', manager: 'rohan' },
  { key: 'kabir', name: 'Kabir Kulkarni', email: 'kabir.kulkarni@oxp.com', dept: 'Customer Support', position: 'Support Engineer (Part time)', type: 'PART_TIME', wage: 21000, joining: '2025-09-15', schedule: 1, structure: 'INT', city: 'Nashik', gender: 'Male', manager: 'sana' },
];

export const LEAVE_TYPES = [
  { name: 'Casual Leave', code: 'CL', category: 'CASUAL', unit: 'DAYS', requires_allocation: true, max_days_per_year: 12, approval_route: 'MANAGER',
    is_unpaid: false, payslip_code: 'CL', carry_forward: false, sandwich_rule: false, min_notice_days: 0, display_color: 'Blue',
    work_entry_type: 'Leave Work Entry', description: 'Short-notice personal leave. 12 days a year, does not carry forward.' },
  { name: 'Privilege Leave', code: 'PL', category: 'PRIVILEGED', unit: 'DAYS', requires_allocation: true, max_days_per_year: 15, approval_route: 'HR',
    is_unpaid: false, payslip_code: 'PL', carry_forward: true, sandwich_rule: false, min_notice_days: 3, display_color: 'Green',
    work_entry_type: 'Leave Work Entry', description: 'Planned time off. 15 days a year, up to 5 carry forward.' },
  { name: 'Sick Leave', code: 'SL', category: 'SICK', unit: 'DAYS', requires_allocation: true, max_days_per_year: 7, approval_route: 'MANAGER',
    is_unpaid: false, payslip_code: 'SL', carry_forward: false, sandwich_rule: true, min_notice_days: 0, display_color: 'Orange',
    work_entry_type: 'Leave Work Entry', description: 'Paid sick leave; the sandwich rule applies (weekends in between count).' },
  { name: 'Half Day', code: 'HD', category: 'OTHER', unit: 'HOURS', requires_allocation: false, max_days_per_year: null, approval_route: 'MANAGER',
    is_unpaid: false, payslip_code: 'HD', carry_forward: false, sandwich_rule: false, min_notice_days: 0, display_color: 'Purple',
    work_entry_type: 'Leave Work Entry', description: 'Four paid hours, morning or afternoon.' },
  { name: 'Leave Without Pay', code: 'LWP', category: 'UNPAID', unit: 'DAYS', requires_allocation: false, max_days_per_year: null, approval_route: 'PAYROLL_OFFICER',
    is_unpaid: true, payslip_code: 'LOP', carry_forward: false, sandwich_rule: true, min_notice_days: 0, display_color: 'Red',
    work_entry_type: 'Loss of Pay Work Entry', description: 'Unpaid — hits the payslip as Loss of Pay at the configured day divisor.' },
  { name: 'Compensatory Off', code: 'COMP_OFF', category: 'COMPENSATORY', unit: 'DAYS', requires_allocation: false, max_days_per_year: 6, approval_route: 'MANAGER',
    is_unpaid: false, payslip_code: 'COMP_OFF', carry_forward: false, sandwich_rule: false, min_notice_days: 0, display_color: 'Teal',
    work_entry_type: 'Leave Work Entry', description: 'Granted for weekend working; expires with the quarter.' },
  { name: 'Maternity Leave', code: 'MAT', category: 'MATERNITY', unit: 'DAYS', requires_allocation: false, max_days_per_year: 182, approval_route: 'HR',
    is_unpaid: false, payslip_code: 'MAT', carry_forward: false, sandwich_rule: false, min_notice_days: 0, display_color: 'Pink',
    work_entry_type: 'Paid Work Entry', description: '26 weeks, paid, no balance needed.' },
];

/** `2026-09-06` → `2026-09`. Kept here so the data module stays importable without the rest of the app. */
export const monthOf = (iso) => String(iso).slice(0, 7);
/** The last day of the month a `YYYY-MM-01` falls in, as an ISO date. */
export function monthEndOf(iso) {
  const y = +String(iso).slice(0, 4), m = +String(iso).slice(5, 7);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export const rng = (seed = 7) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/**
 * ── The rest of the company ────────────────────────────────────────────────────────────────────────────────
 *
 * A payroll screen with thirteen people in it cannot show a payroll: the payrun wizard says "4 assigned" on one
 * structure, the attendance register is two screens long, and an approval queue has four rows in it. So the demo
 * company is grown to `HEADCOUNT` (160 unless `SEED_EMPLOYEES` says otherwise, capped at 400 so a laptop seed
 * stays a minute, not an hour), and every generated attribute is one a real record could carry:
 *
 *   · a date of birth that makes the person 22 to 58 today and never younger than 18 on their joining day;
 *   · a joining date that is never after the contract that starts with it, and for a few of them, this month —
 *     those correctly have no payrun last month and are pro-rated in this one;
 *   · a wage inside the band that matches the title, so the PF ceiling (₹15,000 of basic), the ESI limit
 *     (₹21,000 total) and the Gujarat/Maharashtra professional-tax slabs each bite where they should;
 *   · a PAN, IFSC, UAN, ESIC number, bank account, phone and pincode that pass the same shapes the employee form
 *     asks for (`PATTERNS` in frontend/src/components/crud/schemaForm.jsx) — a demo you cannot open in the edit
 *     dialog is worse than no demo;
 *   · a city inside the two states this company has PT slabs for, a bank from a short list of real ones, and a
 *     manager who is an *earlier* row, so the reporting lines cannot point at each other in a circle;
 *   · and for the few percent who left, an exit date, a contract that ends on it and an employee row that is
 *     TERMINATED — not an active employee with a past exit date, which is what this file used to produce.
 */
export const HEADCOUNT = Math.max(HAND_WRITTEN.length, Math.min(400, Number(process.env.SEED_EMPLOYEES || 160) || 160));

const MALE_NAMES = ['Aditya', 'Arjun', 'Aarav', 'Rohit', 'Kunal', 'Nikhil', 'Siddharth', 'Vivek', 'Manish', 'Gaurav',
                    'Harsh', 'Keyur', 'Jayesh', 'Rakesh', 'Suresh', 'Devang', 'Hiten', 'Paresh', 'Ankit', 'Meet',
                    'Rajeev', 'Sameer', 'Tushar', 'Utpal', 'Yogesh', 'Bhargav', 'Chirag', 'Dhruv', 'Falan', 'Girish'];
const FEMALE_NAMES = ['Priya', 'Diya', 'Neha', 'Sana', 'Isha', 'Kavya', 'Meera', 'Pooja', 'Riya', 'Sneha',
                      'Tanvi', 'Urmi', 'Vidhi', 'Ayesha', 'Bhavna', 'Chhaya', 'Disha', 'Esha', 'Farha', 'Gita',
                      'Heena', 'Ira', 'Jiya', 'Kiran', 'Lipi', 'Manvi', 'Nidhi', 'Oorja', 'Pallavi', 'Riddhi'];
const SURNAMES = ['Mehta', 'Patel', 'Shah', 'Desai', 'Bhatt', 'Trivedi', 'Joshi', 'Dave', 'Chauhan', 'Vyas',
                  'Pandya', 'Thakkar', 'Modi', 'Sonar', 'Iyer', 'Nair', 'Menon', 'Reddy', 'Kulkarni', 'Jadhav',
                  'Sharma', 'Verma', 'Mishra', 'Gupta', 'Singh', 'Kaur', 'Sheikh', 'Qureshi', 'Ansari', 'Das'];

/** Only the two states `PT_SLABS` covers, so nobody is generated into a professional tax the app cannot work out. */
const SITES = [
  { city: 'Ahmedabad', state: 'Gujarat', pin: '3800' }, { city: 'Gandhinagar', state: 'Gujarat', pin: '3820' },
  { city: 'Surat', state: 'Gujarat', pin: '3950' }, { city: 'Vadodara', state: 'Gujarat', pin: '3900' },
  { city: 'Rajkot', state: 'Gujarat', pin: '3600' }, { city: 'Bhavnagar', state: 'Gujarat', pin: '3640' },
  { city: 'Mumbai', state: 'Maharashtra', pin: '4000' }, { city: 'Pune', state: 'Maharashtra', pin: '4110' },
  { city: 'Nashik', state: 'Maharashtra', pin: '4220' }, { city: 'Nagpur', state: 'Maharashtra', pin: '4400' },
];
const BANKS = [['HDFC', 'HDFC Bank'], ['ICIC', 'ICICI Bank'], ['SBIN', 'State Bank of India'],
               ['AXIS', 'Axis Bank'], ['KKBK', 'Kotak Mahindra Bank'], ['PUNB', 'Punjab National Bank']];

/** title, what it pays, and which pay structure it sits on — the three things payroll actually cares about. */
const BANDS = [
  { title: 'Software Engineer', dept: 'Engineering', min: 52000, max: 82000, structure: 'STD', type: 'FULL_TIME', schedule: 0 },
  { title: 'Senior Software Engineer', dept: 'Engineering', min: 84000, max: 128000, structure: 'STD', type: 'FULL_TIME', schedule: 0 },
  { title: 'Engineering Team Lead', dept: 'Engineering', min: 132000, max: 196000, structure: 'STD', type: 'FULL_TIME', schedule: 0 },
  { title: 'QA Engineer', dept: 'Engineering', min: 34000, max: 56000, structure: 'STD', type: 'FULL_TIME', schedule: 0 },
  { title: 'DevOps Engineer', dept: 'Engineering', min: 78000, max: 126000, structure: 'STD', type: 'FULL_TIME', schedule: 0 },
  { title: 'Sales Executive', dept: 'Sales', min: 28000, max: 44000, structure: 'SLS', type: 'FULL_TIME', schedule: 0, incentive: true },
  { title: 'Account Manager', dept: 'Sales', min: 46000, max: 74000, structure: 'SLS', type: 'FULL_TIME', schedule: 0, incentive: true },
  { title: 'Inside Sales Representative', dept: 'Sales', min: 26000, max: 38000, structure: 'SLS', type: 'FULL_TIME', schedule: 0, incentive: true },
  { title: 'Support Engineer', dept: 'Customer Support', min: 24000, max: 40000, structure: 'STD', type: 'FULL_TIME', schedule: 1 },
  { title: 'Support Team Lead', dept: 'Customer Support', min: 46000, max: 66000, structure: 'STD', type: 'FULL_TIME', schedule: 1 },
  { title: 'Night Shift Support Associate', dept: 'Customer Support', min: 21000, max: 30000, structure: 'STD', type: 'FULL_TIME', schedule: 1 },
  { title: 'HR Executive', dept: 'People Operations', min: 30000, max: 48000, structure: 'STD', type: 'FULL_TIME', schedule: 0 },
  { title: 'Talent Acquisition Partner', dept: 'People Operations', min: 38000, max: 58000, structure: 'STD', type: 'FULL_TIME', schedule: 0 },
  { title: 'People Operations Intern', dept: 'People Operations', min: 15000, max: 19000, structure: 'INT', type: 'INTERN', schedule: 2 },
  { title: 'Payroll Executive', dept: 'Payroll & Finance', min: 32000, max: 50000, structure: 'STD', type: 'FULL_TIME', schedule: 0 },
  { title: 'Financial Analyst', dept: 'Payroll & Finance', min: 52000, max: 88000, structure: 'STD', type: 'FULL_TIME', schedule: 0 },
  { title: 'Accounts Executive', dept: 'Payroll & Finance', min: 26000, max: 36000, structure: 'STD', type: 'FULL_TIME', schedule: 0 },
  { title: 'Backend Intern', dept: 'Engineering', min: 16000, max: 21000, structure: 'INT', type: 'INTERN', schedule: 2 },
  { title: 'Sales Trainee', dept: 'Sales', min: 18000, max: 22000, structure: 'INT', type: 'INTERN', schedule: 2, incentive: true },
];
const ROUND_SALARY = 500;
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A 10-character PAN in the shape the form accepts: five letters, four digits, one letter. */
function panFor(given, family, n) {
  const letters = (a, b) => String(a || 'X').charAt(0).toUpperCase() + String(b || 'Y').toUpperCase();
  const head = (given + family).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X');
  const digits = String(1000 + (n * 37) % 8999).padStart(4, '0');
  return `${head}${letters(family, given).slice(0, 2)}${digits}${ALPHA[(n * 7 + given.length) % 24]}`;
}
function digitsFrom(seed, length) {
  let out = '';
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; out += String((x >>> 16) % 10); }
  return out;
}

function generatedEmployees(count, offset) {
  const rand = rng(20260906 + offset);
  const used = new Set(HAND_WRITTEN.map((e) => String(e.email).toLowerCase()));
  const out = [];
  for (let i = 0; i < count; i++) {
    const n = offset + i;
    const band = BANDS[Math.floor(rand() * BANDS.length)];
    const gender = rand() < 0.5 ? 'Male' : 'Female';
    const given = (gender === 'Male' ? MALE_NAMES : FEMALE_NAMES)[Math.floor(rand() * 30)];
    const family = SURNAMES[Math.floor(rand() * SURNAMES.length)];
    let email = `${given}.${family}`.toLowerCase().replace(/[^a-z.]/g, '') + '@oxp.com';
    while (used.has(email)) email = `${given}.${family}${n}`.toLowerCase().replace(/[^a-z0-9.]/g, '') + '@oxp.com';
    used.add(email);

    // Tenure: most people have been here a while, a few joined last month, one in twenty starts this month.
    const monthsBack = rand() < 0.05 ? 0 : rand() < 0.12 ? 1 : 2 + Math.floor(rand() * 58);
    // The day is kept inside the month (February has no 30th), and nobody may have joined next week: today is
    // the ceiling, so the newest rows are "joined this month", not "joined in the future".
    const raw = shiftDays(shiftMonths(TODAY, -monthsBack), Math.floor(rand() * 27));
    const joining = raw > TODAY ? TODAY : raw;
    const seniorEnoughToLeave = monthsBack > 14 && rand() < 0.07;
    const exit = seniorEnoughToLeave ? shiftDays(shiftMonths(TODAY, -(1 + Math.floor(rand() * 5))), Math.floor(rand() * 20) + 1) : null;
    const age = 22 + Math.floor(rand() * 24);
    const site = SITES[Math.floor(rand() * SITES.length)];
    const bank = BANKS[Math.floor(rand() * BANKS.length)];
    const wage = Math.round((band.min + rand() * (band.max - band.min)) / ROUND_SALARY) * ROUND_SALARY;

    out.push({
      key: `oxp${n}`, name: `${given} ${family}`, email, given, family, gender,
      dept: band.dept, position: band.title, type: band.type, wage,
      // A leaver's contract ends on the exit date below.
      joining, exit,
      dob: shiftDays(shiftMonths(joining, -age * 12), -(1 + Math.floor(rand() * 300))),
      schedule: band.schedule, structure: band.structure, city: site.city, state: site.state,
      pin: site.pin + String(15 + (n * 3) % 60).padStart(2, '0'),
      bank_name: bank[1], bank_account: `501${digitsFrom(n * 7919, 11)}`, ifsc: `${bank[0]}0${digitsFrom(n * 104729, 6)}`,
      pan: panFor(given, family, n), uan: `100${digitsFrom(n * 2246827, 9)}`,
      // ESIC only exists below the insurance ceiling, and it is 17 digits.
      esic: wage <= 21000 ? `99${digitsFrom(n * 3571, 15)}` : null,
      phone: `${6 + (n % 4)}${digitsFrom(n * 65537, 9)}`,
      ...(band.incentive ? { inputs: { target: 120000 + Math.floor(rand() * 30) * 10000, attainment: +(0.55 + rand() * 0.75).toFixed(2) } } : {}),
    });
  }
  // One reporting line per department, aimed at someone earlier in the list so it cannot cycle.
  const heads = {};
  for (const hand of HAND_WRITTEN) if (!hand.manager && !heads[hand.dept]) heads[hand.dept] = hand.key;
  for (const e of out) {
    const head = heads[e.dept];
    e.manager = head && head !== e.key ? head : null;
  }
  return out;
}

/** The hand-written people get the same identity fields, so one code path writes every row. */
function withIdentity(e, i) {
  const site = SITES.find((s) => s.city === e.city) || SITES[0];
  const given = String(e.name).split(' ')[0] || 'OXP';
  const family = String(e.name).split(' ').slice(1).join('') || 'User';
  const digits = (len) => digitsFrom((i + 7) * 7919, len);
  const pan = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(e.pan_number || '')) ? e.pan_number : panFor(given, family, i + 1);
  return {
    ...e, given, family,
    gender: e.gender || (i % 2 ? 'Female' : 'Male'),
    // A generated row already carries these; this function only fills what a hand-written row left out.
    dob: e.dob || shiftDays(shiftMonths(e.joining, -(24 * 12 + (i % 9) * 12)), -40),
    state: e.state || site.state,
    pin: e.pin || e.pincode || site.pin + String(15 + (i * 3) % 60).padStart(2, '0'),
    phone: e.phone || `9${digits(9)}`,
    pan,
    bank_name: e.bank_name || 'HDFC Bank',
    bank_account: e.bank_account || e.bank_account_number || `501${digits(11)}`,
    ifsc: e.ifsc || e.bank_ifsc || `HDFC0${digits(6)}`,
    uan: e.uan || e.uan_number || `100${digits(9)}`,
    esic: e.esic ?? e.esi_number ?? (e.wage <= 21000 ? `99${digits(15)}` : null),
  };
}

export const EMPLOYEES = [...HAND_WRITTEN, ...generatedEmployees(Math.max(0, HEADCOUNT - HAND_WRITTEN.length), HAND_WRITTEN.length)]
  .map(withIdentity);

/**
 * The payruns the seeder drives, built from today: the last `SEED_PAYRUN_MONTHS` full months are computed,
 * validated and paid, and the current month is left as a DRAFT with everyone in it, so the first thing a person
 * does — press Compute on a live period — has real work to do. Two months is the default because every slip is
 * produced by the engine, not written here: at 160 people that is 320 computations, and the sixth month of a
 * demo nobody reads is not worth three minutes.
 */
export const PAYRUN_MONTHS = Math.max(1, Math.min(12, Number(process.env.SEED_PAYRUN_MONTHS || 2) || 2));
export const RUNS = (() => {
  const full = monthKeysBack(PAYRUN_MONTHS + 1, { includeCurrent: false });   // +1: the newest month is dropped
  const runs = full.map((m, i) => {
    const from = `${m}-01`;
    const base = { from, to: monthEndOf(from), freq: 'MONTHLY', mode: 'PRO_RATA', status: 'PAID' };
    // The oldest month, on a run long enough to be worth showing, is a half-month pair: 50% advance then true-up.
    if (i === 0 && full.length >= 3) {
      const mid = `${m}-16`;
      return [{ ...base, to: `${m}-15`, freq: 'HALF_MONTH_FIRST', mode: 'ADVANCE_50', halves: 'H1' },
             { ...base, from: mid, to: monthEndOf(from), freq: 'HALF_MONTH_SECOND', mode: 'ADVANCE_50', halves: 'H2' }];
    }
    return [base];
  }).flat();
  const current = monthOf(TODAY);
  runs.push({ from: `${current}-01`, to: monthEndOf(`${current}-01`), freq: 'MONTHLY', mode: 'PRO_RATA', status: 'DRAFT' });
  return runs;
})();
/** Attendance is written for the months a run could look at, plus two before them so history is visible. */
export const ATTENDANCE_MONTHS = monthKeysBack(PAYRUN_MONTHS + 2);
export const FY = fiscalYear(TODAY, 4);
