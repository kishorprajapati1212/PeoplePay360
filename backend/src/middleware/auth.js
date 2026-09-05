import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { AppError } from '../lib/shared/index.js';
import { redis } from '../queue/connection.js';

import { one, query } from '../db/pool.js';

/**
 * Access token (12 h, sent by the SPA in Authorization) + rotating refresh token (httpOnly cookie,
 * stored hashed in Postgres so it can be revoked). `verify` also accepts a download-scoped token in
 * ?t= so a browser can stream a PDF without an Authorization header.
 */
// `sub` stays in the payload; passing it again as an option makes jsonwebtoken 9 throw.
export const sign = (payload, opts = {}) => jwt.sign(payload, config.jwt.secret, {
  expiresIn: opts.ttl || config.jwt.accessTtl, issuer: config.jwt.issuer,
  ...(opts.audience ? { audience: opts.audience } : {}),
});
export const hashPassword = (plain) => bcrypt.hash(plain, config.bcrypt.rounds);
export const comparePassword = (plain, hash) => bcrypt.compare(plain, hash || '');
export const tokenFingerprint = (t) => t.slice(-12);

/**
 * Roles are read from the DB on every request (not baked into the token), so revoking an admin role
 * takes effect immediately. `token_version` in the JWT then handles "sign me out everywhere".
 */
export async function loadAuth(userId, tv) {
  const u = await one(`select u.id, u.work_email, u.name as display_name, u.role as primary_role, u.is_active,
                              u.must_change_pw as must_change_password, u.token_version, e.id as employee_id,
                              coalesce(array_agg(distinct g.role::text) filter (where g.role is not null), '{}') as grants
                       from users u
                       left join user_role_grants g on g.user_id = u.id
                       left join employees e on e.user_id = u.id
                       where u.id = $1 group by u.id, e.id`, [userId]);
  if (!u) throw AppError.unauthorized('Account no longer exists');
  if (!u.is_active) throw new AppError('ACCOUNT_DISABLED', 'This account has been deactivated. Contact an administrator.', { status: 403 });
  if (tv !== undefined && Number(tv) !== Number(u.token_version)) throw new AppError('TOKEN_REVOKED', 'Session revoked — sign in again', { status: 401 });
  return { ...u, roles: [...new Set([u.primary_role, ...u.grants].filter(Boolean))] };
}
export function authenticate({ required = true } = {}) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      let token = header.startsWith('Bearer ') ? header.slice(7) : null;
      let scope = null;
      if (!token && req.query.t) { token = String(req.query.t); scope = 'download'; }
      if (!token) { if (required) throw AppError.unauthorized(); req.auth = null; return next(); }
      const decoded = jwt.verify(token, config.jwt.secret, { issuer: config.jwt.issuer, ...(scope ? { audience: scope } : {}) });
      if (scope && decoded.aud !== 'download') throw AppError.unauthorized('This link cannot be used for API calls');
      const user = await loadAuth(decoded.sub, decoded.tv);
      const { permissionsFor, scopeFor } = await import('../lib/shared/index.js');
      const roles = user.roles || [];
      const perms = permissionsFor(roles);
      req.auth = { userId: user.id, email: user.work_email, name: user.display_name, roles,
                   permissions: perms.list, all: perms.all, employeeId: user.employee_id, scope: scopeFor(roles),
                   mustChangePassword: user.must_change_password, tokenVersion: user.token_version,
                   downloadOnly: !!scope, aud: scope };
      next();
    } catch (e) {
      if (e instanceof AppError) return next(e);          // do not re-wrap our own 401/403
      const msg = /expired/i.test(e.message) ? 'Session expired — sign in again' : 'Invalid session';
      next(new AppError(e instanceof jwt.JsonWebTokenError ? 'INVALID_TOKEN' : 'TOKEN_EXPIRED', msg, { status: 401 }));
    }
  };
}
/** Brute-force guard: Redis counter per email+ip, no extra dependency. */
export async function guardLogin({ email, ip }) {
  const key = `login:${email.toLowerCase()}:${ip}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, config.login.windowSec);
  if (n > config.login.maxAttempts) {
    throw new AppError('TOO_MANY_ATTEMPTS', `Too many failed sign-ins. Try again in ${Math.ceil((await redis.ttl(key)) / 60) || 1} minute(s).`, { status: 429 });
  }
}
export const clearLoginGuard = ({ email, ip }) => redis.del(`login:${email.toLowerCase()}:${ip}`).catch(() => {});
