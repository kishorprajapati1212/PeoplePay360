import { AppError } from '../lib/shared/index.js';
import * as repo from '../repositories/company.repo.js';
import { invalidateMail, mailStatus } from './mail.service.js';
import * as salaryRepo from '../repositories/salary.repo.js';
export const read = () => repo.getCompany();
export async function update(patch, { auth } = {}) {
  const keys = Object.keys(patch);
  const allowed = repo.editableFields();
  const bad = keys.filter((k) => !allowed.includes(k));
  if (bad.length) throw new AppError('FIELD_NOT_EDITABLE', `These settings are fixed by the schema: ${bad.join(', ')}`, { status: 400, details: { allowed } });
  if (patch.fiscal_year_start_month != null && !(Number(patch.fiscal_year_start_month) >= 1 && Number(patch.fiscal_year_start_month) <= 12)) {
    throw AppError.badRequest('Fiscal year must start between month 1 and 12');
  }
  if (patch.pf_employee_pct != null && Number(patch.pf_employee_pct) > 25) throw AppError.badRequest('PF percentage above 25% is not valid under the rules this app models');
  if (patch.smtp_password !== undefined && String(patch.smtp_password).trim() === '') delete patch.smtp_password;
  const MAIL_KEYS = ['mail_enabled', 'mail_from', 'mail_daily_limit', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_password'];
  const touchedMail = Object.keys(patch).some((k) => MAIL_KEYS.includes(k));
  const before = await repo.getCompany();
  const after = await repo.updateCompany(patch);
  if (touchedMail) invalidateMail();          // so the next send — and this response — use the new login
  const mail = touchedMail ? await mailStatus() : null;
  const notes = ['Applies to the next computation — already-paid payslips are never rewritten'];
  if (mail) notes.push(mail.enabled
    ? `Mail goes out through the ${mail.driver} driver from now on${mail.note ? ` — ${mail.note}` : ''}. Test it with "Check mail".`
    : 'Mail is switched off, so every message is written to backend/storage/mail as a .eml and nothing is sent.');
  return { before, after, mail, note: notes.join(' ') };
}
export const summary = () => repo.companySummary();
export const ptSlabs = (state) => salaryRepo.ptSlabs(state);
export const addPtSlab = (d) => salaryRepo.createPtSlab(d);
export const removePtSlab = (id) => salaryRepo.deletePtSlab(id);
