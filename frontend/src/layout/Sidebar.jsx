import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';
import { visibleNav } from '../rbac/permissions.js';
import { APP_NAME } from '../config/app.js';
import { ThemeToggle } from './ThemeToggle.jsx';

/* One icon per menu key — the backend owns the labels and the order (ROLE_NAV), the icon is ours.
   18px, 1.7 stroke, no fill: they sit next to 13px labels and read at a glance. */
const ICONS = {
  portal: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></svg>
  ),
  attendance: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>
  ),
  timeoff: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /><path d="M9.5 15.5h5" /></svg>
  ),
  payslips: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z" /><path d="M9 7.5h6M9 11.5h6M9 15.5h3" /></svg>
  ),
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="5" rx="2" /><rect x="13" y="10" width="8" height="11" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /></svg>
  ),
  employees: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M18 14.6c2 .7 3.2 2.2 3.6 4.4" /></svg>
  ),
  contracts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2.5H6.5A1.5 1.5 0 0 0 5 4v16a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 20V7.5z" /><path d="M14 2.5V7.5H19" /><path d="M9 12h6M9 16h4" /></svg>
  ),
  payroll: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6" width="19" height="13" rx="3" /><path d="M2.5 10h19" /><path d="M6 15h4" /></svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="8" cy="18" r="2" fill="currentColor" stroke="none" /></svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="8" r="3.5" /><path d="M4 20c.8-3.4 3.4-5 6.5-5 1.2 0 2.3.2 3.2.7" /><path d="M17.5 13.5v5M15 16h5" /></svg>
  ),
};
const iconFor = (key, to = '') => ICONS[key] || (to.includes('payslip') ? ICONS.payslips : ICONS.dashboard);

/**
 * The menu is not written here: it comes from `user.menus`, which the backend derives from
 * ROLE_NAV + the user's permissions. Add a role to a menu there and it appears here.
 *
 * Active state is computed here instead of NavLink's, because NavLink calls a parent with children
 * active for EVERY URL under it — so opening "Payruns" lit up both "Payruns" and its parent "Payroll"
 * (two highlights), and a child that shares its parent's path (`/employees` → Directory) lit both
 * copies of the same destination. The rule below is stricter: exactly one row is active at a time —
 * the child whose path matches, or the parent only when no child of its group matches.
 */
const matches = (to, pathname) => !!to && (pathname === to || pathname.startsWith(to + '/'));
/** The one route among ALL menu entries (parents and children) that the URL is really on: the LONGEST
 *  matching path wins. Without this, "/portal" stayed lit next to "/portal/payslips" (its own child
 *  route elsewhere in the menu), and payslip pages lit two rows at once. */
const bestMatch = (menus, pathname) =>
  menus.flatMap((m) => [m.to, ...(m.children || []).map((c) => c.to)])
    .filter(Boolean)
    .filter((t) => matches(t, pathname))
    .sort((a, b) => b.length - a.length)[0] || null;
export function Sidebar() {
  const { user } = useAuth();
  const [open, setOpen] = useState(() => new Set((user?.menus || []).map((m) => m.key)));
  const menus = visibleNav(user);
  const { pathname } = useLocation();
  const best = bestMatch(menus, pathname);
  const isChildActive = (item) => (item.children || []).some((c) => (c.to === item.to ? pathname === c.to : matches(c.to, pathname)));
  const toggle = (key) => setOpen((s) => { const next = new Set(s); next.has(key) ? next.delete(key) : next.add(key); return next; });

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-ink-900/60 lg:flex">
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-bold text-white shadow-lg"
             style={{ backgroundImage: 'linear-gradient(135deg, rgb(var(--brand-500)), rgb(var(--brand-700)))', boxShadow: '0 8px 20px -8px rgb(var(--brand-500) / 0.6)' }}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 9V7a5 5 0 0 0-9.6-2M5 11v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7z" /></svg>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-slate-100">{APP_NAME}</p>
          <p className="truncate text-[11px] text-slate-500">HR & Payroll suite</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {menus.map((item) => {
          const childActive = isChildActive(item);
          // A parent is highlighted only as the group's landing page: when one of its children matches
          // (including a child that shares the parent's own path), the child takes the highlight —
          // so exactly one row is ever lit.
          const active = item.to === best && matches(item.to, pathname) && !childActive;
          // A child that shares its parent's path is the group's LANDING page ("Dashboard" on
          // /time-off, "Directory" on /employees): it lights up only on that exact URL, never for its
          // siblings' sub-pages — otherwise /time-off/requests lit both Dashboard and Requests.
          const landing = (c) => c.to === item.to;
          return (
          <div key={item.key}>
            <div className="flex items-center">
              <NavLink to={item.to}
                      className={'group flex flex-1 items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors '
                        + (active ? 'bg-brand-500/15 text-brand-200' : 'text-slate-400 hover:bg-ink-800/80 hover:text-slate-200')}>
                <span className={'grid h-[18px] w-[18px] shrink-0 place-items-center transition-colors ' + (active ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-300')}>
                  {iconFor(item.key, item.to)}
                </span>
                <span className="truncate">{item.label}</span>
              </NavLink>
              {item.children?.length > 0 && (
                <button className="ml-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-ink-800 hover:text-slate-300" onClick={() => toggle(item.key)} aria-label="Toggle section">
                  <svg viewBox="0 0 24 24" className={'h-3.5 w-3.5 transition-transform ' + (open.has(item.key) ? 'rotate-90' : '')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
                </button>
              )}
            </div>
            {item.children?.length > 0 && open.has(item.key) && (
              <div className="mt-0.5 mb-1 space-y-0.5 border-l border-line/70 pl-4 ml-6">
                {item.children.map((child) => (
                  <NavLink key={child.to} to={child.to}
                           className={'block rounded-lg px-2.5 py-1.5 text-xs transition-colors '
                             + ((landing(child) ? pathname === child.to : matches(child.to, pathname)) && child.to === best
                               ? 'bg-brand-500/15 font-medium text-brand-200' : 'text-slate-500 hover:bg-ink-800/80 hover:text-slate-300')}>
                    {child.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        ); })}
      </nav>

      <div className="border-t border-line px-4 py-3">
        <ThemeToggle />
      </div>
    </aside>
  );
}

/** Small screens get a horizontal scroll strip instead of the sidebar. */
export function MobileNav() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const menus = visibleNav(user);
  const best = bestMatch(menus, pathname);
  return (
    <div className="flex gap-1 overflow-x-auto px-3 py-2 lg:hidden">
      {menus.map((item) => (
        <NavLink key={item.to} to={item.to}
                 className={'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors '
                   + (item.to === best && !(item.children || []).some((c) => (c.to === item.to ? pathname === c.to : matches(c.to, pathname))) ? 'bg-brand-500/20 text-brand-200' : 'text-slate-400 hover:bg-ink-800 hover:text-slate-200')}>
          <span className="h-3.5 w-3.5">{iconFor(item.key, item.to)}</span>
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}
