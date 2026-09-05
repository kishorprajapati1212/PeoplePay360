import crypto from 'node:crypto';
import { AppError } from '../lib/shared/index.js';
import { config } from '../config.js';
import { sign, comparePassword, hashPassword, guardLogin, clearLoginGuard } from '../middleware/auth.js';
import * as userRepo from '../repositories/user.repo.js';
import { transaction } from '../db/tx.js';
import { logger } from '../logger.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newRefresh = () => crypto.randomBytes(48).toString('base64url');

export async function login({ email, work_email, password }, { ip, userAgent }) {
  const mail = String(email || work_email || '').trim().toLowerCase();
  try { await guardLogin({ email: mail, ip }); } catch (e) { if (e instanceof AppError) throw e; }
  const u = await userRepo.getForLogin(mail);
  if (!u || !(await comparePassword(password, u.password_hash))) {
    logger.warn({ email }, 'failed login');
    throw new AppError('BAD_CREDENTIALS', 'Work email or password is incorrect', { status: 401 });
  }
  if (!u.is_active) throw new AppError('ACCOUNT_DISABLED', 'This account is deactivated. Contact an administrator.', { status: 403 });
  await clearLoginGuard({ email: mail, ip });
  await userRepo.touchLogin(u.id);
  const familyId = crypto.randomUUID();
  const refresh = newRefresh();
  await userRepo.storeRefresh({ userId: u.id, tokenHash: sha(refresh), familyId,
    expiresAt: new Date(Date.now() + config.jwt.refreshTtlDays * 86400000), userAgent, ip });
  return tokensFor(u, refresh);
}
function tokensFor(u, refresh) {
  const access = sign({ sub: u.id, tv: u.token_version, email: u.work_email, name: u.name },
    { ttl: u.must_change_pw ? '10m' : config.jwt.accessTtl });
  return { accessToken: access, refreshToken: refresh, expiresIn: config.jwt.accessTtl,
    user: { id: u.id, name: u.name, workEmail: u.work_email, roles: u.roles, employeeId: u.employee_id || null,
            mustChangePassword: !!u.must_change_pw } };
}
export async function refresh({ refreshToken }) {
  if (!refreshToken) throw AppError.unauthorized('No session cookie');
  const row = await userRepo.takeRefresh(sha(refreshToken));
  if (!row) {
    // A refresh token only ever works once; a second use of the same value means it leaked, so we
    // burn the whole family (every session derived from that login) instead of silently reissuing.
    throw new AppError('REFRESH_REUSE', 'Session expired or was used twice — sign in again', { status: 401 });
  }
  const u = await userRepo.getUser(row.user_id);
  if (!u || !u.is_active) throw AppError.unauthorized('Account is not active');
  const fresh = newRefresh();
  await transaction(async () => {
    await userRepo.revokeRefreshFamily(row.family_id);
    await userRepo.storeRefresh({ userId: u.id, tokenHash: sha(fresh), familyId: row.family_id,
      expiresAt: new Date(Date.now() + config.jwt.refreshTtlDays * 86400000), userAgent: row.user_agent, ip: row.ip });
  });
  return tokensFor(u, fresh);
}
export async function logout({ refreshToken, userId, all }) {
  if (all) await userRepo.revokeAllRefresh(userId);
  else if (refreshToken) { const row = await userRepo.takeRefresh(sha(refreshToken)); if (row) await userRepo.revokeRefreshFamily(row.family_id); }
  return { ok: true };
}
/** The SPA calls this on boot: it decides the sidebar, the buttons and the portal vs HR screens. */
export async function me(userId) {
  const { permissionsFor, navFor, scopeFor, ROLE_LABEL } = await import('../lib/shared/index.js');
  const u = await userRepo.getUser(userId);
  if (!u) throw AppError.unauthorized();
  const roles = u.roles || [];
  const perms = permissionsFor(roles);
  const employee = u.employee_id ? await (await import('../repositories/employee.repo.js')).getEmployee(u.employee_id) : null;
  return {
    id: u.id, name: u.name, workEmail: u.work_email, roles, roleLabels: roles.map((r) => ROLE_LABEL[r] || r),
    is_active: u.is_active, mustChangePassword: !!u.must_change_pw, employeeId: u.employee_id || null,
    permissions: perms.all ? Object.keys((await import('../lib/shared/index.js')).PERMISSIONS) : perms.list,
    scope: scopeFor(roles), menus: navFor(roles),
    employee: employee ? { id: employee.id, code: employee.employee_code, name: employee.name, department: employee.department,
                           job_position: employee.job_position, status: employee.status, date_of_joining: employee.date_of_joining } : null,
  };
}
export async function changePassword({ userId, currentPassword, newPassword, current_password, new_password }) {
  const current = currentPassword ?? current_password; const next = newPassword ?? new_password;
  const row = await (await import('../db/pool.js')).query(`select password_hash from users where id = $1`, [userId]).then((r) => r.rows[0]);
  if (!row || !(await comparePassword(current, row.password_hash))) throw new AppError('BAD_PASSWORD', 'Current password is incorrect', { status: 401 });
  if (String(next || '').length < 10) throw AppError.badRequest('Use at least 10 characters for the new password');
  await userRepo.setPassword(userId, await hashPassword(next), { mustChange: false });
  await userRepo.revokeAllRefresh(userId);
  return { ok: true, note: 'All sessions revoked — sign in again everywhere' };
}
/** Minted only for the payslip PDF route, valid 5 minutes, so a link can't be reused for API calls. */
export function downloadToken(userId, payslipId) {
  return sign({ sub: userId, for: payslipId, scope: 'payslip:download' }, { ttl: '5m', audience: 'download' });
}
