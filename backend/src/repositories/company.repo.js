import { query } from '../db/pool.js';
import { mapKeys } from './sql.js';

const EDITABLE = ['company_name','legal_name','address','city','state','postal_code','country','timezone','currency','currency_symbol',
  'fiscal_year_start_month','payroll_day_basis','default_hours_per_day','overtime_multiplier','overtime_round_to','overtime_min_hours',
  'round_net_to_rupee','sandwich_rule','pf_enabled','pf_employee_pct','pf_employer_pct','pf_wage_ceiling','esi_enabled','esi_employee_pct',
  'esi_employer_pct','esi_wage_limit','pt_enabled','pt_monthly','pt_annual_cap','pt_charge_slice','pt_state','advance_percentage',
  'allow_negative_net','payslip_footer','mail_from','mail_daily_limit','document_retention_years'];
export const getCompany = () => query(`select * from company_settings where id`).then((r) => mapKeys(r.rows[0],
  ['default_hours_per_day','overtime_multiplier','overtime_round_to','overtime_min_hours','pf_employee_pct','pf_employer_pct','pf_wage_ceiling',
   'esi_employee_pct','esi_employer_pct','esi_wage_limit','pt_monthly','pt_annual_cap','advance_percentage','fiscal_year_start_month','mail_daily_limit','document_retention_years']));
export const editableFields = () => EDITABLE;
export async function updateCompany(patch) {
  const keys = Object.keys(patch).filter((k) => EDITABLE.includes(k));
  if (!keys.length) return getCompany();
  const { rows } = await query(`update company_settings set ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} where id returning *`,
    keys.map((k) => patch[k]));
  return mapKeys(rows[0], []);
}
export const companySummary = () =>
  query(`select (select count(*) from employees where status = 'ACTIVE') as active_employees,
                (select count(*) from users) as users,
                (select count(*) from payruns) as payruns,
                (select count(*) from payslips) as payslips,
                (select count(*) from task_queue where status in ('PENDING','PROCESSING')) as pending_jobs,
                (select to_char(max(created_at) at time zone 'UTC','YYYY-MM-DD HH24:MI') from payslips) as last_payslip`).then((r) => mapKeys(r.rows[0],
    ['active_employees','users','payruns','payslips','pending_jobs']));
