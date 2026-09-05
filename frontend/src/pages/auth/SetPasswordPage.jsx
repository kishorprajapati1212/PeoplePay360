import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth } from '../../api/endpoints.js';
import { useApi } from '../../hooks/useApi.js';
import { Field, Input } from '../../components/ui/controls.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { datetime } from '../../utils/format.js';
import { ThemeToggle } from '../../layout/ThemeToggle.jsx';

/**
 * The other half of Settings → User Access → Send link.
 *
 * An admin never types a password for somebody else, so the account arrives with a link instead: this
 * screen takes the token from the query string, asks the API whose it is (so the person can see they are in
 * the right place before typing anything), and posts the new password. It is reachable while signed out —
 * App.jsx puts it outside the auth guard — and the token is single-use: once it has set a password the API
 * reports it as spent, so a forwarded e-mail cannot be used twice.
 *
 * Deliberately it does not sign anybody in. The API returns no session here on purpose: the first real
 * sign-in should go through the login endpoint, where the guard, the cookie and the audit line all happen.
 */
export function SetPasswordPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') || '';
  const state = useApi(useCallback(() => (token ? auth.invitation(token) : Promise.resolve({ valid: false, reason: 'That address has no link in it. Open the whole URL from the e-mail.' })), [token]), [token]);
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  /* Both boxes have to say something before the button is live: an empty submit would only be answered by
     the API, and a form that can be posted into an error is a form that says "nobody tested this". */
  const problems = useMemo(() => {
    const p = [];
    if (!pw) p.push('Type a password.');
    else if (pw.length < 10) p.push('Use at least 10 characters.');
    if (!again) p.push('Repeat it once more.');
    else if (pw && pw !== again) p.push('The two passwords do not match yet.');
    return p;
  }, [pw, again]);

  if (!token) return <Shell note="This address has no invitation in it. The full link is in the e-mail your admin sent — copy the whole line, not just the part up to &token=." />;
  if (state.loading) return <Shell><Spinner label="Checking that link" /></Shell>;

  if (done) {
    return (
      <Shell>
        <Panel title="Password saved" pad>
          <p className="text-sm text-slate-300">{done.note || 'Your password is set. Sign in with the work address on this account.'}</p>
          <p className="mt-2 text-xs text-slate-500">That link is spent — a second use would mean somebody else had the same e-mail, so it does not work by design.</p>
          <button className="btn-primary mt-4" onClick={() => nav('/login', { replace: true })}>Go to sign in</button>
        </Panel>
      </Shell>
    );
  }

  const info = state.data || {};
  const unusable = state.error || info.valid === false;

  return (
    <Shell>
      <Panel title={unusable ? 'That link will not work' : 'Set your password'} subtitle={unusable ? null : 'One screen, one rule: 10 characters or more. Nobody needs to know what you typed.'} pad>
        {unusable ? (
          <>
            <p className="text-sm text-slate-300">{state.error?.message || info.reason || 'This link is not one we issued.'}</p>
            <p className="mt-2 text-xs text-slate-500">If your admin is still signed in, they can send a fresh one from Settings → User Access.</p>
            <button className="btn-ghost btn-sm mt-4" onClick={() => nav('/login', { replace: true })}>Back to sign in</button>
          </>
        ) : (
          <form onSubmit={async (e) => {
            e.preventDefault();
            if (problems.length) return;
            setErr(''); setBusy(true);
            try { setDone(await auth.setPassword({ token, password: pw }) || { note: '' }); }
            catch (e2) { setErr(e2?.message || 'The server refused that password.'); }
            finally { setBusy(false); }
          }}>
            <dl className="mb-4 grid gap-1 text-xs text-slate-400">
              <div className="flex gap-2"><dt className="text-slate-500">Account</dt><dd className="text-slate-200">{info.name || '—'}</dd></div>
              <div className="flex gap-2"><dt className="text-slate-500">Sign in as</dt><dd className="text-slate-200">{info.work_email}</dd></div>
              {info.expires_at && <div className="flex gap-2"><dt className="text-slate-500">Link expires</dt><dd>{datetime(info.expires_at)}</dd></div>}
              {info.already_set && (
                <p className="mt-2 rounded-lg border border-warn/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                  A password is already set on this account. Using this link will <em>replace</em> it and sign the account out everywhere else.
                </p>
              )}
            </dl>
            <div className="grid gap-3">
              <Field label="New password" required><Input type="password" autoComplete="new-password" value={pw} onChange={setPw} placeholder="At least 10 characters" /></Field>
              <Field label="Repeat it" required error={again && pw !== again ? 'These two do not match yet' : undefined}>
                <Input type="password" autoComplete="new-password" value={again} onChange={setAgain} placeholder="The same thing twice" />
              </Field>
              {problems.length > 0 && <p className="text-xs text-slate-400">{problems.join(' ')}</p>}
              {err && <p className="rounded-lg border border-bad/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">{err}</p>}
              <button className="btn-primary justify-self-start" type="submit" disabled={busy || problems.length > 0}>
                {busy ? 'Saving…' : 'Set password and continue'}
              </button>
            </div>
          </form>
        )}
      </Panel>
    </Shell>
  );
}

/** The sign-in page's frame, so an invitation lands somewhere that looks like the product. */
function Shell({ children, note }) {
  return (
    <div className="relative grid min-h-screen place-items-center p-4 sm:p-6">
      {/* the same theme control the sign-in card carries: this page is part of the product, not a stray link */}
      <div className="absolute right-4 top-4"><ThemeToggle compact /></div>
      <div className="w-full max-w-md">
        <p className="mb-4 text-center text-xs font-semibold tracking-[0.18em] text-brand-300">PeoplePay 360</p>
        {note ? <Panel title="Check the link" pad><p className="text-sm text-slate-300">{note}</p></Panel> : children}
      </div>
    </div>
  );
}
