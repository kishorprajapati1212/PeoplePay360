import { useCallback, useState } from 'react';
import { company } from '../../api/endpoints.js';
import { patternProblem } from '../../components/crud/schemaForm.jsx';
import { useApi, useAction } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { Field, Input, Select, Textarea, Checkbox } from '../../components/ui/controls.jsx';
import { usePicklists, keepCurrentValue } from '../../utils/picklists.js';
import { ErrorPanel, Notice } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { num } from '../../utils/format.js';

/**
 * Company settings — the switches that decide how every payslip in this company is computed.
 *
 * The list below is the whole screen: one row per setting, and each row says what the number is measured
 * in, what the API accepts, and what an example value means. `min`/`max`/`step` are the same numbers as
 * `companyBody` in backend/src/validators/payroll.schema.js, so a value this screen accepts is a value the
 * API accepts. If you add a setting here, add it there too — one line each side.
 */
const SETTINGS = {
  'Identity & payslip header': [
    { key: 'company_name', label: 'Company name', max: 120, placeholder: 'OXP Technologies' },
    { key: 'legal_name', label: 'Legal name', max: 120, placeholder: 'OXP Technologies Pvt Ltd' },
    { key: 'city', label: 'City', max: 80, placeholder: 'Ahmedabad' },
    { key: 'state', label: 'State', max: 80, type: 'select', placeholder: 'Choose a state' },
    { key: 'postal_code', label: 'PIN code', max: 20, pattern: 'pincode' },
    { key: 'country', label: 'Country', max: 60, placeholder: 'India' },
    { key: 'currency', label: 'Currency code', max: 10, placeholder: 'INR', hint: 'Written on the payslip header.' },
    { key: 'currency_symbol', label: 'Currency symbol', max: 6, placeholder: '₹' },
    { key: 'timezone', label: 'Timezone', max: 60, placeholder: 'Asia/Kolkata' },
    { key: 'address', label: 'Address', type: 'textarea', max: 300, full: true, placeholder: 'Street, building, city' },
    { key: 'payslip_footer', label: 'Payslip footer', type: 'textarea', max: 400, full: true, placeholder: 'This is a computer-generated payslip and needs no signature.', hint: 'Printed at the bottom of every slip.' },
  ],
  // Mail used to be .env-only, which is why "the invite never arrived" was a config hunt. It is company
  // configuration like everything else on this screen: four fields and a switch, and Check mail below proves it.
  'E-mail delivery': [
    { key: 'mail_enabled', label: 'Send real mail', type: 'checkbox', full: true,
      hint: 'Off means nothing leaves this machine: every message is written to backend/storage/mail as a .eml file instead. On means the two boxes below are used.' },
    // Two boxes, then. A Gmail / Outlook / Zoho / Yahoo / iCloud / Fastmail / QQ address carries its own host,
    // port and TLS mode (backend/src/lib/mailer/providers.js), and the three fields underneath it are only for a
    // mailbox that table has never heard of.
    { key: 'smtp_user', label: 'Mail account', max: 160, pattern: 'email', placeholder: 'payroll@gmail.com',
      hint: 'The address that sends the mail — a Gmail address needs nothing else on this screen.' },
    { key: 'smtp_password', label: 'Password / App Password', type: 'password', max: 400, full: true,
      placeholder: 'Stored as-is and never read back — blank keeps what is already stored',
      hint: 'Paste the App Password (16 characters, spaces included) for a Google, Apple, Yahoo, Fastmail or QQ account — their login password is refused with "Username and Password not accepted", which Check mail quotes back at you.' },
    { key: 'smtp_host', label: 'SMTP host — only if we do not know your provider', max: 160,
      placeholder: 'empty is correct for Gmail, Outlook, Zoho, Yahoo, iCloud, Fastmail, QQ',
      hint: 'Fill it only when your provider handed you a host (a company relay, a cPanel mailbox). A value like smtp.reply.example resolves to nothing, so it is ignored and the address decides.' },
    { key: 'smtp_port', label: 'SMTP port', unit: 'port', type: 'number', min: 1, max: 65535, step: 1, integer: true, placeholder: 'only with a host',
      hint: '587 is STARTTLS, 465 is implicit TLS. Blank means whatever the address decides.' },
    { key: 'smtp_secure', label: 'Implicit TLS on connect (port 465 style)', type: 'checkbox',
      hint: 'Only meaningful next to a host you typed — an address we recognise already knows.' },
    { key: 'mail_from', label: 'Reply-to / sender mailbox', max: 160, pattern: 'email', hint: 'Also where bounce notices land.' },
    { key: 'mail_invite_ttl_minutes', label: 'Set-password link lives for', unit: 'minutes', type: 'number', min: 1, max: 1440, step: 1,
      integer: true, placeholder: '10',
      hint: 'Minutes an invitation link works, and only once. 10 is the default: short enough that a link left in an inbox stops being a way in, long enough to be opened on a phone. Leave it blank to fall back to INVITE_TTL_MINUTES in backend/.env.' },
    { key: 'mail_daily_limit', label: 'Daily mail cap', unit: 'mails/day', type: 'number', min: 1, max: 100000, step: 1, integer: true, placeholder: '400', hint: 'What the app refuses to queue past this, so a bulk run cannot get the domain blocked.' },
  ],
  'Payroll conventions': [
    { key: 'payroll_day_basis', label: 'Payroll day basis', type: 'select', full: true,
      options: [{ value: 'ACTUAL_WORKING_DAYS', label: 'Actual working days' }, { value: 'CALENDAR_DAYS', label: 'Calendar days' }, { value: 'FIXED_26', label: 'Fixed 26 days' }, { value: 'FIXED_30', label: 'Fixed 30 days' }],
      hint: 'How a month is divided when a salary is shared over the days — the divisor for pro-rata and for a day without pay.' },
    { key: 'fiscal_year_start_month', label: 'Fiscal year starts', type: 'select',
      options: Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i] })) },
    { key: 'default_hours_per_day', label: 'Hours per day', unit: 'h', type: 'number', min: 1, max: 24, step: 0.5, placeholder: '8' },
    { key: 'overtime_multiplier', label: 'Overtime multiplier', unit: '× pay', type: 'number', min: 1, max: 4, step: 0.1, placeholder: '1.5' },
    { key: 'overtime_round_to', label: 'Overtime round to', unit: 'h', type: 'number', min: 0, max: 4, step: 0.25, placeholder: '0.5', hint: 'e.g. 0.5 → 12 minutes of OT pay nothing, 35 minutes pays half an hour.' },
    { key: 'overtime_min_hours', label: 'Minimum OT hours', unit: 'h', type: 'number', min: 0, max: 8, step: 0.25, placeholder: '0.5', hint: 'Shorter bits are not paid as OT.' },
    { key: 'round_net_to_rupee', label: 'Round net pay to the whole rupee', type: 'checkbox' },
    { key: 'sandwich_rule', label: 'Apply the sandwich rule to leave', type: 'checkbox', hint: 'Leave bridged by a holiday counts as full leave.' },
    { key: 'allow_negative_net', label: 'Allow a negative net (recovery exceeds pay)', type: 'checkbox', hint: 'Off is safer: the slip clamps at zero and the balance carries.' },
    { key: 'pt_enabled', label: 'Professional tax enabled', type: 'checkbox' },
    { key: 'pt_state', label: 'PT slab state', max: 60, type: 'select', placeholder: 'Same as the company state',
      hint: 'Which slab table to read; blank uses the company state. Only the states with a Professional Tax of their own are listed.' },
    { key: 'pt_charge_slice', label: 'Charge PT on', type: 'select', placeholder: 'The month (default)', options: [
      { value: 'MONTH', label: 'Once, on the monthly run' }, { value: 'HALF_FIRST', label: 'The 1st-half run only' }, { value: 'HALF_SECOND', label: 'The 2nd-half run only' }],
      hint: 'Half-month payroll otherwise charges the flat monthly PT twice.' },
    { key: 'pt_monthly', label: 'PT flat monthly', unit: '₹', type: 'number', min: 0, max: 9999999, step: 1, placeholder: '200', hint: 'Slabs override this where the state has them.' },
    { key: 'pt_annual_cap', label: 'PT annual cap', unit: '₹', type: 'number', min: 0, max: 9999999, step: 1, placeholder: '2500', hint: 'Stops December charging tax twice.' },
  ],
  'Statutory deductions': [
    { key: 'pf_enabled', label: 'Provident fund', type: 'checkbox' },
    { key: 'esi_enabled', label: 'ESI', type: 'checkbox' },
    { key: 'pf_employee_pct', label: 'PF employee', unit: '%', type: 'number', min: 0, max: 1000, step: 0.5, placeholder: '12' },
    { key: 'pf_employer_pct', label: 'PF employer', unit: '%', type: 'number', min: 0, max: 1000, step: 0.5, placeholder: '12' },
    { key: 'pf_wage_ceiling', label: 'PF wage ceiling', unit: '₹/month', type: 'number', min: 0, max: 9999999, step: 1, placeholder: '15000', hint: 'A ₹60,000 basic still contributes 12% of this.' },
    { key: 'esi_employee_pct', label: 'ESI employee', unit: '%', type: 'number', min: 0, max: 1000, step: 0.01, placeholder: '0.75' },
    { key: 'esi_employer_pct', label: 'ESI employer', unit: '%', type: 'number', min: 0, max: 1000, step: 0.01, placeholder: '3.25' },
    { key: 'esi_wage_limit', label: 'ESI wage limit', unit: '₹/month', type: 'number', min: 0, max: 9999999, step: 1, placeholder: '21000', hint: 'Above this wage, no ESI at all — the whole family is exempt.' },
    { key: 'advance_percentage', label: 'Half-month advance', unit: '% of monthly net', type: 'number', min: 1, max: 100, step: 1, placeholder: '50', hint: '1st half pays this share; 2nd half trues it up.' },
    { key: 'document_retention_years', label: 'Document retention', unit: 'years', type: 'number', min: 1, max: 40, step: 1, integer: true, placeholder: '7' },
  ],
};

