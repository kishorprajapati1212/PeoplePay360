import { AppError, toIso } from '../lib/shared/index.js';
import * as repo from '../repositories/contract.repo.js';
import * as employeeRepo from '../repositories/employee.repo.js';
import * as salaryRepo from '../repositories/salary.repo.js';
import { transaction } from '../db/tx.js';
import { query } from '../db/pool.js';

export const list = (f) => repo.listContracts(f);
export const read = async (id) => { const c = await repo.getContract(id); if (!c) throw AppError.notFound('Contract not found'); return c; };
export const forEmployee = (employeeId) => repo.contractsOf(employeeId);
/**
 * The rule from the brief: one running contract per employee per period. We check it by DATE RANGE
 * (not by a status flag), so retroactive changes and renewals behave. The DB has a partial unique index
 * as the backstop for `status='RUNNING'`.
 */
export async function save(id, data, { auth } = {}) {
  const existing = id ? await repo.getContract(id) : null;
  if (id && !existing) throw AppError.notFound('Contract not found');
  const employeeId = data.employee_id || existing?.employee_id || null;
  if (!employeeId) throw AppError.badRequest('Employee is required', { code: 'EMPLOYEE_REQUIRED' });
  const employee = await employeeRepo.getEmployeeRaw(employeeId);
  if (!employee) throw AppError.notFound('Employee not found');
  // a PATCH carries only what changed, so the untouched dates come from the stored contract
  const from = toIso(data.start_date ?? existing?.start_date);
  const to = data.end_date !== undefined ? (data.end_date ? toIso(data.end_date) : null)
    : (existing?.end_date ? toIso(existing.end_date) : null);
  if (to && to < from) throw AppError.badRequest('End date must be on or after the start date', { code: 'DATE_RANGE' });
  if (from < toIso(employee.date_of_joining)) throw AppError.badRequest('Contract cannot start before the date of joining', { code: 'BEFORE_JOINING' });
  if (employee.date_of_exit && from > toIso(employee.date_of_exit)) throw AppError.badRequest('Contract cannot start after the exit date', { code: 'AFTER_EXIT' });
  if (data.wage != null && Number(data.wage) < 0) throw AppError.badRequest('Wage cannot be negative');
  const structureId = data.salary_structure_id ?? existing?.salary_structure_id ?? null;
  if (!structureId && !id) throw AppError.badRequest('Salary Structure is required', { code: 'STRUCTURE_REQUIRED' });
  if (structureId) {
    const st = await salaryRepo.getStructure(structureId);
    if (!st) throw AppError.badRequest('Unknown salary structure', { code: 'STRUCTURE_UNKNOWN' });
    if (!Number(st.rules)) throw new AppError('STRUCTURE_EMPTY', `“${st.name}” has no salary rules yet — add rules before assigning it`, { status: 422 });
  }
  const clashes = await repo.overlaps(employeeId, from, to || '9999-12-31', id);
  if (clashes.length) {
    throw new AppError('PERIOD_OVERLAP', `Another contract already covers these dates (${clashes.map((c) => `${c.contract_number}: ${toIso(c.start_date)} → ${c.end_date ? toIso(c.end_date) : 'open'}`).join('; ')})`,
      { status: 409, details: { overlaps: clashes } });
  }
  return transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    const payload = { ...data, employee_id: employeeId, start_date: from, end_date: to, salary_structure_id: structureId };
    if (payload.is_primary) await q(`update contracts set is_primary = false where employee_id = $1 and id is distinct from $2::uuid`, [employeeId, id || null]);
    const saved = id ? await repo.updateContract(id, payload, q) : await repo.createContract(payload, q);
    // a Running contract drives master data: department / job / schedule are mirrored onto the employee
    if (saved.status === 'RUNNING') {
      await q(`update employees set department_id = coalesce($2, department_id), job_position = coalesce($3, job_position),
                      working_schedule_id = coalesce($4, working_schedule_id), basic_salary = coalesce($5, basic_salary) where id = $1`,
        [employeeId, saved.department_id, saved.job_position, saved.working_schedule_id, saved.wage]);
    }
    return repo.getContract(saved.id, q);
  });
}
export const create = (d, ctx) => save(null, d, ctx);
export const update = (id, d, ctx) => save(id, d, ctx);
export async function terminate(id, { end_date, reason }, ctx) {
  const c = await repo.getContract(id);
  if (!c) throw AppError.notFound('Contract not found');
  if (c.status !== 'RUNNING') throw new AppError('LOCKED', `Only a Running contract can be terminated (this one is ${c.status.toLowerCase()})`, { status: 409 });
  const to = end_date ? toIso(end_date) : toIso(new Date());
  if (to < toIso(c.start_date)) throw AppError.badRequest('Termination date is before the contract start date');
  return transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    const paid = await q(`select 1 from payslips p join payruns r on r.id = p.payrun_id
      where p.contract_id = $1 and r.status = 'PAID' and p.period_end > $2 limit 1`, [id, to]).then((r) => r.rowCount > 0);
    if (paid) throw new AppError('PAID_AFTER_DATE', 'Salary has already been paid for a period after this date', { status: 409 });
    await repo.setStatus(id, 'TERMINATED', { end_date: to }, q);
    if (reason) await q(`update contracts set notes = coalesce(notes || ' | ', '') || $2 where id = $1`, [id, `terminated: ${reason}`]);
    return repo.getContract(id, q);
  });
}
/** Renewal closes the old row's dates and opens a new one — history stays queryable. */
export async function renew(id, data, ctx) {
  const c = await repo.getContract(id);
  if (!c) throw AppError.notFound('Contract not found');
  const newStart = toIso(data.start_date || addOneDay(toIso(c.end_date || c.start_date)));
  return transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    if (c.status === 'RUNNING') await repo.setStatus(id, 'EXPIRED', { end_date: previousDay(newStart) }, q);
    return repo.createContract({ ...c, ...data, id: undefined, contract_number: undefined, employee_id: c.employee_id, start_date: newStart,
      end_date: data.end_date ? toIso(data.end_date) : null, status: data.status || 'RUNNING', is_primary: true,
      salary_structure_id: data.salary_structure_id || c.salary_structure_id, working_schedule_id: data.working_schedule_id || c.working_schedule_id,
      department_id: data.department_id || c.department_id, job_position: data.job_position || c.job_position, wage: data.wage ?? c.wage }, q).then((n) => repo.getContract(n.id));
  });
}
const addOneDay = (d) => toIso(new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000));
const previousDay = (d) => toIso(new Date(new Date(`${d}T00:00:00Z`).getTime() - 86400000));
export const expiring = (days) => repo.expiring(days ? Number(days) : 30);
export const refreshExpired = () => repo.demoteExpired();
