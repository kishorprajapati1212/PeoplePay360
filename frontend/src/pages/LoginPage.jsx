import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';
import { APP_NAME } from '../config/app.js';
import { landingFor } from '../rbac/landing.js';
import { Field, Input } from '../components/ui/controls.jsx';
import { ThemeToggle } from '../layout/ThemeToggle.jsx';

/**
 * The mockup's login card, plus a role switcher: one click fills the demo credentials for that role so
 * you can see exactly what that role may do. Password is the seeded default for every account.
 */
/**
 * One button per seeded login — the addresses here are copied from backend/db/seed/data.js and must
 * stay identical to it. An earlier version of this list typed "payroll.admin@oxp.com" for the account
 * the seeder creates as "payroll-admin@oxp.com", and clicking it produced a sign-in failure that looked
 * like a broken account rather than a typo.
 * The notes are what the roles actually hold (see backend/src/lib/shared/permissions.js).
 */
const DEMO = [
  { role: 'Admin', email: 'admin@oxp.com', note: 'everything, incl. users & settings', icon: <path d="M12 2.5 14.9 8.5 21.5 9.4 16.7 14 17.9 20.6 12 17.4 6.1 20.6 7.3 14 2.5 9.4 9.1 8.5z" /> },
  { role: 'HR Manager', email: 'hr@oxp.com', note: 'people, contracts, attendance, time off', icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M18 14.6c2 .7 3.2 2.2 3.6 4.4" /></> },
  { role: 'Payroll Officer', email: 'hr2@oxp.com', note: 'runs: compute, validate, mark paid', icon: <><rect x="4" y="10" width="16" height="10" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v2.5" /></> },
  { role: 'Payroll Manager', email: 'payroll@oxp.com', note: '+ bulk e-mail, PDFs, delete a run', icon: <><rect x="2.5" y="6" width="19" height="13" rx="3" /><path d="M2.5 10h19" /><path d="M6 15h4" /></> },
  { role: 'Employee', email: 'aarav.mehta@oxp.com', note: 'own payslips, leave, attendance', icon: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.4 3.4-5 7-5s6.2 1.6 7 5" /></> },
];
/** The seeder's default (config.demo.password). A deployment that set DEMO_PASSWORD must change this. */
const PASSWORD = 'Password@123';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@oxp.com');
  const [showPw, setShowPw] = useState(false);
  const [password, setPassword] = useState(PASSWORD);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event?.preventDefault();
    setBusy(true); setError(null);
    try {
      const me = await login(email.trim(), password);
      // Every sign-in starts at that role's own front door — never at whatever URL the previous
      // user left in the address bar (an employee must not land on a payroll run).
      navigate(landingFor(me), { replace: true });
    } catch (e) {
      setError(e.message || 'Sign in failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* The pitch panel: a quiet gradient canvas with the three sentences that explain the product. */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-ink-900 p-10 lg:flex">
        <div aria-hidden className="pointer-events-none absolute inset-0"
             style={{ background: 'radial-gradient(600px 420px at 12% -6%, rgb(var(--brand-500) / 0.22), transparent 65%), radial-gradient(500px 380px at 105% 108%, rgb(var(--brand-400) / 0.13), transparent 60%)' }} />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.35]"
             style={{ backgroundImage: 'linear-gradient(rgb(var(--line) / 0.5) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--line) / 0.5) 1px, transparent 1px)', backgroundSize: '44px 44px', maskImage: 'radial-gradient(700px 500px at 20% 0%, black, transparent 75%)' }} />

        <div className="relative flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl text-white"
               style={{ backgroundImage: 'linear-gradient(135deg, rgb(var(--brand-500)), rgb(var(--brand-700)))', boxShadow: '0 8px 24px -8px rgb(var(--brand-500) / 0.6)' }}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 9V7a5 5 0 0 0-9.6-2M5 11v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7z" /></svg>
          </div>
          <span className="text-sm font-semibold tracking-tight text-slate-100">{APP_NAME}</span>
        </div>

        <div className="relative">
          <span className="chip mb-5 border-brand-500/30 bg-brand-500/10 text-brand-200">HR · Attendance · Payroll</span>
          <h1 className="max-w-md text-4xl font-semibold leading-[1.15] tracking-tight text-slate-50">
            Payroll that shows its working.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">
            Attendance, time off and salary rules feed one computation: draft → compute → validate → PDFs → paid → emailed.
            Half-month runs reconcile back to the same monthly net, and every payslip a role touched is auditable.
          </p>
          <ul className="mt-8 space-y-3 text-xs text-slate-400">
            {[
              'Roles decide the menu, the buttons and the rows you can see',
              'Bulk payslip PDFs and mail run on a Redis worker, never in the request',
              'Employees punch in and out and download their own slips from the portal',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand-500/20 text-brand-300">
                  <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 12.5l5 5 10-11" /></svg>
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] text-slate-600">PostgreSQL · Express · React · Node · Redis</p>
      </div>

      <div className="flex items-center justify-center p-4 sm:p-6">
        {/* The theme control lives here too: the sign-in screen is part of the product, and a light-mode user
            should not get a dark card and then a light app. */}
        <form onSubmit={submit} className="panel w-full max-w-md p-7" style={{ animation: 'rise-in .25s ease-out' }}>
          <div className="mb-5 flex items-center justify-between">
            <div className="grid h-11 w-11 place-items-center rounded-2xl text-white lg:hidden"
                 style={{ backgroundImage: 'linear-gradient(135deg, rgb(var(--brand-500)), rgb(var(--brand-700)))' }}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 9V7a5 5 0 0 0-9.6-2M5 11v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7z" /></svg>
            </div>
            <ThemeToggle compact />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-100">Welcome back</h2>
          <p className="mt-1 text-xs text-slate-400">Sign in with your work email.</p>

          <div className="mt-6 flex flex-col gap-4">
            <Field label="Company email" required>
              <Input value={email} onChange={setEmail} type="email" autoComplete="username" placeholder="you@company.com" />
            </Field>
            <Field label="Password" required error={error} hint={error ? 'Check the address with the buttons below — most failures here are a typo in the email.' : undefined}>
              <div className="relative">
                <Input value={password} onChange={setPassword} type={showPw ? 'text' : 'password'} autoComplete="current-password" placeholder="Password" className="pr-16" />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-slate-400 transition-colors hover:text-slate-200"
                        onClick={() => setShowPw((v) => !v)}>{showPw ? 'Hide' : 'Show'}</button>
              </div>
            </Field>
          </div>

          <button className="btn-primary mt-6 w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>

          <div className="mt-7 border-t border-line pt-5">
            <p className="label mb-3">Demo accounts</p>
            <div className="grid gap-1.5">
              {DEMO.map((d) => (
                <button type="button" key={d.email} onClick={() => { setEmail(d.email); setPassword(PASSWORD); setError(null); }}
                        className={'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-xs transition-all '
                          + (email === d.email ? 'border-brand-500/60 bg-brand-500/10' : 'border-line hover:bg-ink-800/80')}>
                  <span className={'grid h-7 w-7 shrink-0 place-items-center rounded-lg ' + (email === d.email ? 'bg-brand-500/20 text-brand-300' : 'bg-ink-800 text-slate-500')}>
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d.icon}</svg>
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-slate-200">{d.role}</span>
                    <span className="block truncate text-slate-500">{d.email} · {d.note}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-slate-500">Password for all of them: <code className="text-slate-300">{PASSWORD}</code> — the shared
              <code className="text-slate-400">DEMO_PASSWORD</code> from backend/.env, applied to every seeded and newly created login.</p>
            <p className="mt-1.5 text-[11px] text-slate-600">
              If a sign-in is refused twice, stop retyping it: the guard allows 8 attempts per 5 minutes per address and
              then waits 15 minutes out before it will try again. Pick the address with a button above instead.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
