import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/useAuth.js';
import { AppShell } from './layout/AppShell.jsx';
import { Spinner } from './components/ui/Spinner.jsx';

// One route table, one screen per file. Anything a role cannot see is not in its nav (see src/rbac).
import { LoginPage } from './pages/LoginPage.jsx';
import { NoAccess } from './components/ui/Feedback.jsx';
import { SetPasswordPage } from './pages/auth/SetPasswordPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { EmployeesPage } from './pages/employees/EmployeesPage.jsx';
import { EmployeeDetailPage } from './pages/employees/EmployeeDetailPage.jsx';
import { DepartmentsPage } from './pages/org/DepartmentsPage.jsx';
import { WorkingSchedulesPage } from './pages/org/WorkingSchedulesPage.jsx';
import { HolidaysPage } from './pages/org/HolidaysPage.jsx';
import { ContractsPage } from './pages/org/ContractsPage.jsx';
import { AttendancePage } from './pages/attendance/AttendancePage.jsx';
import { TimeOffOverviewPage } from './pages/timeoff/TimeOffOverviewPage.jsx';
import { LeaveRequestsPage } from './pages/timeoff/LeaveRequestsPage.jsx';
import { LeaveTypesPage } from './pages/timeoff/LeaveTypesPage.jsx';
import { AllocationsPage } from './pages/timeoff/AllocationsPage.jsx';
import { MyTimeOffPage } from './pages/timeoff/MyTimeOffPage.jsx';
import { PayrunsPage } from './pages/payroll/PayrunsPage.jsx';
import { PayrunDetailPage } from './pages/payroll/PayrunDetailPage.jsx';
import { PayslipsPage } from './pages/payroll/PayslipsPage.jsx';
import { PayslipDetailPage } from './pages/payroll/PayslipDetailPage.jsx';
import { StructuresPage } from './pages/salary/StructuresPage.jsx';
import { RulesPage } from './pages/salary/RulesPage.jsx';
import { CompanyPage } from './pages/settings/CompanyPage.jsx';
import { UsersPage } from './pages/settings/UsersPage.jsx';
import { AccessPage } from './pages/settings/AccessPage.jsx';
import { SystemPage } from './pages/settings/SystemPage.jsx';
import { MyPortalPage } from './pages/portal/MyPortalPage.jsx';
import { MyPayslipsPage } from './pages/portal/MyPayslipsPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';

export default function App() {
  const { user, ready } = useAuth();

  if (!ready) return <Spinner fullscreen label="Loading your workspace" />;
  // An invitation arrives while the person is, by definition, not signed in yet — so this one path is
  // answered outside the guard. It only reads and writes a password for the token in its own query string.
  if (!user) return (
    <Routes>
      <Route path="/set-password" element={<SetPasswordPage />} />
      <Route path="*" element={<LoginPage />} />
    </Routes>
  );

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      {/* Also valid while signed in: an admin clicking their own test link should not be bounced to a login box. */}
      <Route path="/set-password" element={<SetPasswordPage />} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={landingFor(user)} replace />} />
        {/* Where a signed-in account with no visible screen at all is sent: a page that explains it, never a
            bounce back to /login (which would loop, because the login page sends signed-in users to the index). */}
        <Route path="/no-access" element={<NoAccess />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/payroll" element={<DashboardPage kind="payroll" />} />
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/employees/:id" element={<EmployeeDetailPage />} />
        <Route path="/departments" element={<DepartmentsPage />} />
        <Route path="/working-schedules" element={<WorkingSchedulesPage />} />
        <Route path="/holidays" element={<HolidaysPage />} />
        <Route path="/contracts" element={<ContractsPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/time-off" element={<TimeOffOverviewPage />} />
        <Route path="/time-off/requests" element={<LeaveRequestsPage />} />
        <Route path="/time-off/types" element={<LeaveTypesPage />} />
        <Route path="/time-off/allocations" element={<AllocationsPage />} />
        <Route path="/time-off/my-requests" element={<MyTimeOffPage />} />
        <Route path="/payruns" element={<PayrunsPage />} />
        <Route path="/payruns/:id" element={<PayrunDetailPage />} />
        <Route path="/payslips" element={<PayslipsPage />} />
        <Route path="/payslips/:id" element={<PayslipDetailPage />} />
        <Route path="/salary/structures" element={<StructuresPage />} />
        <Route path="/salary/rules" element={<RulesPage />} />
        <Route path="/company" element={<CompanyPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/access" element={<AccessPage />} />
        <Route path="/system" element={<SystemPage />} />
        <Route path="/portal" element={<MyPortalPage />} />
        <Route path="/portal/payslips" element={<MyPayslipsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

/** Where a role lands after signing in — mirrors the first menu item the backend sent. */
/**
 * Where a signed-in person lands, one route per role.
 *
 * It used to be "the first entry of the menu", which was correct but invisible: the menu order is a layout
 * decision, so a menu edit silently moved somebody's front door. The table below is the product's answer to
 * "what is my screen", and the first menu entry is only the fallback for a role nobody listed.
 */
const LANDING_BY_ROLE = {
  EMPLOYEE: '/portal',                    // My Portal: their own payslips, attendance and leave in one screen
  HR_MANAGER: '/employees',               // the list they work through all day
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
