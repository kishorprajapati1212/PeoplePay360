import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission, requireAnyPermission, forbidDownloadToken } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { enforceScope } from '../middleware/scope.js';
import { idempotent } from '../middleware/idempotency.js';
import { audit } from '../middleware/audit.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { wrap } from '../middleware/wrap.js';

/**
 * One declarative table per domain, one binder here. Every route gets auth → permission → row scope →
 * validation → audit → handler in the same order, so "what can this role do" is answered by reading
 * src/lib/shared/permissions.js, not by hunting through handlers.
 *
 * entry: { m, p, perm?, any?, scope?, idem?, read?, rate?, download?, params?, query?, body?, h }
 *
 * In plain Express terms, one entry is this:
 *   router.post('/payruns',
 *     authenticate, requirePermission('payroll:payrun_create'), enforceScope(),
 *     validate(wizardStep2, 'body'), audit('payrun.create'), idempotent(), handler);
 * The table only exists so those six lines are written once instead of 151 times, and so the order of the
 * middlewares — which is what makes a 403 beat a 400 — cannot drift between files.
 */
export function bind(table, { prefix = '' } = {}) {
  const r = express.Router({ mergeParams: true });
  for (const e of table) {
    const mw = [(_req, _res, next) => { _req.valid = { params: {}, query: {}, body: {}, ...(_req.valid || {}) }; next(); }];
    if (!e.public) {
      mw.push(authenticate());
      // A download route may be opened by a five-minute signed link (a plain <a> cannot send a header),
      // so it is the one place that does not demand the usual bearer token.
      if (!e.download) mw.push(forbidDownloadToken);
    }
    if (e.perm) mw.push(requirePermission(e.perm));
    if (e.any) mw.push(requireAnyPermission(...e.any));
    if (e.scope) mw.push(enforceScope(typeof e.scope === 'object' ? e.scope : {}));
    if (e.rate) mw.push(rateLimit(typeof e.rate === 'object' ? e.rate : {}));
    if (e.params) mw.push(validate(e.params, 'params'));
    if (e.query) mw.push(validate(e.query, 'query'));
    if (e.body) mw.push(validate(e.body, 'body'));
    if (e.idem) mw.push(idempotent());
    if (e.audit !== false) mw.push(audit({ read: !!e.read }));
    mw.push(wrap(e.h));
    r[e.m](e.p, ...mw);
  }
  return r;
}
export const get = (p, o) => ({ m: 'get', p, ...o });
export const post = (p, o) => ({ m: 'post', p, ...o });
export const patch = (p, o) => ({ m: 'patch', p, ...o });
export const del = (p, o) => ({ m: 'delete', p, ...o });
