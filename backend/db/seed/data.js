/**
 * Demo data for PeoplePay360. Everything here is *shape*, not money: payslip numbers are produced by the
 * payroll engine when the seeder drives the real services (see seed.js), so a rule change is immediately
 * visible in the seeded company. Dates are anchored to FY 2026-27 (1 Apr 2026) because that is "now".
 */
export const TODAY = new Date().toISOString().slice(0, 10);

/** Small deterministic pseudo-random so a re-seed produces the same demo (nice for screenshots and tests). */
export const rng = (seed = 7) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

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

/**
 * …and the rest of the company. A demo of 13 people proves the flows; a demo of ~240 proves the
 * screens (lists paginate, search finds, dashboards aggregate). Generated once, deterministically,
 * from the same rng as everything else — two fresh installs show the same faces.
 *
 * The spread mirrors a real services company: Engineering and Support carry the headcount, Sales
 * is on the incentive structure, interns/part-timers on the stipend one, everyone else on STD.
 * Joining dates deliberately run right up to *after* the current month's payrun window, so a
 * handful of September/October joiners have no payslip yet — "some employees are not in a payrun"
 * is then visible in the data instead of being a hand-wave.
 */
const FIRST_M = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rudra', 'Kabir', 'Dhruv', 'Aryan', 'Yash', 'Atharv', 'Pranav', 'Ritesh', 'Siddharth', 'Harsh', 'Manav', 'Nikhil', 'Rahul', 'Karan', 'Varun', 'Tanmay', 'Omkar', 'Samar', 'Yuvraj', 'Dev', 'Abhay', 'Girish', 'Chirag', 'Nilesh', 'Paresh', 'Mehul', 'Jatin', 'Ketan', 'Sameer', 'Aakash', 'Shreyas', 'Parth', 'Nimit', 'Utsav', 'Viral', 'Jay', 'Harshil', 'Bhavin', 'Ashwin', 'Raj', 'Suraj'];
const FIRST_F = ['Diya', 'Ananya', 'Aadhya', 'Myra', 'Saanvi', 'Ira', 'Kiara', 'Anvi', 'Navya', 'Aarohi', 'Pooja', 'Riya', 'Sneha', 'Meera', 'Kavya', 'Ishita', 'Lavanya', 'Roshni', 'Shreya', 'Tanvi', 'Nisha', 'Aisha', 'Zoya', 'Simran', 'Mansi', 'Deepa', 'Asha', 'Geeta', 'Rekha', 'Sunita', 'Jaya', 'Vidhi', 'Heena', 'Rukhsar', 'Salma', 'Nargis', 'Komal', 'Pallavi', 'Shruti', 'Akshata', 'Bhavana', 'Chhaya', 'Dimple', 'Ekta', 'Falguni', 'Gauri', 'Hiral', 'Janki', 'Krupa', 'Lata', 'Mitali'];
const LAST = ['Mehta', 'Shah', 'Patel', 'Desai', 'Trivedi', 'Chauhan', 'Panchal', 'Joshi', 'Bhatt', 'Modi', 'Rathod', 'Solanki', 'Vaghela', 'Parmar', 'Brahmbhatt', 'Doshi', 'Jani', 'Kadia', 'Thakkar', 'Mistry', 'Bhavsar', 'Dave', 'Gandhi', 'Iyer', 'Nair', 'Menon', 'Pillai', 'Kulkarni', 'Deshpande', 'Reddy', 'Rao', 'Shetty', 'Naik', 'Kamath', 'Sharma', 'Verma', 'Gupta', 'Singh', 'Yadav', 'Mishra', 'Tiwari', 'Agrawal', 'Goel', 'Bansal', 'Saxena', 'Kapoor', 'Malhotra', 'Chopra', 'Bhatnagar', 'Qureshi', 'Sheikh', 'Ansari', 'Khan', 'Buch', 'Dhamecha', 'Gohil', 'Hathi', 'Jokhi', 'Limbasiya'];
const CITIES = ['Ahmedabad', 'Gandhinagar', 'Surat', 'Vadodara', 'Rajkot', 'Mumbai', 'Pune', 'Nashik', 'Hyderabad', 'Bengaluru', 'Chennai', 'Kochi', 'Jaipur', 'Indore', 'Nagpur', 'Lucknow'];
/** dept → [positions as [title, wageLow, wageHigh]] in ₹/month; `sales` routes the dept to SLS. */
const BULK_PLAN = [
  { dept: 'Engineering', n: 55, sales: false, positions: [['Software Engineer', 28000, 55000], ['Senior Software Engineer', 65000, 95000], ['QA Engineer', 24000, 42000], ['DevOps Engineer', 45000, 75000], ['Data Engineer', 38000, 68000], ['Engineering Manager', 90000, 130000]] },
  { dept: 'People Operations', n: 20, sales: false, positions: [['HR Executive', 24000, 38000], ['Recruiter', 26000, 44000], ['HR Business Partner', 55000, 80000]] },
  { dept: 'Payroll & Finance', n: 25, sales: false, positions: [['Payroll Officer', 30000, 52000], ['Accounts Executive', 24000, 40000], ['Finance Analyst', 40000, 70000]] },
  { dept: 'Sales', n: 55, sales: true, positions: [['Sales Executive', 22000, 38000], ['Account Manager', 40000, 65000], ['Senior Account Manager', 60000, 90000]] },
  { dept: 'Customer Support', n: 72, sales: false, positions: [['Support Engineer', 20000, 34000], ['Senior Support Engineer', 34000, 52000], ['Support Lead', 48000, 70000]] },
];
/** The core person each generated employee reports to (they also head the department). */
const BULK_HEADS = { Engineering: 'aarav', 'People Operations': 'rohan', 'Payroll & Finance': 'fatima', Sales: 'neha', 'Customer Support': 'sana' };
const isoFrom = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const bulkEmployees = (() => {
  const rand = rng(20260906);
  const out = [];
  const today = new Date();
  let n = 0;
  for (const plan of BULK_PLAN) {
    for (let k = 0; k < plan.n; k++) {
      n += 1;
      const female = rand() < 0.45;
      const first = (female ? FIRST_F : FIRST_M)[Math.floor(rand() * (female ? FIRST_F : FIRST_M).length)];
      const last = LAST[Math.floor(rand() * LAST.length)];
      const [position, lo, hi] = plan.positions[Math.floor(rand() * plan.positions.length)];
      // every 14th generated person is on a fixed-term contract, every 16th an intern, every 21st part-time
      const kind = n % 16 === 0 ? 'INTERN' : n % 21 === 0 ? 'PART_TIME' : n % 14 === 0 ? 'CONTRACT' : 'FULL_TIME';
      const wage = Math.round((lo + rand() * (hi - lo)) / 500) * 500;
      // joining: 40% old-timers, 35% 2024-25, 20% this year, 5% mid-September onward (no payslip yet)
      const roll = rand();
      let joining;
      if (roll < 0.40) joining = isoFrom(2019 + Math.floor(rand() * 5), 1 + Math.floor(rand() * 12), 1 + Math.floor(rand() * 28));
      else if (roll < 0.75) joining = isoFrom(2024 + Math.floor(rand() * 2), 1 + Math.floor(rand() * 12), 1 + Math.floor(rand() * 28));
          else if (roll < 0.95) joining = isoFrom(2026, 1 + Math.floor(rand() * 9), 1 + Math.floor(rand() * 28));   // Jan–Sep: a late-September joiner shows the mid-month pro-rata
      // the month AFTER next: past even next month's DRAFT run, so these people visibly have no
      // payslip at all until someone creates a payrun that covers them — "some employees are not
      // in a payrun", as asked. (getUTCMonth is 0-based: +1 is this month, +2 is next.)
      else joining = isoFrom(today.getUTCFullYear(), today.getUTCMonth() + 3, 3 + Math.floor(rand() * 18));
      // half the fixed-term contracts have already ended (history keeps their old payslips)
      let exit = null;
      if (kind === 'CONTRACT' && rand() < 0.5) {
        const past = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1 - Math.floor(rand() * 3), 1 + Math.floor(rand() * 27)));
        exit = past.toISOString().slice(0, 10);
        if (exit <= joining) exit = null;
      }
      out.push({
        key: `g${n}`, name: `${first} ${last}`,
        email: `${first}.${last}${n}`.toLowerCase().replace(/[^a-z0-9._@]/g, '') + '@oxp.com',
        dept: plan.dept, position: kind === 'INTERN' ? `${position} (Intern)` : kind === 'CONTRACT' ? `${position} (Contract)` : position,
        type: kind, wage,
        joining, exit,
        schedule: plan.dept === 'Customer Support' && kind !== 'INTERN' ? 1 : kind === 'INTERN' ? 2 : 0,
        structure: plan.sales && kind === 'FULL_TIME' ? 'SLS' : (kind === 'INTERN' || kind === 'PART_TIME') ? 'INT' : 'STD',
        city: CITIES[Math.floor(rand() * CITIES.length)], gender: female ? 'Female' : 'Male',
        manager: BULK_HEADS[plan.dept],
        ...(plan.sales && kind === 'FULL_TIME' ? { inputs: { target: Math.round(wage * 5 / 10000) * 10000, attainment: Math.round((0.5 + rand() * 0.85) * 100) / 100 } } : {}),
      });
    }
  }
  return out;
})();
export const EMPLOYEES_ALL = [...EMPLOYEES, ...bulkEmployees];

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

