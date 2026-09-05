import { AppError } from '../lib/shared/index.js';

/**
 * Row-level access. `own` scope (plain employees) is rewritten into an employee filter here, once,
 * instead of being re-checked in every controller — that is how an employee ends up reading someone
 * else's payslip in most home-grown HR apps.
 */
export function enforceScope({ field = 'employeeId', onSelfOnly = true } = {}) {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) return next(AppError.unauthorized());
    if (auth.scope === 'company') { req.scope = { all: true }; return next(); }
    if (auth.scope === 'none') return next(new AppError('NO_PROFILE', 'Your account is not linked to an employee record yet', { status: 403 }));
    if (!auth.employeeId) return next(new AppError('NO_PROFILE', 'Your account is not linked to an employee record', { status: 403 }));
    req.scope = { all: false, employeeId: auth.employeeId, field };
    const wanted = req.params.employeeId ?? req.query.employeeId ?? req.body?.[field];
    if (wanted && String(wanted) !== String(auth.employeeId) && onSelfOnly) {
      return next(new AppError('FORBOWNED', 'You can only view your own records', { status: 403 }));
    }
    next();
  };
}