const NUMERIC = new Set(Object.values(SETTINGS).flat().filter((f) => f.type === 'number').map((f) => f.key));

export function CompanyPage() {
  // States and the PT ones come from the API, so this dropdown and the validator cannot drift apart.
  const { states, ptStates, loading: statesLoading, error: statesError } = usePicklists();
  const toast = useToast();
  const mayWrite = useCan('settings:write');
  const { data, loading, error, reload } = useApi(useCallback(() => company.get(), []), []);
  const [values, setValues] = useState(null);
  const [problems, setProblems] = useState({});
  // Bumped after a save so the mail panel below re-reads the driver — a settings change should be visible in
  // the same screen that made it, not after a reload.
  const [savedAt, setSavedAt] = useState(0);
  // Read once for the panel below *and* for the line that says what the settings dial — two fetches of the
  // same row would be two chances to show different answers.
  const mail = useApi(useCallback(() => company.mail.get(), [savedAt]), [savedAt]);
  const { run, busy } = useAction();
  const form = values || data || {};

  const set = (key, value) => setValues({ ...form, [key]: value });

  /** One rule per number, checked before anything is sent. Returns { key: message }. */
  function check(f, raw) {
    // Formats first (PIN code, mailboxes): a value in the wrong shape is refused here rather than
    // landing back as a field error from the API.
    if (f.pattern) { const p = patternProblem(f.pattern, raw); if (p) return `${f.label}: ${p}`; }
    if (f.type !== 'number') return null;
    if (raw === '' || raw === null || raw === undefined) return null;   // blank means "leave the API's value alone"
    const n = Number(raw);
    if (!Number.isFinite(n)) return 'Enter a number';
    if (f.integer && !Number.isInteger(n)) return `Whole ${f.unit || 'numbers'} only`;
    if (n < f.min) return `${f.label} cannot be below ${f.min}${f.unit ? ' ' + f.unit : ''}`;
    if (n > f.max) return `${f.label} cannot be above ${f.max}${f.unit ? ' ' + f.unit : ''}`;
    return null;
  }

  async function save() {
    const found = {};
    for (const group of Object.values(SETTINGS)) for (const f of group) { const m = check(f, form[f.key]); if (m) found[f.key] = m; }
    setProblems(found);
    if (Object.keys(found).length) { toast.error('Fix the highlighted values first'); return; }
    // a blank box is not "set this to zero": empty values are dropped, so the API keeps what it has
    const body = Object.fromEntries(Object.entries(form)
      .filter(([k, v]) => !['id', 'created_at', 'updated_at'].includes(k))
      .filter(([, v]) => v !== '' && v !== null && v !== undefined));
    await run('save', () => company.update(body)).then(() => { setValues(null); setSavedAt((n) => n + 1); toast.success('Settings saved — new computations pick them up immediately'); reload(); })
      .catch((e) => toast.error(e.message));
  }

  if (loading) return <Panel><p className="text-sm text-slate-400">Loading settings…</p></Panel>;
  if (error) return <ErrorPanel error={error} onRetry={reload} />;

  return (
    <>
      <PageHeader title="Company" subtitle="Identity, payroll conventions and statutory switches. One place, because every payslip inherits from here."
                  actions={mayWrite && <>
                    {values && <button className="btn-ghost btn-sm" onClick={() => { setValues(null); setProblems({}); }}>Discard</button>}
                    <button className="btn-primary btn-sm" disabled={!values || !!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save settings'}</button>
                  </>} />

      {!mayWrite && (
        <Notice tone="info" title="Read-only for your role">
          <p>The settings can be read here; saving them belongs to an Admin — that includes the mail server
             (address, app password) and how long a set-password link stays open.</p>
        </Notice>
      )}

      <MailPanel status={mail} />

      <div className="grid gap-4 xl:grid-cols-2">
        {Object.entries(SETTINGS).map(([title, fields]) => (
          <Panel key={title} title={title}>
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => f.type === 'checkbox' ? (
                <div key={f.key} className={f.full ? 'sm:col-span-2' : ''}>
                  <Checkbox checked={!!form[f.key]} onChange={(v) => set(f.key, v)} label={f.label} hint={f.hint} />
                </div>
              ) : (
                <Field key={f.key} label={f.label} hint={f.hint} error={problems[f.key]} className={f.full ? 'sm:col-span-2' : ''}>
                  {f.type === 'select'
                    ? <Select value={form[f.key] ?? ''} onChange={(v) => set(f.key, f.integer || f.key === 'fiscal_year_start_month' ? Number(v) : v)}
                              options={f.key === 'state' ? keepCurrentValue(states, form.state) : f.key === 'pt_state' ? ptStates : f.options}
                              loading={statesLoading} error={statesError} placeholder={f.placeholder || 'Not set'} />
                    : f.type === 'textarea'
                      ? <Textarea rows={2} value={form[f.key]} maxLength={f.max} onChange={(v) => set(f.key, v)} placeholder={f.placeholder} />
                      : f.type === 'password'
                        ? <Input type="password" value={form[f.key]} maxLength={f.max} placeholder={f.placeholder}
                                  onChange={(v) => set(f.key, v)} />
                      : (
                        <Input type={f.type === 'number' ? 'number' : 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined}
                               value={form[f.key]} min={f.min} max={f.max} step={f.step} suffix={f.unit}
                               maxLength={f.type === 'number' ? 12 : f.max}
                               placeholder={f.placeholder} onChange={(v) => set(f.key, v)} />
                      )}
                </Field>
              ))}
            </div>
            {title === 'E-mail delivery' && <MailServerHint form={form} status={mail.data || {}} loading={mail.loading} />}
          </Panel>
        ))}

        <Panel title="What these values touch">
          <ul className="space-y-2 text-sm text-slate-400">
            {[
              'Day basis decides the pro-rata divisor when someone joins or leaves mid-month.',
              'PF ceiling is why a ₹60,000 basic still contributes 12% of ₹15,000.',
              'PT annual cap stops December charging tax twice.',
              'Half-month advance % is what makes 1st-half + 2nd-half equal one monthly net.',
              'Overtime rounding is applied per day, after the approved OT hours are summed.',
              'Every one of these is read at compute time, so a change affects the next run, never a paid one.',
            ].map((line) => <li key={line} className="flex gap-2"><span className="text-brand-300">›</span>{line}</li>)}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Saved values are checked here and again by the API ({NUMERIC.size} numbers, each with the same
            range). A field left blank is left alone rather than zeroed.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Nothing on this screen carries a <span className="text-brand-300">*</span>, because nothing on it is
            required: the company row always has defaults, and every setting can be left as it is. On screens
            where a field <em>is</em> needed — an employee's name, a rule's code — the box carries the star and
            the same rule is in the API's validator.
          </p>
        </Panel>
      </div>
    </>
  );
}

