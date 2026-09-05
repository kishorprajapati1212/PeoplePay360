import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';
import { NoAccess } from '../components/ui/Feedback.jsx';
import { useAuth } from '../auth/useAuth.js';
import { can, PAGE_PERMISSIONS } from '../rbac/permissions.js';

/** The frame from the mockup: fixed sidebar on the left, page title bar on top, content below. */
export function AppShell() {
  const { user } = useAuth();
  const location = useLocation();
  const perm = PAGE_PERMISSIONS[matchRoute(location.pathname)];
  const allowed = !perm || can(user, perm);

  return (
    <div className="flex min-h-screen bg-ink-950">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-5 sm:px-6">
          {allowed
            ? <Outlet />
            : <NoAccess permission={perm} path={location.pathname} />}
        </main>
      </div>
    </div>
  );
}

/** Detail routes inherit the permission of their list page (/employees/123 → /employees). */
function matchRoute(pathname) {
  if (PAGE_PERMISSIONS[pathname]) return pathname;
  const parts = pathname.split('/').filter(Boolean);
  while (parts.length) {
    const candidate = '/' + parts.join('/');
    if (PAGE_PERMISSIONS[candidate]) return candidate;
    parts.pop();
  }
  return pathname;
}