/** Payroll runs the seeder drives — generated from *today*, so a fresh install always has live demo
 *  data: four closed months PAID (the newest of them, on the standard structure, as an advance/
 *  true-up pair), the current month COMPUTED and waiting to be validated, and next month sitting as
 *  a DRAFT you can press Compute on.
 *
 *  Not every structure gets every run, ON PURPOSE. A payrun is one structure × one period, and the
 *  API rightly refuses a second run for a pair that already exists — a demo where every structure
 *  already has a run for every recent month leaves "New payrun" nowhere to go, and the guard reads
 *  as a bug ("it says a payrun for August already exists!"). So:
 *    STD  — the full story, all seven runs (it is the structure the halves demo needs).
 *    INT  — stops at July: August and next month are free, and the current month is only COMPUTED.
 *    SLS  — stops at June: July, August and everything after is the user's to create.
 *  Fresh joiners (September onward) are in no run at all yet, for the same reason.
 */
const pad2 = (n) => String(n).padStart(2, '0');
const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const lastDay = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const shiftMonth = (n) => new Date(new Date().getFullYear(), new Date().getMonth() + n, 1);
const span = (d) => ({ from: `${monthKey(d)}-01`, to: `${monthKey(d)}-${pad2(lastDay(d))}` });
export const RUNS = (() => {
  const runs = [];
  for (let back = 5; back >= 2; back--) {          // four closed months, monthly, paid — every structure
    const d = shiftMonth(-back);
    runs.push({ ...span(d), freq: 'MONTHLY', mode: 'PRO_RATA', status: 'PAID', structures: ['STD', 'SLS', 'INT'] });
  }
  { // the newest closed month pays as halves on STD only: 50% advance, then the true-up
    const d = shiftMonth(-1);
    runs.push({ from: `${monthKey(d)}-01`, to: `${monthKey(d)}-15`, freq: 'HALF_MONTH_FIRST', mode: 'ADVANCE_50', status: 'PAID', halves: 'H1', structures: ['STD'] });
    runs.push({ from: `${monthKey(d)}-16`, to: `${monthKey(d)}-${pad2(lastDay(d))}`, freq: 'HALF_MONTH_SECOND', mode: 'ADVANCE_50', status: 'PAID', halves: 'H2', structures: ['STD'] });
  }
  runs.push({ ...span(new Date()), freq: 'MONTHLY', mode: 'PRO_RATA', status: 'COMPUTED', structures: ['STD', 'INT'] });   // this month: numbers ready, awaiting validate
  runs.push({ ...span(shiftMonth(1)), freq: 'MONTHLY', mode: 'PRO_RATA', status: 'DRAFT', structures: ['STD'] });          // next month: an empty draft to press Compute on
  return runs;
})();
/** Attendance follows the runs: the five months that are paid plus the one being computed. */
export const ATTENDANCE_MONTHS = Array.from({ length: 6 }, (_, k) => monthKey(shiftMonth(k - 5)));
