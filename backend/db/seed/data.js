/**
 * Demo data for PeoplePay360. Everything here is *shape*, not money: payslip numbers are produced by the
 * payroll engine when the seeder drives the real services (see seed.js), so a rule change is immediately
 * visible in the seeded company. Dates are anchored to FY 2026-27 (1 Apr 2026) because that is "now".
 */
export const TODAY = new Date().toISOString().slice(0, 10);

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

/** The rule set behind the validated fixture: ₹85,000 wage → ₹62,350 gross → ₹60,350 net for a full month. */
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
  { code: 'LTA', name: 'Leave Travel Allowance', category: 'REIMBURSEMENT', line_kind: 'EARNING', sequence: 6,
    computation_type: 'FIXED', amount: 1000, pro_rata: false, evaluation_period: 'FISCAL_YEAR', appears_on_payslip: false, is_taxable: false, ...over.lta },
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
  { key: 'admin', name: 'Anita Rao', work_email: 'admin@oxp.com', role: 'ADMIN', roles: ['ADMIN', 'HR_MANAGER'] },
  { key: 'hr', name: 'Kunal Shah', work_email: 'hr@oxp.com', role: 'HR_MANAGER', roles: ['HR_MANAGER'] },
  { key: 'hr_user', name: 'Sneha Kulkarni', work_email: 'hr2@oxp.com', role: 'HR_PAYROLL_USER', roles: ['HR_PAYROLL_USER'] },
  { key: 'payroll', name: 'Meera Iyer', work_email: 'payroll@oxp.com', role: 'HR_PAYROLL_USER', roles: ['HR_PAYROLL_USER', 'HR_MANAGER'] },
  { key: 'payroll_admin', name: 'Rahul Verma', work_email: 'payroll-admin@oxp.com', role: 'HR_PAYROLL_MANAGER', roles: ['HR_PAYROLL_MANAGER'] },
];

/**
 * `structure` is a code from STRUCTURES, `schedule` an index into SCHEDULES.
 * Wages are the monthly contract wage (the base every percentage rule reads).
 */
export const EMPLOYEES = [
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
  { name: 'Casual Leave', code: 'CL', unit: 'DAYS', requires_allocation: true, max_days_per_year: 12, approval_route: 'MANAGER',
    is_unpaid: false, payslip_code: 'CL', carry_forward: false, sandwich_rule: false, min_notice_days: 0, display_color: 'Blue',
    work_entry_type: 'Leave Work Entry', description: 'Short-notice personal leave. 12 days a year, does not carry forward.' },
  { name: 'Privilege Leave', code: 'PL', unit: 'DAYS', requires_allocation: true, max_days_per_year: 15, approval_route: 'HR',
    is_unpaid: false, payslip_code: 'PL', carry_forward: true, sandwich_rule: false, min_notice_days: 3, display_color: 'Green',
    work_entry_type: 'Leave Work Entry', description: 'Planned time off. 15 days a year, up to 5 carry forward.' },
  { name: 'Sick Leave', code: 'SL', unit: 'DAYS', requires_allocation: true, max_days_per_year: 7, approval_route: 'MANAGER',
    is_unpaid: false, payslip_code: 'SL', carry_forward: false, sandwich_rule: true, min_notice_days: 0, display_color: 'Orange',
    work_entry_type: 'Leave Work Entry', description: 'Paid sick leave; the sandwich rule applies (weekends in between count).' },
  { name: 'Half Day', code: 'HD', unit: 'HOURS', requires_allocation: false, max_days_per_year: null, approval_route: 'MANAGER',
    is_unpaid: false, payslip_code: 'HD', carry_forward: false, sandwich_rule: false, min_notice_days: 0, display_color: 'Purple',
    work_entry_type: 'Leave Work Entry', description: 'Four paid hours, morning or afternoon.' },
  { name: 'Leave Without Pay', code: 'LWP', unit: 'DAYS', requires_allocation: false, max_days_per_year: null, approval_route: 'PAYROLL_OFFICER',
    is_unpaid: true, payslip_code: 'LOP', carry_forward: false, sandwich_rule: true, min_notice_days: 0, display_color: 'Red',
    work_entry_type: 'Loss of Pay Work Entry', description: 'Unpaid — hits the payslip as Loss of Pay at the configured day divisor.' },
  { name: 'Compensatory Off', code: 'COMP_OFF', unit: 'DAYS', requires_allocation: false, max_days_per_year: 6, approval_route: 'MANAGER',
    is_unpaid: false, payslip_code: 'COMP_OFF', carry_forward: false, sandwich_rule: false, min_notice_days: 0, display_color: 'Teal',
    work_entry_type: 'Leave Work Entry', description: 'Granted for weekend working; expires with the quarter.' },
  { name: 'Maternity Leave', code: 'MAT', unit: 'DAYS', requires_allocation: false, max_days_per_year: 182, approval_route: 'HR',
    is_unpaid: false, payslip_code: 'MAT', carry_forward: false, sandwich_rule: false, min_notice_days: 0, display_color: 'Pink',
    work_entry_type: 'Paid Work Entry', description: '26 weeks, paid, no balance needed.' },
];

/** Payroll runs the seeder drives. `halves` → one ADVANCE_50 first half plus a true-up second half. */
export const RUNS = [
  { from: '2026-02-01', to: '2026-02-28', freq: 'MONTHLY', mode: 'PRO_RATA', status: 'PAID' },
  { from: '2026-03-01', to: '2026-03-15', freq: 'HALF_MONTH_FIRST', mode: 'ADVANCE_50', status: 'PAID', halves: 'H1' },
  { from: '2026-03-16', to: '2026-03-31', freq: 'HALF_MONTH_SECOND', mode: 'ADVANCE_50', status: 'PAID', halves: 'H2' },
  { from: '2026-04-01', to: '2026-04-30', freq: 'MONTHLY', mode: 'PRO_RATA', status: 'PAID' },
  { from: '2026-05-01', to: '2026-05-31', freq: 'MONTHLY', mode: 'PRO_RATA', status: 'PAID' },
  { from: '2026-06-01', to: '2026-06-30', freq: 'MONTHLY', mode: 'PRO_RATA', status: 'PAID' },
  { from: '2026-07-01', to: '2026-07-31', freq: 'MONTHLY', mode: 'PRO_RATA', status: 'PAID' },
  { from: '2026-08-01', to: '2026-08-31', freq: 'MONTHLY', mode: 'PRO_RATA', status: 'PAID' },
  { from: '2026-09-01', to: '2026-09-30', freq: 'MONTHLY', mode: 'PRO_RATA', status: 'DRAFT' },
];
export const ATTENDANCE_MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
/** Small deterministic pseudo-random so a re-seed produces the same demo (nice for screenshots and tests). */
export const rng = (seed = 7) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
