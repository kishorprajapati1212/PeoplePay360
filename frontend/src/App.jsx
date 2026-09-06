import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/useAuth.js';
import { AppShell } from './layout/AppShell.jsx';
import { Spinner } from './components/ui/Spinner.jsx';
import { landingFor } from './rbac/landing.js';

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
  const navigate = useNavigate();

  /* Session-change guard (the "second user lands on the first user's screen" fix).
     While signed in, the router shows whatever path is in the address bar — which is right for a
     refresh or a shared deep link, and wrong for a sign-in: the previous account's URL is still
     sitting there, so an employee who followed an admin got the admin's last screen (a payrun, say)
     and a face full of "no access". So the first hydration keeps the URL (deep links must work),
     and every identity change after that goes where the new session belongs: a user lands on their
     own front door, a logout lands on /login — never on the last user's page. */
  const prevIdentity = useRef(undefined);
  useEffect(() => {
    if (!ready) return;
    const identity = user?.id ?? null;
    if (prevIdentity.current === undefined) { prevIdentity.current = identity; return; }   // first paint: keep deep links
    if (prevIdentity.current === identity) return;
    prevIdentity.current = identity;
    navigate(identity ? landingFor(user) : '/login', { replace: true });
  }, [user, ready, navigate]);

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

/** Re-exported from its own module so the ui-probe keeps importing it from here. */
export { landingFor } from './rbac/landing.js';
