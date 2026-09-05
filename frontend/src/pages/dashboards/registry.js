import { useAuth } from '../../auth/useAuth.js';
import { can } from '../../rbac/permissions.js';
import { OverviewDashboard } from './OverviewDashboard.jsx';
import { EmployeeDashboard } from './EmployeeDashboard.jsx';

/**
 * The dashboards, as data.
 *
 * Before this there was one component with a `mode` prop and two `mode === 'x'` conditions inside it, so a
 * third dashboard meant editing that component — and forgetting one of the two conditions produced a screen
 * with the wrong title and no error. A dashboard is now one entry in this list: the predicate decides who
 * gets it, `Component` decides what it shows. Adding a payroll-month or a manager-only view is one object
 * here and a new component file; nothing else has to know it exists.
 *
 * Order matters — the first match wins, most specific first.
 */
export const DASHBOARD_KINDS = [
  {
    key: 'payroll',
    when: (has) => has('payroll:payrun_create'),
    Component: OverviewDashboard,
    title: 'Payroll dashboard',
    subtitle: 'The month as a run: what is computed, what is waiting for a signature, what still has no payslip.',
    showPayrunCta: true,
  },
  {
    key: 'hr',
    when: (has) => has('employee:read'),
    Component: OverviewDashboard,
    title: 'HR dashboard',
    subtitle: 'Headcount, attendance and cost for the period you pick below.',
    showPayrunCta: false,
  },
  {
    // Everyone has this one, so the list can never end in "no dashboard for you": an employee who signs in
    // for the first time gets their own month rather than an empty HR screen.
    key: 'me',
    when: () => true,
    Component: EmployeeDashboard,
    title: 'My month',
    subtitle: 'Your hours, your leave balance and your last payslip — the same records payroll computed from.',
  },
];

/** Which dashboard this user gets: from the permissions the API sent, never from a hard-coded role list. */
export function dashboardKindFor(user) {
  const has = (perm) => can(user, perm);
  return (DASHBOARD_KINDS.find((k) => k.when(has)) || DASHBOARD_KINDS[DASHBOARD_KINDS.length - 1]).key;
}

export function dashboardEntry(kind) {
  return DASHBOARD_KINDS.find((k) => k.key === kind) || null;
}

/** Used by the chooser below, and by anything that wants to link to a dashboard by key. */
export function useDashboardKind() {
  const { user } = useAuth();
  return dashboardKindFor(user);
}
