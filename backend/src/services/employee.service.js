import { AppError, toIso, csvToObjects } from '../lib/shared/index.js';
import { transaction } from '../db/tx.js';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../middleware/auth.js';
import * as repo from '../repositories/employee.repo.js';
import * as userRepo from '../repositories/user.repo.js';
import * as contractRepo from '../repositories/contract.repo.js';
import * as salaryRepo from '../repositories/salary.repo.js';
import { createInvite } from './user.service.js';
import { recordAudit } from '../middleware/audit.js';

export const list = (f) => repo.listEmployees(f);
export const read = async (id) => {
  const e = await repo.getEmployee(id);
  if (!e) throw AppError.notFound('Employee not found');
  return e;
};
export const summary = (id) => repo.employeeSummary(id);
export const contracts = (id) => contractRepo.contractsOf(id);

/**
 * Creating an employee can also create their login in the same transaction — the mockup's
 * "User Management" panel creates a user for an employee, and half-created people are how you end up
 * with an employee who can never sign in.
 */
export async function create(data, { auth } = {}) {
  const payload = { ...data };
  if (!payload.employee_code) payload.employee_code = await repo.nextEmployeeCode();
  if (await repo.emailTaken(payload.work_email)) throw AppError.conflict('That work email is already used by another employee record', { code: 'EMAIL_TAKEN' });
  // "Email a set-password link": nobody types a starting password, the person gets a one-time link
  // (single-use, hashed at rest, 72h) and picks their own. The account gets a random throwaway hash
  // until then, so there is no shared secret floating around.
  const viaInvite = !!(payload.user && (payload.user.send_invite || (!payload.user.password && payload.user.password !== '')));
  if (viaInvite) delete payload.user.password;
  let invite = null;
  const out = await transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    const employee = await repo.createEmployee(payload, q);
    let user = null;
    if (payload.user) {
      // invite mode: a random unknown-to-everyone password + must_change — the link is the real way in
      const secret = viaInvite ? randomBytes(18).toString('base64url') : payload.user.password;
      const hash = await hashPassword(secret);
      user = await userRepo.createUser({ name: payload.name, work_email: payload.work_email, password_hash: hash,
        role: payload.user.role || 'EMPLOYEE', must_change_pw: viaInvite ? true : !!payload.user.must_change_pw }, q).then((u) => u);
      const roles = payload.user.roles?.length ? payload.user.roles : [payload.user.role || 'EMPLOYEE'];
      await userRepo.setRoles(user.id, roles, auth?.userId, q);
      await q(`update employees set user_id = $2 where id = $1`, [employee.id, user.id]);
    }
    if (payload.contract) {
      const structure = payload.contract.salary_structure_id
        || (payload.contract.salary_structure ? await salaryRepo.getStructureByName(payload.contract.salary_structure).then((s) => s?.id) : null);
      if (!structure) throw AppError.badRequest('Pick a salary structure before creating the contract', { code: 'STRUCTURE_REQUIRED' });
      await contractRepo.createContract({ ...payload.contract, employee_id: employee.id, salary_structure_id: structure,
        department_id: payload.contract.department_id || payload.department_id, job_position: payload.contract.job_position || payload.job_position,
        working_schedule_id: payload.contract.working_schedule_id || payload.working_schedule_id, status: payload.contract.status || 'RUNNING', is_primary: true }, q);
    }
    const full = await repo.getEmployee(employee.id, q);
    return { ...full, user: user ? { id: user.id, roles: (payload.user?.roles || [payload.user?.role || 'EMPLOYEE']) } : null };
  });
  // The link is minted after the commit — an invite row for a half-made employee helps nobody.
  if (viaInvite && out.user) {
    try { invite = await createInvite(out.user.id, { auth, sendEmail: true }); }
    catch (e) { invite = { error: e.message }; }
  }
  return invite ? { ...out, invite } : out;
}
export async function update(id, patch, { auth } = {}) {
  const before = await repo.getEmployeeRaw(id);
  if (!before) throw AppError.notFound('Employee not found');
  if (patch.work_email && await repo.emailTaken(patch.work_email, id)) throw AppError.conflict('That work email is already in use', { code: 'EMAIL_TAKEN' });
  const updated = await repo.updateEmployee(id, patch);
  if (patch.user_roles && before.user_id) await userRepo.setRoles(before.user_id, patch.user_roles, auth?.userId);
  return repo.getEmployee(id).then((e) => ({ ...e, changed: diff(before, patch) }));
}
const diff = (before, patch) => Object.fromEntries(Object.keys(patch).filter((k) => String(before[k] ?? '') !== String(patch[k] ?? '')).map((k) => [k, patch[k]]));
export async function terminate(id, { date_of_exit, reason }, { auth } = {}) {
  const before = await repo.getEmployeeRaw(id);
  if (!before) throw AppError.notFound('Employee not found');
  if (before.status === 'TERMINATED') throw AppError.conflict('This employee is already terminated');
  const exit = date_of_exit || toIso(new Date());
  if (exit < toIso(before.date_of_joining)) throw AppError.badRequest('Exit date cannot be before the date of joining');
  return transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    const e = await repo.setEmployeeStatus(id, 'TERMINATED', { date_of_exit: exit }, q);
    await q(`update contracts set status = 'TERMINATED', end_date = least(coalesce(end_date, $2), $2) where employee_id = $1 and status = 'RUNNING'`, [id, exit]);
    await q(`update users set is_active = false where id = (select user_id from employees where id = $1)`, [id]);
    await recordAudit({ actorUserId: auth?.userId, actorRole: (auth?.roles || [])[0], action: 'TERMINATE', entity: 'employee', entityId: id,
                        before: { status: before.status }, after: { status: 'TERMINATED', date_of_exit: exit, reason: reason || null } });
    return repo.getEmployee(id, q);
  });
}
/**
 * CSV import: the mockup's bulk onboarding. Validated row by row; nothing is written unless every row
 * is clean (or `dryRun`), because a half-imported staff list is worse than none.
 */
