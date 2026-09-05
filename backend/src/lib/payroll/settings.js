/**
 * Maps the company_settings row onto the settings object the engine reads.
 * Nothing statutory is hardcoded in the engine: the Settings screen edits these columns and the
 * very next compute picks them up. (day_basis, in particular, decides the per-day divisor.)
 */
export const DAY_BASIS_DIVISOR = { CALENDAR_DAYS: (d) => daysBetween(d.from, d.to), FIXED_30: () => 30, FIXED_26: () => 26 };
export const toPaise = (v) => Math.round((Number(v) || 0) * 100);

function daysBetween(a, b) {
  const x = new Date(`${String(a).slice(0, 10)}T00:00:00Z`), y = new Date(`${String(b).slice(0, 10)}T00:00:00Z`);
  return Math.max(1, Math.round((y - x) / 86400000) + 1);
}
const bool = (v, d = false) => (v === null || v === undefined ? d : !!v);
const num = (v, d = 0) => (v === null || v === undefined || v === '' ? d : Number(v));

export function settingsFrom(row = {}) {
  const s = {
    companyName: row.company_name || 'OXP Pvt Ltd',
    legalName: row.legal_name || row.company_name || 'OXP Private Limited',
    address: [row.address, row.city, row.state, row.postal_code, row.country].filter(Boolean).join(', '),
    state: row.state || 'Gujarat',
    timezone: row.timezone || 'Asia/Kolkata',
    currency: row.currency || 'INR',
    currencySymbol: row.currency_symbol || '₹',
    fyStartMonth: num(row.fiscal_year_start_month, 4),
    dayBasis: row.payroll_day_basis || 'ACTUAL_WORKING_DAYS',
    defaultHoursPerDay: num(row.default_hours_per_day, 8),
    overtime: { multiplier: num(row.overtime_multiplier, 1.5), roundTo: num(row.overtime_round_to, 0.25), minHours: num(row.overtime_min_hours, 0.5) },
    advancePct: num(row.advance_percentage, 50),
    roundNetToRupee: bool(row.round_net_to_rupee),
    sandwichRule: bool(row.sandwich_rule),
    allowNegativeNet: bool(row.allow_negative_net),
    pf: { enabled: bool(row.pf_enabled, true), employeePct: num(row.pf_employee_pct, 12), employerPct: num(row.pf_employer_pct, 12), wageCeiling: toPaise(row.pf_wage_ceiling ?? 15000) },
    esi: { enabled: bool(row.esi_enabled, true), employeePct: num(row.esi_employee_pct, 0.75), employerPct: num(row.esi_employer_pct, 3.25), wageLimit: toPaise(row.esi_wage_limit ?? 21000) },
    pt: { enabled: bool(row.pt_enabled, true), monthly: toPaise(row.pt_monthly ?? 200), annualCap: toPaise(row.pt_annual_cap ?? 2500),
          chargeOn: row.pt_charge_slice || 'MONTH', state: row.pt_state || row.state || 'Gujarat' },
    ptChargeSlices: ['MONTH', 'HALF_FIRST', 'HALF_SECOND'],
    footer: row.payslip_footer || 'System generated payslip. No signature required.',
    headerNote: row.payslip_header_note || '',
    mail: { from: row.mail_from || 'Payroll <payroll@example.com>', dailyLimit: num(row.mail_daily_limit, 200) },
    retentionYears: num(row.document_retention_years, 8),
  };
  s.divisorFor = (period) => {
    const f = DAY_BASIS_DIVISOR[s.dayBasis];
    return f ? Math.max(1, f(period)) : Math.max(1, period.expectedMonthDays || 26);
  };
  return s;
}
