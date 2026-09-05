import { AppError } from '../lib/shared/index.js';
import { ROLES, ROLE_LABEL, USER_ADMIN_ROLES } from '../lib/shared/index.js';
import { hashPassword } from '../middleware/auth.js';
import * as repo from '../repositories/user.repo.js';
import * as employeeRepo from '../repositories/employee.repo.js';
import { transaction } from '../db/tx.js';
import { config } from '../config.js';

export const list = (f) => repo.listUsers(f);
export const read = async (id) => {
  const u = await repo.getUser(id);
  if (!u) throw AppError.notFound('User not found');
  return u;
};
/**
 * The mockup's Create User panel: pick an employee (or create one), tick roles, set status.
 * Guards that matter: no self-demotion, and never remove the last admin.
 */
export async function create(data, { auth } = {}) {
  const roles = normaliseRoles(data.roles?.length ? data.roles : [data.role]);
  const email = String(data.work_email || '').trim().toLowerCase();
  if (await repo.getUserByEmail(email)) throw AppError.conflict('A user with this work email already exists', { code: 'EMAIL_TAKEN' });
  const password = data.password || config.demo.password;
  return transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    let employeeId = data.employee_id || null;
    if (!employeeId && data.new_employee) {
      const code = await employeeRepo.nextEmployeeCode();
      const emp = await employeeRepo.createEmployee({ employee_code: code, name: data.new_employee.name || data.name, work_email: email,
        date_of_joining: data.new_employee.date_of_joining || new Date().toISOString().slice(0, 10),
        job_position: data.new_employee.job_position || null, department_id: data.new_employee.department_id || null,
        basic_salary: data.new_employee.basic_salary || null }, q);
      employeeId = emp.id;
    }
    const user = await repo.createUser({ name: data.name, work_email: email, password_hash: await hashPassword(password),
      role: roles.includes('ADMIN') ? 'ADMIN' : roles[0], is_active: data.is_active !== false,
      must_change_pw: !!data.must_change_pw }, q);
    await repo.setRoles(user.id, roles, auth?.userId, q);
    if (employeeId) await repo.linkEmployee(user.id, employeeId, q);
    const full = await repo.getUser(user.id, q);
    // The app never shows a password, but "the shared demo password works" and "the password you typed
    // works" are two different hand-overs. Without saying which one happened, the create dialog looks
    // like a form that ate the credentials and the first sign-in fails with no explanation.
    return { ...full, password_source: data.password ? 'provided' : 'demo', sign_in_note: data.password
      ? 'Signed in with the password you typed here.'
      : `Signed in with the shared demo password (DEMO_PASSWORD in backend/.env — ${config.demo.password.length} characters).` };
  });
}
export async function update(id, patch, { auth } = {}) {
  const target = await repo.getUser(id);
  if (!target) throw AppError.notFound('User not found');
  const out = { ...target };
  if (patch.name !== undefined || patch.is_active !== undefined || patch.must_change_pw !== undefined) {
    await repo.patchUser(id, { name: patch.name, is_active: patch.is_active, must_change_pw: patch.must_change_pw });
  }
  if (patch.roles) {
    const roles = normaliseRoles(patch.roles);
    await guards({ auth, target, roles, activating: patch.is_active !== false });
    await repo.setRoles(id, roles, auth?.userId);
    await repo.linkEmployee(id, patch.employee_id === undefined ? target.employee_id : patch.employee_id);
  } else if (patch.employee_id !== undefined) {
    await repo.linkEmployee(id, patch.employee_id);
  }
  return repo.getUser(id);
}
async function guards({ auth, target, roles, activating }) {
  const isSelf = String(auth?.userId) === String(target.id);
  if (isSelf) {
    if (!roles.includes('ADMIN')) throw AppError.forbidden('You cannot remove your own admin access — ask another administrator');
    if (!activating) throw AppError.forbidden('You cannot deactivate your own account');
  }
  if (target.is_active && !activating && Number(await repo.countAdmins()) <= 1 && (target.roles || []).includes('ADMIN')) {
    throw new AppError('LAST_ADMIN', 'This is the only active admin account. Promote someone else first.', { status: 409 });
  }
  if (roles.includes('ADMIN') && !auth?.roles?.includes('ADMIN')) throw AppError.forbidden('Only an admin can grant admin access');
}
export async function setRoles(id, roles, { auth }) {
  const target = await repo.getUser(id);
  if (!target) throw AppError.notFound('User not found');
  const list = normaliseRoles(roles);
  await guards({ auth, target, roles: list, activating: target.is_active });
  return repo.setRoles(id, list, auth?.userId);
}
export async function setActive(id, active, { auth }) {
  const target = await repo.getUser(id);
  if (!target) throw AppError.notFound('User not found');
  if (!active) await guards({ auth, target, roles: target.roles, activating: false });
  await repo.patchUser(id, { is_active: active });
  if (!active) await repo.revokeAllRefresh(id);
  return repo.getUser(id);
}
export async function resetPassword(id, newPassword, { mustChange = true } = {}) {
  const target = await repo.getUser(id);
  if (!target) throw AppError.notFound('User not found');
  if (String(newPassword || '').length < 10) throw AppError.badRequest('Password must be at least 10 characters');
  await repo.setPassword(id, await hashPassword(newPassword), { mustChange });
  await repo.revokeAllRefresh(id);
  return { ok: true, mustChange, note: 'All sessions for this user were revoked' };
}
function normaliseRoles(roles) {
  const list = [...new Set([].concat(roles || []).filter(Boolean).map((r) => String(r).toUpperCase()))];
  if (!list.length) throw AppError.badRequest('Pick at least one role', { code: 'ROLE_REQUIRED' });
  const bad = list.filter((r) => !ROLES.includes(r));
  if (bad.length) throw AppError.badRequest(`Unknown role(s): ${bad.join(', ')}`, { code: 'ROLE_UNKNOWN', allowed: ROLES, labels: ROLE_LABEL });
  return list;
}
export const accessMatrix = async () => {
  const { PERMISSIONS, ROLE_PERMISSIONS, ROLE_LABEL, DENIES, SCOPE, can } = await import('../lib/shared/index.js');
  return {
    permissions: Object.entries(PERMISSIONS).map(([key, meta]) => ({ key, ...meta, roles: ROLES.filter((r) => can(key, { roles: [r], permissions: [] })) })),
    roles: ROLES.map((r) => ({ key: r, label: ROLE_LABEL[r], scope: SCOPE[r], granted: ROLE_PERMISSIONS[r], denied: (DENIES[r] || []).filter(Boolean) })),
  };
};