/**
 * What the app would do if it had to send something right now, and the only place on this screen that touches
 * the mail server.
 *
 * The status is a config read (`GET /company/mail`), so opening Settings never logs in anywhere; the buttons are
 * what connect. Both go through the same mailer an invitation uses, which is the point: a green light here means
 * the next "Send link" arrives, and a red one quotes the provider's own words instead of leaving you to guess
 * whether an App Password was what it wanted.
 */
/**
 * The line that answers "what will this dial?" before anything is saved. The provider list comes from the API
 * (`providers`, built in backend/src/lib/mailer/providers.js), so this file repeats no rules of its own: a known
 * address means the two boxes are the job, an unknown one names the box that is missing, and a host you typed
 * always wins.
 */
function MailServerHint({ form, status, loading }) {
  if (loading) return <p className="mt-3 text-xs text-slate-500">Reading which server your address implies…</p>;
  const address = String(form.smtp_user ?? status.user ?? '').trim();
  const domain = address.includes('@') ? address.slice(address.lastIndexOf('@') + 1).toLowerCase() : '';
  const typed = String(form.smtp_host ?? status.host ?? '').trim();
  const match = (status.providers || []).find((p) => p.domains.includes(domain));
  const said = status.conflict?.ignored
    // The server the API dialed is a fact; a box holding an example value is not a wish.
    ? { text: `${status.conflict.stored_host} names no server, so it is ignored — this dials ${status.conflict.wanted_server}, which the address decides. Clear the box below and the note goes away.`, tone: 'text-slate-400' }
    : typed
    ? { text: `${typed}${form.smtp_port ? `:${form.smtp_port}` : ''} · ${form.smtp_secure || status.secure ? 'implicit TLS' : 'STARTTLS'} — the host you typed wins over our list, unless it is an example value, which resolves to nothing`, tone: 'text-slate-400' }
      : match
        ? { text: `${match.host}:${match.port} · ${match.secure ? 'implicit TLS' : 'STARTTLS'} — read off the address, so the two boxes above are the whole job${match.appPassword ? ', and it wants an App Password rather than your login password' : ''}`, tone: 'text-emerald-200' }
        : domain
          ? { text: `${domain} is not on our list — its SMTP host goes in the box below (your provider's "SMTP settings" page prints it). Leave it blank and every mail stays a file in backend/storage/mail.`, tone: 'text-amber-200' }
          : { text: 'a mail address and its password is the whole of it: the server comes with the address for the providers we know.', tone: 'text-slate-500' };
  // Only a real server gets the "Sends through" lead-in; the other two sentences are about what is missing.
  const prefix = status.conflict?.ignored || typed || match ? 'Sends through ' : '';
  return <p className={'mt-3 text-xs leading-relaxed ' + said.tone}>{prefix}{said.text}</p>;
}

