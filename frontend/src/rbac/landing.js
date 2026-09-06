/**
 * Where a signed-in person lands, one route per role.
 *
 * It used to be "the first entry of the menu", which was correct but invisible: the menu order is a layout
 * decision, so a menu edit silently moved somebody's front door. The table below is the product's answer to
 * "what is my screen", and the first menu entry is only the fallback for a role nobody listed.
 *
 * Lives in its own module (not App.jsx) because the login page needs it too — importing it from App
 * made App ↔ LoginPage import each other.
 */
const LANDING_BY_ROLE = {
  EMPLOYEE: '/portal',                    // My Portal: their own payslips, attendance and leave in one screen
  HR_MANAGER: '/dashboard',               // the HR dashboard — headcount, attendance and cost, with the charts
  HR_PAYROLL_USER: '/payroll',            // the run they are meant to compute
  HR_PAYROLL_MANAGER: '/payroll',
  ADMIN: '/dashboard',                    // the overview, because an admin's job is to see everything
};
/** Exported so the ui-probe can assert the promise without clicking through a router. */
export function landingFor(user) {
  const roles = user?.roles?.length ? user.roles : [user?.role];
  for (const role of ['ADMIN', 'HR_PAYROLL_MANAGER', 'HR_PAYROLL_USER', 'HR_MANAGER', 'EMPLOYEE']) {
    const route = LANDING_BY_ROLE[role];
    if (route && roles?.includes(role) && menuHas(user, route)) return route;
  }
  const first = (user?.menus || [])[0];
  return first ? first.to : '/no-access';
}
/** Landing on a screen the role cannot open would bounce straight to NoAccess, so check the menu first. */
function menuHas(user, route) {
  return (user?.menus || []).some((m) => m.to === route);
}
