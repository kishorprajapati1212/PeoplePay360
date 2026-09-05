import { useAuth } from '../auth/useAuth.js';
import { can } from './permissions.js';

/**
 * <Can perm="payroll:compute">…</Can>            renders children only when allowed
 * <Can perm="payroll:compute" fallback={null}>   hides a button (default: renders nothing)
 */
export function Can({ perm, anyOf = false, children, fallback = null }) {
  const { user } = useAuth();
  return can(user, perm, { anyOf }) ? children : fallback;
}

/** Hook version for cases where you need the boolean (disabled buttons, greyed table cells). */
export function useCan(perm, options) {
  const { user } = useAuth();
  return can(user, perm, options);
}
