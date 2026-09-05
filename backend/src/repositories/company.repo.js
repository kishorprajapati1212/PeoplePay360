import { query } from '../db/pool.js';
import { mapKeys } from './sql.js';

// The mail_* and smtp_* keys are editable so a company can point the app at its own mailbox from the
// settings screen; smtp_password is accepted here and then handled as a write-only field below.
const EDITABLE = ['company_name','legal_name','address','city','state','postal_code','country','timezone','currency','currency_symbol',
  'mail_enabled','mail_from','mail_daily_limit','smtp_host','smtp_port','smtp_secure','smtp_user','smtp_password',
  'mail_invite_ttl_minutes',      // how long a set-password link lives, in minutes — see migration 015
  'fiscal_year_start_month','payroll_day_basis','default_hours_per_day','overtime_multiplier','overtime_round_to','overtime_min_hours',
  'round_net_to_rupee','sandwich_rule','pf_enabled','pf_employee_pct','pf_employer_pct','pf_wage_ceiling','esi_enabled','esi_employee_pct',
  'esi_employer_pct','esi_wage_limit','pt_enabled','pt_monthly','pt_annual_cap','pt_charge_slice','pt_state','advance_percentage',
  'allow_negative_net','payslip_footer','document_retention_years'];
/** `select *` plus this function is the whole read path, so the secret strip below covers every caller. */
export async function getCompany() {
  const r = await query(`select * from company_settings where id`);
  return withoutSecret(r.rows[0]);
}
/** The password goes back out of the process only as a boolean: enough for "stored", never enough to leak. */
function withoutSecret(row) {
  if (!row) return row;
  const { smtp_password: secret, ...rest } = row;
  return { ...mapKeys(rest, ['default_hours_per_day','overtime_multiplier','overtime_round_to','overtime_min_hours','pf_employee_pct','pf_employer_pct','pf_wage_ceiling',
    'esi_employee_pct','esi_employer_pct','esi_wage_limit','pt_monthly','pt_annual_cap','advance_percentage','fiscal_year_start_month','mail_daily_limit',
    'smtp_port','document_retention_years']), smtp_password_set: Boolean(secret) };
}
/** What the mailer needs, in one call, including the password. Only the mailer may use this. */
export const mailRow = () => query(`select mail_enabled, mail_from, mail_daily_limit, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password
                                    from company_settings where id`).then((r) => r.rows[0] || {});
export const editableFields = () => EDITABLE;
export async function updateCompany(patch) {
  const keys = Object.keys(patch).filter((k) => EDITABLE.includes(k));
  if (!keys.length) return getCompany();
  const { rows } = await query(`update company_settings set ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} where id returning *`,
    keys.map((k) => patch[k]));
  return withoutSecret(rows[0]);
}
export const companySummary = () =>
  query(`select (select count(*) from employees where status = 'ACTIVE') as active_employees,
                (select count(*) from users) as users,
                (select count(*) from payruns) as payruns,
                (select count(*) from payslips) as payslips,
                (select count(*) from task_queue where status in ('PENDING','PROCESSING')) as pending_jobs,
                (select to_char(max(created_at) at time zone 'UTC','YYYY-MM-DD HH24:MI') from payslips) as last_payslip`).then((r) => mapKeys(r.rows[0],
    ['active_employees','users','payruns','payslips','pending_jobs']));
