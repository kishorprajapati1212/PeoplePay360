import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';
import { auth } from '../api/endpoints.js';
import { useAction } from '../hooks/useApi.js';
import { useToast } from '../components/ui/Toast.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Field, Input } from '../components/ui/controls.jsx';
import { initials, human } from '../utils/format.js';
import { MobileNav } from './Sidebar.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';

const flatMenus = (menus = []) => menus.flatMap((m) => [m.to, ...(m.children || []).map((c) => c.to)].filter(Boolean));

/** Breadcrumb, role chips, theme switch and the account menu. */
export function Topbar() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const { run, busy } = useAction();
  const [pw, setPw] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);   // the account menu opens on click — hover-only menus are unreachable from a keyboard or a phone
  // A staff role has no /portal screen at all, so the menu must not offer it — the route would answer
  // "You do not have access" and read like a broken account.
  const maySeePortal = flatMenus(user?.menus).includes('/portal');

  const crumbs = [{ label: 'Home', to: '/' }].concat(
    location.pathname.split('/').filter(Boolean).map((part, i, all) => ({
      label: human(decodeURIComponent(part)),
      to: '/' + all.slice(0, i + 1).join('/'),
      isId: /^[0-9a-f-]{36}$/i.test(part),
    })),
  );

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ink-950/75 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-3 sm:px-6">
        <nav className="flex min-w-0 items-center gap-1 text-xs text-slate-500">
          {crumbs.map((c, i) => (
            <span key={c.to + i} className="flex items-center gap-1">
              {i > 0 && <svg viewBox="0 0 24 24" className="h-3 w-3 text-slate-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>}
              {c.isId ? <span className="text-slate-600">#{c.label}</span>
                : <button className={i === crumbs.length - 1 ? 'font-medium text-slate-200' : 'transition-colors hover:text-slate-300'} onClick={() => navigate(c.to)}>{c.label}</button>}
            </span>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <ThemeToggle compact />
          <div className="hidden items-center gap-1.5 sm:flex">
            {(user?.roles || []).slice(0, 2).map((role) => (
              <span key={role} className="chip border-brand-500/25 bg-brand-500/10 text-brand-200">{human(role)}</span>
            ))}
            {user?.scope === 'own' && <span className="chip border-amber-500/30 bg-amber-500/10 text-amber-200">own records</span>}
          </div>
          <div className="relative">
            <button aria-expanded={menu} className="flex items-center gap-2 rounded-xl border border-line bg-ink-900/60 py-1.5 pl-1.5 pr-2.5 text-xs text-slate-300 transition-colors hover:bg-ink-800 hover:text-slate-100"
                    onClick={() => setMenu((v) => !v)}>
              <span className="grid h-7 w-7 place-items-center rounded-lg text-[11px] font-semibold text-white"
                    style={{ backgroundImage: 'linear-gradient(135deg, rgb(var(--brand-500)), rgb(var(--brand-700)))' }}>{initials(user?.name)}</span>
              <span className="hidden max-w-32 truncate sm:inline">{user?.name}</span>
              <svg viewBox="0 0 24 24" className={'h-3.5 w-3.5 text-slate-500 transition-transform ' + (menu ? 'rotate-180' : '')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {menu && <button className="fixed inset-0 z-20 cursor-default" aria-label="Close menu" onClick={() => setMenu(false)} />}
            <div className={'absolute right-0 top-full z-30 w-60 pt-2 transition ' + (menu ? 'visible opacity-100' : 'invisible opacity-0')}>
              <div className="panel p-1.5 text-xs" style={{ animation: 'rise-in .14s ease-out' }}>
                <div className="rounded-xl bg-ink-850/60 px-3 py-2.5">
                  <p className="font-semibold text-slate-100">{user?.name}</p>
                  <p className="mt-0.5 truncate text-slate-500">{user?.workEmail}</p>
                </div>
                <div className="mt-1 space-y-0.5">
                  {maySeePortal && <MenuButton onClick={() => { setMenu(false); navigate('/portal'); }} icon={<svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>}>My portal</MenuButton>}
                  <MenuButton onClick={() => { setMenu(false); setPw({ current: '', next: '', again: '' }); }} icon={<svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10" width="16" height="10" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v2.5" /></svg>}>Change password</MenuButton>
                </div>
                <div className="mt-1 border-t border-line pt-1">
                  <MenuButton danger onClick={logout} icon={<svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>}>Sign out</MenuButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <MobileNav />
      {user?.mustChangePassword && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-200">
          You are still on the password your administrator handed over.{' '}
          <button className="underline" onClick={() => setPw({ current: '', next: '', again: '' })}>Change it now</button> — until you do, sign-ins are limited to a 10-minute session.
        </div>
      )}

      <Modal open={!!pw} onClose={() => setPw(null)} width="max-w-md" title="Change your password"
             subtitle="The API revokes this session when it accepts a new password, so you will sign in again."
             footer={<><button className="btn-ghost" onClick={() => setPw(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy || !!pwProblem(pw)} onClick={async () => {
                        await run('pw', () => auth.changePassword({ current_password: pw.current, new_password: pw.next }))
                          .then(() => { setPw(null); toast.success('Password changed — sign in with the new one'); setTimeout(logout, 900); })
                          .catch((e) => toast.error(e.message));
                      }}>{busy === 'pw' ? 'Saving…' : 'Change password'}</button></>}>
        {pw && (
          <div className="flex flex-col gap-3">
            <Field label="Current password" required><Input type="password" autoComplete="current-password" value={pw.current} onChange={(v) => setPw({ ...pw, current: v })} placeholder="What you sign in with now" /></Field>
            <Field label="New password" required error={pw.current ? pwProblem(pw) : null}
                   hint="At least 8 characters — the length the API enforces.">
              <Input type="password" autoComplete="new-password" value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} placeholder="8 characters or more" />
            </Field>
            <Field label="Repeat the new password" required><Input type="password" autoComplete="new-password" value={pw.again} onChange={(v) => setPw({ ...pw, again: v })} placeholder="Type it once more" /></Field>
            <p className="text-xs text-slate-500">Every other device stays signed out: changing the password bumps the token version, which invalidates all access tokens at once.</p>
          </div>
        )}
      </Modal>

    </header>
  );
}

function MenuButton({ children, onClick, icon, danger = false }) {
  return (
    <button className={'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors '
      + (danger ? 'text-red-300 hover:bg-bad/15' : 'text-slate-300 hover:bg-ink-800 hover:text-slate-100')}
            onClick={onClick}>
      <span className="grid h-4 w-4 place-items-center">{icon}</span>
      {children}
    </button>
  );
}

/** Same numbers the server enforces (changePasswordBody in backend/src/validators/auth.schema.js). */
function pwProblem(pw) {
  if (!pw) return null;
  if (!pw.current) return 'Your current password is needed to change it';
  if (String(pw.next).length < 8) return 'A new password has to be at least 8 characters';
  if (pw.next === pw.current) return 'That is the password you already use';
  if (pw.again !== pw.next) return 'The two boxes do not match';
  return null;
}