export async function importCsv(body, { auth } = {}) {
  const { csv, dry_run: drySnake, default_structure_id: defSnake } = body || {};
  const dryRun = body?.dryRun ?? drySnake ?? true;
  const defaultStructureId = body?.defaultStructureId ?? defSnake ?? null;
  const parsed = csvToObjects(csv);
  if (!parsed) throw AppError.badRequest('The file needs a header row and at least one employee');
  const rows = parsed;
  const errors = [];
  const clean = [];
  for (const r of rows) {
    const e = [];
    if (!r.name) e.push('name is required');
    if (!r.work_email || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(r.work_email)) e.push('a valid work_email is required');
    if (!r.date_of_joining || Number.isNaN(Date.parse(r.date_of_joining))) e.push('date_of_joining must be a date');
    if (r.basic_salary && !Number.isFinite(Number(r.basic_salary))) e.push('basic_salary must be a number');
    if (r.work_email && await repo.emailTaken(r.work_email)) e.push('work email already exists');
    if (e.length) errors.push({ line: r.__line, name: r.name || '(blank)', errors: e });
    else clean.push(r);
  }
  if (errors.length || dryRun) return { ok: errors.length === 0, dryRun, total: rows.length, valid: clean.length, errors, preview: clean.slice(0, 20) };
  const depts = new Map((await (await import('../repositories/org.repo.js')).listDepartments({ includeInactive: true }))
    .map((d) => [d.name.toLowerCase(), d.id]));
  const created = [];
  for (const r of clean) {
    const departmentId = r.department_id || depts.get(String(r.department || '').toLowerCase()) || null;
    const employee = await create({ name: r.name, work_email: r.work_email, date_of_joining: toIso(r.date_of_joining),
      basic_salary: r.basic_salary ? Number(r.basic_salary) : null, job_position: r.job_position || null,
      department_id: departmentId, employee_type: (r.employee_type || 'FULL_TIME').toUpperCase(),
      ...(r.basic_salary || r.salary_structure || defaultStructureId ? { contract: { wage: Number(r.basic_salary || 0) || 0, start_date: toIso(r.date_of_joining), salary_structure_id: r.salary_structure_id || defaultStructureId, status: 'RUNNING' } } : {}) }, { auth });
    created.push({ id: employee.id, name: employee.name, code: employee.employee_code });
  }
  return { ok: true, dryRun: false, total: rows.length, valid: clean.length, created, errors: [] };
}
function splitCsv(line) {  // kept for callers inside this module
  const out = []; let cur = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; continue; }
    if (c === ',' && !quoted) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
