import { AppError, can } from '../lib/shared/index.js';

/**
 * The single enforcement point. `requirePermission('payroll:compute')` reads the map in
 * src/lib/shared/permissions.js — so the API, the sidebar and the tests can never disagree.
 */
export function requirePermission(...needed) {
  const perms = needed.flat().filter(Boolean);
  return (req, res, next) => {
    const auth = req.auth;
    if (!auth) return next(AppError.unauthorized());
    if (perms.length && !perms.every((p) => can(p, { roles: auth.roles, permissions: auth.permissions }))) {
      return next(new AppError('FORBIDDEN', `Your roles (${auth.roles.join(', ') || 'none'}) do not allow “${perms.join(' + ')}”`, {
        status: 403, details: { required: perms, roles: auth.roles },
      }));
    }
    next();
  };
}
/** Either-of semantics, for screens two different roles reach by different paths. */
export function requireAnyPermission(...any) {
  const perms = [...new Set(any.flat().filter(Boolean))];
  return (req, res, next) => {
    const auth = req.auth;
    if (!auth) return next(AppError.unauthorized());
    if (!perms.length || perms.some((p) => can(p, { roles: auth.roles, permissions: auth.permissions }))) return next();
    return next(new AppError('FORBIDDEN', `Needs at least one of: ${perms.join(', ')}`, { status: 403, details: { anyOf: perms, roles: auth.roles } }));
  };
}
/** Download tokens are minted for exactly one payslip and cannot be reused on other routes. */
export const forbidDownloadToken = (req, res, next) =>
  req.auth?.downloadOnly ? next(new AppError('SCOPE_TOKEN', 'This link is only valid for the file it points at', { status: 403 })) : next();