function MailPanel({ status }) {
  const { run, busy } = useAction();
  // POST /settings/mail/check needs settings:write, so the buttons only appear for a role that can press them.
  const mayWrite = useCan('settings:write');
  const [result, setResult] = useState(null);
  const s = status.data || {};
  const preview = s.driver === 'preview';

  function check(send) {
    setResult(null);
    return run(send ? 'send' : 'check', () => company.mail.check(send ? {} : { to: null }))
      .then((out) => { setResult(out); })
      .catch((e) => setResult({ connected: false, error: e.message }));
  }

  const verdict = (() => {
    if (!result) return null;
    if (result.error) return { tone: 'warn', title: 'The settings screen could not ask the server', text: result.error };
    if (!result.connected) {
      return { tone: 'warn', title: 'The mail server refused the connection',
               text: [result.verify?.error || result.note || 'The host, port or TLS mode does not answer. Nothing was sent.',
                      result.verify?.hint].filter(Boolean).join(' — ') };
    }
    if (!result.mail) return { tone: 'good', title: 'The login works', text: 'Connected to the server. No message was sent — you only asked it to check.' };
    if (result.mail.ok) {
      return result.mail.driver === 'preview'
        ? { tone: 'info', title: 'Written as a file, not sent', text: result.mail.note || ('Saved to ' + (result.mail.file || 'backend/storage/mail')) }
        : { tone: 'good', title: 'A test mail went out', text: `Sent through ${result.mail.driver} to the address you are signed in with${result.mail.message_id ? ` · message id ${result.mail.message_id}` : ''}.` };
    }
    return { tone: 'warn', title: 'The provider refused the message', text: result.mail.error || 'It said no without a reason.' };
  })();

  return (
    <Panel title="Mail right now" subtitle="What happens to an invitation or a payslip e-mail the moment it is asked for.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Driver', preview ? 'preview (files only)' : s.driver || '…', preview ? 'Nothing leaves this machine.' : 'How the message is handed over.'],
          ['Sending as', s.login || 'nobody', s.password_stored ? 'A password is stored here.' : 'No password stored in the database.'],
          ['From', s.from || '—', 'The address a bounce comes back to.'],
          ['Daily cap', s.daily_limit ? `${num(s.daily_limit)} messages` : '—', 'Stops a bulk run past the provider limit.'],
          ['Invitation link', s.invite_ttl_minutes ? `${num(s.invite_ttl_minutes)} minutes, once` : '10 minutes (from the server)', 'How long a set-password link stays open. A used link never opens again.'],
        ].map(([label, value, hint]) => (
          <div key={label}>
            <p className="label">{label}</p>
            <p className="mt-0.5 text-sm text-slate-100">{value}</p>
            <p className="text-xs text-slate-500">{hint}</p>
          </div>
        ))}
      </div>
      {s.note && <p className="mt-3 text-xs text-amber-200">{s.note}</p>}
      {s.password_shape && <p className="mt-2 text-xs text-amber-200">{s.password_shape}</p>}
      <p className="mt-2 text-xs text-slate-500">
        {s.server ? <>Server: <span className="text-slate-100">{s.server}</span>{s.inferred ? `, picked from the address (${s.inferred}) — nothing was typed for it` : ' — the host you typed'}</>
                  : 'No server yet: a mail address and its App Password is the whole of it, because the server comes with the address.'}
      </p>
      {s.conflict && (
        <Notice tone="warn" title="The SMTP host box disagrees with the address">
          <p>
            <span className="text-slate-100">{s.conflict.stored_host}</span>
            {s.conflict.ignored
              ? <> names no server, so it is ignored: this app dials <span className="text-slate-100">{s.conflict.wanted_server}</span>, which is what a {s.conflict.brand} address means.</>
              : <> is not what {s.conflict.brand} uses ({s.conflict.wanted_server}). The box wins, so that host is what gets dialed — if it refuses, that is why.</>}
          </p>
          <p className="mt-1">
            {mayWrite
              ? <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => run('fix', () => company.update({ smtp_host: '', smtp_port: null, smtp_secure: false }).then(() => status.reload?.()))}>
                  {busy === 'fix' ? 'Clearing…' : `Clear the host box and use ${s.conflict.wanted_server}`}
                </button>
              : 'An Admin can empty that box under E-mail delivery below; the address then decides on its own.'}
          </p>
        </Notice>
      )}

      {mayWrite ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => check(false)}>
            {busy === 'check' ? 'Connecting…' : 'Check connection'}</button>
          <button className="btn-primary btn-sm" disabled={!!busy} onClick={() => check(true)}>
            {busy === 'send' ? 'Sending…' : 'Send a test mail to my address'}</button>
          <span className="text-xs text-slate-500">Both use the live settings, so save first if you just changed one.</span>
        </div>
      ) : (
        <p className="mt-4 text-xs text-slate-500">Asking the server, or sending a test message, is filed as a settings
          change — so only an Admin can press those two buttons. You are reading the numbers they saved.</p>
      )}
      {verdict && <div className="mt-3"><Notice tone={verdict.tone} title={verdict.title}><p>{verdict.text}</p></Notice></div>}
    </Panel>
  );
}
