import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';
import { initials, human } from '../utils/format.js';
import { MobileNav } from './Sidebar.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';

/** Breadcrumb, role chips, theme switch and the account menu. */
export function Topbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);   // the account menu opens on click — hover-only menus are unreachable from a keyboard or a phone

  const crumbs = [{ label: 'Home', to: '/' }].concat(
    location.pathname.split('/').filter(Boolean).map((part, i, all) => ({
      label: human(decodeURIComponent(part)),
      to: '/' + all.slice(0, i + 1).join('/'),
      isId: /^[0-9a-f-]{36}$/i.test(part),
    })),
  );

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ink-950/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-3 sm:px-6">
        <nav className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
          {crumbs.map((c, i) => (
            <span key={c.to + i} className="flex items-center gap-1.5">
              {i > 0 && <span>/</span>}
              {c.isId ? <span className="text-slate-600">#{c.label}</span>
                : <button className={i === crumbs.length - 1 ? 'text-slate-200' : 'hover:text-slate-300'} onClick={() => navigate(c.to)}>{c.label}</button>}
            </span>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle compact />
          <div className="hidden items-center gap-1 sm:flex">
            {(user?.roles || []).map((role) => (
              <span key={role} className="chip border-brand-500/30 bg-brand-500/10 text-brand-200">{human(role)}</span>
            ))}
            {user?.scope === 'own' && <span className="chip border-amber-500/30 bg-amber-500/10 text-amber-200">own records</span>}
          </div>
          <div className="relative">
            <button aria-expanded={menu} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-xs text-slate-300 hover:bg-ink-800"
                    onClick={() => setMenu((v) => !v)}>
              <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">{initials(user?.name)}</span>
              <span className="hidden max-w-32 truncate sm:inline">{user?.name}</span>
              <span className="text-slate-500">▾</span>
            </button>
            {menu && <button className="fixed inset-0 z-20 cursor-default" aria-label="Close menu" onClick={() => setMenu(false)} />}
            <div className={'absolute right-0 top-full z-30 w-56 pt-1 transition ' + (menu ? 'visible opacity-100' : 'invisible opacity-0')}>
              <div className="panel p-1 text-xs">
                <div className="px-3 py-2">
                  <p className="font-medium text-slate-200">{user?.name}</p>
                  <p className="truncate text-slate-500">{user?.workEmail}</p>
                </div>
                <button className="w-full rounded-md px-3 py-2 text-left text-slate-300 hover:bg-ink-800" onClick={() => { setMenu(false); navigate('/portal'); }}>My portal</button>
                <button className="w-full rounded-md px-3 py-2 text-left text-red-300 hover:bg-red-950/40" onClick={logout}>Sign out</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <MobileNav />

    </header>
  );
}
