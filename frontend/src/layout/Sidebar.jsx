import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';
import { visibleNav } from '../rbac/permissions.js';
import { APP_NAME } from '../config/app.js';
import { ThemeToggle } from './ThemeToggle.jsx';

/**
 * The menu is not written here: it comes from `user.menus`, which the backend derives from
 * ROLE_NAV + the user's permissions. Add a role to a menu there and it appears here.
 */
export function Sidebar() {
  const { user } = useAuth();
  const [open, setOpen] = useState(() => new Set((user?.menus || []).map((m) => m.key)));
  const menus = visibleNav(user);
  const toggle = (key) => setOpen((s) => { const next = new Set(s); next.has(key) ? next.delete(key) : next.add(key); return next; });

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-ink-900/80 lg:flex">
      <div className="flex items-center gap-2 border-b border-line px-4 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">P3</div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-100">{APP_NAME}</p>
          <p className="truncate text-[11px] text-slate-500">HR & Payroll</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {menus.map((item) => (
          <div key={item.key} className="mb-0.5">
            <div className="flex items-center">
              <NavLink to={item.to}
                      className={({ isActive }) => 'flex-1 rounded-lg px-3 py-2 text-sm ' + (isActive ? 'bg-ink-700 text-slate-50' : 'text-slate-400 hover:bg-ink-800 hover:text-slate-200')}>
                {item.label}
              </NavLink>
              {item.children?.length > 0 && (
                <button className="px-2 text-slate-500 hover:text-slate-300" onClick={() => toggle(item.key)} aria-label="Toggle section">
                  {open.has(item.key) ? '▾' : '▸'}
                </button>
              )}
            </div>
            {item.children?.length > 0 && open.has(item.key) && (
              <div className="mt-0.5 space-y-0.5 pl-3">
                {item.children.map((child) => (
                  <NavLink key={child.to} to={child.to} end
                           className={({ isActive }) => 'block rounded-md px-3 py-1.5 text-[13px] ' + (isActive ? 'bg-brand-600/15 text-brand-200' : 'text-slate-500 hover:bg-ink-800 hover:text-slate-300')}>
                    {child.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="border-t border-line px-4 py-2.5">
        <ThemeToggle />
      </div>
    </aside>
  );
}

/** Small screens get a horizontal scroll strip instead of the sidebar. */
export function MobileNav() {
  const { user } = useAuth();
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 lg:hidden">
      {visibleNav(user).map((item) => (
        <NavLink key={item.to} to={item.to} className="whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-slate-400 hover:bg-ink-800">
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}
