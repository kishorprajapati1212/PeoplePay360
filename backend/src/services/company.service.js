import { AppError } from '../lib/shared/index.js';
import * as repo from '../repositories/company.repo.js';
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
  const before = await repo.getCompany();
  const after = await repo.updateCompany(patch);
  return { before, after, note: 'Applies to the next computation — already-paid payslips are never rewritten' };
}
export const summary = () => repo.companySummary();
export const ptSlabs = (state) => salaryRepo.ptSlabs(state);
export const ptSlabUsage = (id) => salaryRepo.ruleUsage(id);
export const addPtSlab = (d) => salaryRepo.createPtSlab(d);
export const removePtSlab = (id) => salaryRepo.deletePtSlab(id);
