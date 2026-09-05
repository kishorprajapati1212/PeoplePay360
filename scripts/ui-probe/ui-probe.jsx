/*
 * ui-probe — renders the screens this project's UI review complained about, in jsdom, against a stubbed
 * API, and asserts the text the user would actually see. It exists because "the button is there" is not
 * the same claim as "the button appears and does the right thing"; the cases below are that second claim.
 * Run:  node scripts/ui-probe/run.mjs      (needs `npm --prefix frontend install`, plus `npm i jsdom`)
 * It needs no database: every fetch is answered from the fixtures inside each case.
 */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../frontend/src/auth/AuthContext.jsx';
import { ToastProvider } from '../../frontend/src/components/ui/Toast.jsx';
import { MyTimeOffPage } from '../../frontend/src/pages/timeoff/MyTimeOffPage.jsx';
import { LeaveTypesPage } from '../../frontend/src/pages/timeoff/LeaveTypesPage.jsx';
import { AllocationsPage } from '../../frontend/src/pages/timeoff/AllocationsPage.jsx';
import { PayrunDetailPage } from '../../frontend/src/pages/payroll/PayrunDetailPage.jsx';
import { PayslipsPage } from '../../frontend/src/pages/payroll/PayslipsPage.jsx';
import { EmployeeFormModal } from '../../frontend/src/pages/employees/EmployeeFormModal.jsx';
import { LoginPage } from '../../frontend/src/pages/LoginPage.jsx';
import { SetPasswordPage } from '../../frontend/src/pages/auth/SetPasswordPage.jsx';
import { DashboardPage } from '../../frontend/src/pages/DashboardPage.jsx';
import { UsersPage } from '../../frontend/src/pages/settings/UsersPage.jsx';
import { Topbar } from '../../frontend/src/layout/Topbar.jsx';
import { api, setUnauthorizedHandler } from '../../frontend/src/api/client.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (times = 10) => { for (let i = 0; i < times; i++) await sleep(14); };
const text = () => (document.body.textContent || '').replace(/\s+/g, ' ');
const has = (s) => text().includes(s);
const byText = (needle, tag = 'button') =>
  [...document.querySelectorAll(tag)].find((b) => (b.textContent || '').includes(needle)) || null;
const inputLike = (pred) => [...document.querySelectorAll('input,textarea')].find(pred) || null;
const type = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

/* ── the fake API ─────────────────────────────────────────────────────────────── */
let calls = [];
let table = {};
window.fetch = async (url, init = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  const path = String(url).split('?')[0];
  const key = `${method} ${path}`;
  calls.push({ key, body: init.body ? JSON.parse(init.body) : null });
  const hit = table[key] ?? table[path] ?? table[`* ${path}`];
  if (hit === undefined) return { ok: true, status: 200, headers: new Headers(), text: async () => '{}', json: async () => ({}) };
  const status = hit.__status || 200;
  const body = hit.__body !== undefined ? hit.__body : hit;
  return {
    ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body), json: async () => body,
  };
};

/* AuthContext only asks /auth/me when it finds a token; without one every useCan() is false and the
   screens under test would render their NoAccess panel instead of themselves. */
try { localStorage.setItem('pp360.token', 'probe.jwt'); } catch {}

/* The same permission table the API uses, so the probe cannot drift from the server. */
import { permissionsFor, navFor, scopeFor } from '../../backend/src/lib/shared/permissions.js';

let who = {};
async function meFor(roles) {
  const p = permissionsFor(roles);
  return { id: 'u1', name: 'Probe Person', workEmail: 'probe@oxp.com', roles, roleLabels: roles, is_active: true,
           mustChangePassword: false, employeeId: 'e1', permissions: p.all ? ['*'] : p.list, scope: scopeFor(roles),
           menus: navFor(roles), employee: { id: 'e1', code: 'EMP0042', name: 'Probe Person' } };
}
const AUTH_ME = '__auth/me';
function baseTable() {
  return { 'GET /api/auth/me': who.me };
}

let root = null;
function render(ui) {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  root.render(<MemoryRouter initialEntries={ui.at || ['/x']}>
    <ToastProvider><AuthProvider>{ui.el}</AuthProvider></ToastProvider>
  </MemoryRouter>);
}

const EMPLOYEE_SELF = { at: ['/time-off/my-requests'], el: <MyTimeOffPage /> };

const CASES = {
  'my time off · the leave-type picker says when there is nothing to pick': async () => {
    who.me = await meFor(['EMPLOYEE']);
    table = { ...baseTable(),
      'GET /api/portal/time-off': { rows: [], total: 0 }, 'GET /api/portal/balances': [], 'GET /api/time-off/types': { rows: [] } };
    render(EMPLOYEE_SELF);
    await settle();
    const btn = byText('Request leave'); click(btn); await settle(4);
    expect(has('No leave types are available to you'), 'the dialog should say the list is empty, not show a blank box');
    expect(has('switched on a leave type'), 'and name what to do about it');
  },

  /* Dashboards: the registry decides, so a new kind cannot be half-wired, and an unknown one is a sentence. */
  'dashboard · an employee gets their own month, not a smaller HR screen': async () => {
    who.me = await meFor(['EMPLOYEE']);
    table = { ...baseTable(),
      'GET /api/portal/summary': { period: { label: 'September 2026' }, attendance: { worked_hours: 168, overtime_hours: 4.5, present: 21, absent: 0, half_day: 1 }, pending_approvals: 1, balances: [], requests: [], payslips: [] } };
    render({ at: ['/dashboard'], el: <DashboardPage /> });
    await settle();
    expect(has('My month'), 'the employee kind renders its own title');
    expect(has('Hours worked'), 'with the hours the worker computed');
    expect(has('Leave balance') && has('My payslips'), 'and the two things an employee actually comes for');
    expect(!has('Payroll dashboard'), 'and not a shred of the HR screen');
  },

  'dashboard · payroll keeps its run view, and an unknown kind says so instead of crashing': async () => {
    who.me = await meFor(['HR_PAYROLL_MANAGER']);
    table = { ...baseTable(),
      'GET /api/dashboard/overview': { period: { label: 'September 2026' }, headcount: 9, present: 8, on_leave: 1, open_requests: 2, cost: 620000, trend: [], status_breakdown: [], attendance: [] } };
    render({ at: ['/payroll'], el: <DashboardPage kind="payroll" /> });
    await settle();
    expect(has('Payroll dashboard'), 'the payroll kind keeps its own title');
    render({ at: ['/dashboard'], el: <DashboardPage kind="timesheet" /> });
    await settle(4);
    expect(has('not registered'), 'a key nobody registered is a message, not a white screen');
    expect(has('payroll') && has('me'), 'and it lists what does exist, so the fix is obvious');
  },

  /* The other half of an invitation: the person who has a link and no password. */
  'set-password · a live link shows whose account it is before anything is typed': async () => {
    table = { 'GET /api/auth/invite/t-ok': { valid: true, name: 'Probe Person', work_email: 'probe@oxp.com', expires_at: '2026-09-12T09:00:00Z' } };
    render({ at: ['/set-password?token=t-ok'], el: <SetPasswordPage /> });
    await settle();
    expect(has('Set your password'), 'the screen names itself');
    expect(has('probe@oxp.com') && has('Probe Person'), 'and shows which account the link belongs to');
    expect(has('Repeat it'), 'and the two boxes are the whole ask');
    const submit = byText('Set password and continue');
    expect(submit.disabled, 'nothing can be posted before the rules are met');
    const box = inputLike((i) => i.type === 'password');
    type(box, 'abc'); await settle(3);
    expect(byText('Set password and continue').disabled, 'a 3-character password stays refused');
    expect(has('at least 10 characters'), 'with the reason in words');
  },

  'set-password · a spent link explains itself and offers the way out': async () => {
    table = { 'GET /api/auth/invite/t-old': { valid: false, reason: 'This link has already been used. Ask your admin to send a new one.' } };
    render({ at: ['/set-password?token=t-old'], el: <SetPasswordPage /> });
    await settle();
    expect(has('already been used'), 'the API sentence is what the person reads');
    expect(has('Back to sign in'), 'with a way back to the login card');
    render({ at: ['/set-password'], el: <SetPasswordPage /> });
    await settle(4);
    expect(has('no invitation in it'), 'and an address with no token at all says so, rather than spinning');
  },

  /* Users page: one role, a link instead of a relayed password, the peer-admin rules made visible. */
  'users · one role per account, a link to set the password, no edits across admins': async () => {
    who.me = await meFor(['ADMIN']);
    table = { ...baseTable(),
      'GET /api/users': { rows: [
        { id: 'u1', name: 'Fresh Joiner', work_email: 'joiner@oxp.com', role: 'EMPLOYEE', roles: ['EMPLOYEE'], is_active: true, must_change_pw: true },
        { id: 'u2', name: 'Other Admin', work_email: 'admin2@oxp.com', role: 'ADMIN', roles: ['ADMIN'], is_active: true },
      ], total: 2 },
      'GET /api/employees': { rows: [], total: 0 } };
    render({ at: ['/settings/users'], el: <UsersPage /> });
    await settle();
    expect(has('must set a password'), 'the account that cannot sign in yet says why');
    expect(has('Send link'), 'and has a button that fixes it');
    expect(has('deactivate: self only'), 'a peer administrator is not deactivated from here');
    expect(has('pw: self only'), 'nor is their password reset from here');
    expect(has('link: self only'), 'and neither is a reset link mailed to them — a link is a password');
    click(byText('Send link')); await settle(4);
    expect(calls.some((c) => c.key === 'POST /api/users/u1/invite'), 'the button asks the API for an invitation');
  },

  /* The mail itself: sent by the request, one account at a time, and said that way. */
  'users · the link is mailed by the request and the page says so': async () => {
    who.me = await meFor(['ADMIN']);
    table = { ...baseTable(),
      'GET /api/users/invites/pending': { rows: [{ id: 'u1', name: 'Fresh Joiner', work_email: 'joiner@oxp.com' }, { id: 'u3', name: 'Another One', work_email: 'another@oxp.com' }], count: 2 },
      'GET /api/users': { rows: [{ id: 'u1', name: 'Fresh Joiner', work_email: 'joiner@oxp.com', role: 'EMPLOYEE', roles: ['EMPLOYEE'], is_active: true, must_change_pw: true }], total: 1 },
      'GET /api/employees': { rows: [], total: 0 },
      'POST /api/users/u1/invite': { link: 'http://localhost:5173/set-password?token=abc', token: 'abc', mail_sent: true, mail_queued: false, delivery_mode: 'sent-by-request', mail_driver: 'gmail', task_id: 12, how_it_is_delivered: 'Sent to joiner@oxp.com by this request via gmail — one message per account, no queue in between.', email: { ok: true, driver: 'gmail' } },
      'POST /api/users/invites/send-pending': { attempted: 2, sent: 1, failed: 1, took_ms: 4200, waiting_before: 2, results: [{ name: 'Fresh Joiner', work_email: 'joiner@oxp.com', ok: true, note: 'Sent via gmail' }, { name: 'Another One', work_email: 'another@oxp.com', ok: false, note: 'The mail server said: 550 too many recipients today', link: 'http://localhost:5173/set-password?token=def' }] } };
    render({ at: ['/settings/users'], el: <UsersPage /> });
    await settle();
    expect(has('Send links (2 waiting)'), 'the page counts who is waiting and offers to fix all of them');
    // The header button's label contains "Send link" too, so the row's own button is picked by exact text.
    const rowSend = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Send link');
    click(rowSend); await settle(4);
    expect(has('Sent to joiner@oxp.com by this request'), 'the panel repeats the server sentence about how it went');
    expect(has('no queue in between'), 'and says so in words, not by omission');
    expect(has('Logged as task'), 'the queue-table row is still mentioned, because the log lives there');
    click(byText('Send links (2 waiting)')); await settle(6);
    expect(calls.some((c) => c.key === 'POST /api/users/invites/send-pending'), 'the bulk press calls the one-by-one endpoint');
    expect(has('Set-password links, sent one by one'), 'and the report comes back per account');
    expect(has('sent') && has('not sent') && has('another@oxp.com'), 'with the failed row named, link included');
  },

  /* A refused delete that stays silent is the complaint; the reason belongs in the box, with the way out. */
  'crud · a refused delete keeps the dialog open, says who holds the row, offers deactivate': async () => {
    who.me = await meFor(['HR_MANAGER']);
    table = { ...baseTable(),
      'GET /api/meta': { leave_categories: [{ value: 'CASUAL', label: 'Casual' }, { value: 'PRIVILEGED', label: 'Privilege' }] },
      'GET /api/time-off/types': { rows: [{ id: 't1', name: 'Annual Leave', code: 'AL', category: 'PRIVILEGED', is_unpaid: false, is_active: 'ACTIVE', unit: 'DAYS', requires_allocation: true }] },
      'DELETE /api/time-off/types/t1': { __status: 409, __body: { error: { code: 'TYPE_IN_USE', message: 'Annual Leave is used by 3 requests and 1 allocation', details: { can_deactivate: true, refs: { requests: 3, allocations: 1 } } } } } };
    render({ at: ['/time-off/types'], el: <LeaveTypesPage /> });
    await settle();
    expect(has('Privilege'), 'the category is a column, not a memory test');
    // Two Delete buttons once the box is open — the row's and the footer's; the footer is the last one.
    const dels = [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === 'Delete');
    click(dels[0]); await settle(3);
    const inBox = [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === 'Delete').pop();
    click(inBox); await settle(4);
    expect(has('This record cannot be deleted'), 'the box changes into the explanation');
    expect(has('used by 3 requests'), 'with the API sentence about what holds it');
    expect(has('Deactivate instead'), 'and the way round');
  },

  'my time off · a failed picker is reported, not swallowed': async () => {
    who.me = await meFor(['EMPLOYEE']);
    table = { ...baseTable(),
      'GET /api/portal/time-off': { rows: [], total: 0 }, 'GET /api/portal/balances': [],
      'GET /api/time-off/types': { __status: 500, __body: { error: { message: 'Database is having a moment' } } } };
    render(EMPLOYEE_SELF);
    await settle();
    click(byText('Request leave')); await settle(4);
    expect(has('Choices failed to load') || has('Could not load your leave types'), 'a 500 must be visible in the control');
  },

  'payrun detail · per-person compute rows come from the run payload': async () => {
    who.me = await meFor(['HR_PAYROLL_MANAGER']);
    table = { ...baseTable(),
      'GET /api/payruns/p1': { id: 'p1', name: 'September 2026', status: 'COMPUTED', period_key: '2026-09', period_start: '2026-09-01',
        period_end: '2026-09-30', salary_structure: 'Standard', compute_mode: 'PRO_RATA', payslip_count: 2, total_gross: '124700.00',
        total_deductions: '4000.00', total_net: '120700.00', employer_cost: '140000.00', warning_count: 1, error_count: 1,
        employees: [
          { employee_id: 'e1', employee: 'Aarav Mehta', employee_code: 'EMP0042', department: 'Engineering', contract_id: 'c1', payslip_id: 's1',
            payslip_status: 'COMPUTED', compute_status: 'OK', gross_amount: '62350.00', total_deductions: '2000.00', net_amount: '60350.00',
            expected_working_days: 20, paid_days: 20, email_status: null },
          { employee_id: 'e2', employee: 'Diya Patel', employee_code: 'EMP0043', payslip_id: null, compute_status: 'ERROR',
            error_code: 'NO_CONTRACT', error_message: 'No contract covers this period for Diya Patel', contract_id: null },
        ], actions: { can_compute: true, can_validate: false, can_mark_paid: false, can_send: false } },
      'GET /api/payruns/p1/warnings': [{ payslip_id: 's1', employee: 'Aarav Mehta', severity: 'ERROR', rule_code: 'PF_CEILING', message: 'PF wage above the statutory ceiling — the excess is not contributed' }],
      'GET /api/payruns/p1/tasks': [], 'GET /api/payruns/p1/emails': [] };
    render({ at: ['/payruns/p1'], el: <Routes><Route path="/payruns/:id" element={<PayrunDetailPage />} /></Routes> });
    await settle(14);
    expect(has('Aarav Mehta'), 'the table must show the people in the run');
    expect(has('error · NO_CONTRACT'), 'and the reason the other one has no slip');
    expect(has('PF_CEILING'), 'the warning row should name the rule that raised it');
    expect(has('1 payslips blocked') || has('1 payslip blocked') || has('payslips with a flag'), 'the counters should say what they count');
    expect(!!byText('Only the 1 with problems'), 'and offer a filter to the broken row');
  },

  'payrun detail · compute says what it did': async () => {
    who.me = await meFor(['HR_PAYROLL_MANAGER']);
    table = { ...baseTable(),
      'GET /api/payruns/p1': { id: 'p1', name: 'September 2026', status: 'DRAFT', period_key: '2026-09', period_start: '2026-09-01',
        period_end: '2026-09-30', payslip_count: 0, total_net: '0.00', warning_count: 0, error_count: 0, employees: [], actions: { can_compute: true } },
      'GET /api/payruns/p1/warnings': [], 'GET /api/payruns/p1/tasks': [], 'GET /api/payruns/p1/emails': [],
      'POST /api/payruns/p1/compute': { results: [{ employee_id: 'e2', employee: 'Diya Patel', ok: false, error: 'No contract covers this period for Diya Patel', code: 'NO_CONTRACT' }], computed: 0, failed: 1 } };
    render({ at: ['/payruns/p1'], el: <Routes><Route path="/payruns/:id" element={<PayrunDetailPage />} /></Routes> });
    await settle(12);
    click(byText('Compute payslips')); await settle(10);
    expect(has('Nothing was computed'), 'a run where every person failed must not claim success');
    expect(has('NO_CONTRACT'), 'and should name the code');
  },

  'time-off types · a row can be switched off, not only deleted': async () => {
    who.me = await meFor(['ADMIN']);
    table = { ...baseTable(), 'GET /api/time-off/types': { rows: [{ id: 't1', name: 'Annual Leave', code: 'AL', unit: 'DAYS', is_active: 'ACTIVE', requires_allocation: true, max_days_per_year: 18 }] },
      'PATCH /api/time-off/types/t1': { id: 't1', name: 'Annual Leave', is_active: 'INACTIVE' } };
    render({ at: ['/time-off/types'], el: <LeaveTypesPage /> });
    await settle(10);
    expect(has('Annual Leave'), 'the list renders');
    const off = byText('Deactivate'); expect(!!off, 'there must be a Deactivate button on the row');
    click(off); await settle(4);
    expect(has('Deactivate this record?'), 'and a confirm that explains what it means');
    click(byText('Deactivate', 'button') && [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Deactivate').pop());
    await settle(8);
    const patch = calls.find((c) => c.key === 'PATCH /api/time-off/types/t1');
    expect(!!patch, 'the confirm should PATCH the flag only');
    expect(patch.body && patch.body.is_active === 'INACTIVE', 'with INACTIVE written');
  },

  'new employee · account and IFSC are checked before the request': async () => {
    who.me = await meFor(['HR_MANAGER']);
    table = { ...baseTable(), 'GET /api/org/departments': { rows: [] }, 'GET /api/org/working-schedules': { rows: [] }, 'GET /api/salary/structures': { rows: [] } };
    let closed = false;
    render({ at: ['/employees'], el: <EmployeeFormModal open onClose={() => { closed = true; }} onSaved={() => {}} departments={[]} schedules={[]} structures={[]} /> });
    await settle(8);
    click(byText('3 · Salary')); await settle(4);
    const pw = inputLike((i) => i.placeholder === '10+ characters');
    expect(!!pw, 'the login block shows its password rule before 10 characters');
    const ifsc = inputLike((i) => (i.placeholder || '').startsWith('HDFC0001234'));
    expect(!!ifsc, 'IFSC has an example placeholder');
    type(ifsc, 'hdfc-1234'); await settle(4);
    expect(ifsc.value === 'HDFC1234', 'the box cleans what you type');
    expect(has('4 letters, then 0, then 6 characters'), 'and says what the format is');
    click([...document.querySelectorAll('button')].find((b) => b.textContent.includes('Create employee'))); await settle(6);
    expect(has('Fix the highlighted fields'), 'saving with a bad IFSC is blocked here, not by a 400');
    expect(!calls.some((c) => c.key === 'POST /api/employees'), 'and nothing is sent');
    expect(closed === false, 'the dialog stays open');
  },

  'allocations · Assign balance opens from the types screen': async () => {
    who.me = await meFor(['ADMIN']);
    table = { ...baseTable(), 'GET /api/employees': { rows: [{ id: 'e1', name: 'Aarav Mehta', employee_code: 'EMP0042', department: 'Engineering' }], total: 1 },
      'GET /api/time-off/types': { rows: [{ id: 't1', name: 'Annual Leave', requires_allocation: true, unit: 'DAYS', is_active: 'ACTIVE' }] },
      'GET /api/time-off/allocations': { rows: [], total: 0 } };
    render({ at: ['/time-off/allocations?assign=t1'], el: <AllocationsPage /> });
    await settle(12);
    expect(has('Assign balance to many'), 'the panel exists on the Allocations screen');
    expect(has('Days granted'), 'with a days field');
    expect(has('Skip it'), 'and a rule for people who already have a grant');
    expect(has('Aarav Mehta'), 'the people come from the same list the requests screen filters');
  },

  'payslips · the register offers a bulk mail, and asks for a scope': async () => {
    who.me = await meFor(['HR_PAYROLL_MANAGER']);
    table = { ...baseTable(),
      'GET /api/payslips': { rows: [{ id: 's1', employee: 'Aarav Mehta', employee_code: 'EMP0042', period_key: '2026-09', status: 'PAID',
        gross_amount: '62350.00', net_amount: '60350.00', total_deductions: '2000.00', email_status: 'SENT', document_version: 1 }], total: 1 },
      'GET /api/payruns': { rows: [{ id: 'p1', name: 'September 2026', period_key: '2026-09', status: 'PAID' }], total: 1 } };
    render({ at: ['/payslips'], el: <PayslipsPage /> });
    await settle(12);
    const bulk = byText('E-mail payslips…'); expect(!!bulk, 'a payroll manager sees the bulk action');
    click(bulk); await settle(4);
    expect(has('E-mail payslips in bulk'), 'the dialog explains the unit of work');
    click([...document.querySelectorAll('button')].find((b) => b.textContent.includes('Queue the send'))); await settle(6);
    expect(has('Pick a payrun or a period first'), 'with no scope it refuses instead of mailing the world');
    expect(!calls.some((c) => c.key === 'POST /api/payslips/send'), 'and sends nothing');
  },

  'login · the payroll-admin button types the address the seeder creates': async () => {
    who.me = await meFor(['HR_PAYROLL_MANAGER']);
    table = { ...baseTable() };
    render({ at: ['/login'], el: <LoginPage /> });
    await settle(6);
    click(byText('Admin (second)')); await settle(3);
    const email = inputLike((i) => i.type === 'email' || (i.attributes.get('autocomplete') === 'username'));
    expect(!!email, 'the login card has an email box');
    expect(email.value === 'payroll-admin@oxp.com', `the button must fill payroll-admin@oxp.com (got ${email.value})`);
    expect(text().includes('hr2@oxp.com'), 'every seeded staff login is offered, including hr2');
  },

  'session · a 401 rotates the cookie and replays the call once': async () => {
    let tries = 0;
    let refreshed = 0;
    const real = window.fetch;
    window.fetch = async (url, init = {}) => {
      const path = String(url).split('?')[0];
      const method = (init.method || 'GET').toUpperCase();
      if (method === 'POST' && path === '/api/auth/refresh') {
        refreshed += 1;
        localStorage.setItem('pp360.token', 'fresh.jwt');
        return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ token: 'fresh.jwt' }), json: async () => ({ token: 'fresh.jwt' }) };
      }
      if (path === '/api/notifications') {
        tries += 1;
        if (tries === 1) return { ok: false, status: 401, headers: new Headers(), text: async () => JSON.stringify({ error: { message: 'expired' } }), json: async () => ({ error: { message: 'expired' } }) };
        return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ rows: [], unread: 2 }), json: async () => ({ rows: [], unread: 2 }) };
      }
      return real(url, init);
    };
    localStorage.setItem('pp360.token', 'stale.jwt');
    const out = await api.get('/notifications');
    window.fetch = real;
    expect(out.unread === 2, 'the replayed call should have answered');
    expect(refreshed === 1, 'the cookie is rotated exactly once per burst');
    expect(tries === 2, 'and the failed call is tried again, not handed to the user as an error');
    expect(localStorage.getItem('pp360.token') === 'fresh.jwt', 'the new token is stored');
  },

  'session · a dead refresh signs out instead of looping': async () => {
    let gets = 0; let posts = 0; let kicked = 0;
    const real = window.fetch;
    window.fetch = async (url, init = {}) => {
      const path = String(url).split('?')[0];
      const method = (init.method || 'GET').toUpperCase();
      if (method === 'POST' && path === '/api/auth/refresh') { posts += 1; } else { gets += 1; }
      return { ok: false, status: 401, headers: new Headers(), text: async () => JSON.stringify({ error: { message: 'revoked' } }), json: async () => ({ error: { message: 'revoked' } }) };
    };
    setUnauthorizedHandler(() => { kicked += 1; });
    let failed = null;
    try { await api.get('/notifications'); } catch (e) { failed = e; }
    setUnauthorizedHandler(null);
    window.fetch = real;
    expect(gets === 1, `the request must not be replayed after a failed refresh (saw ${gets} attempts)`);
    expect(posts === 1, 'the refresh is attempted once');
    expect(failed && failed.status === 401, 'the caller still sees the 401');
    expect(kicked === 1, 'and the app is told to sign out');
  },

  'account menu · change password checks the two boxes before asking the API': async () => {
    who.me = { ...(await meFor(['HR_MANAGER'])), mustChangePassword: true };
    table = { ...baseTable(), 'GET /api/notifications': { rows: [], unread: 0 } };
    render({ at: ['/employees'], el: <Topbar /> });
    await settle(10);
    expect(has('You are still on the password'), 'a forced password change is announced');
    click(byText('Probe Person')); await settle(3);
    const item = byText('Change password');
    expect(!!item, 'the account menu offers it');
    click(item); await settle(4);
    const boxes = [...document.querySelectorAll('input[type=password]')];
    expect(boxes.length >= 3, `the dialog has current + two new boxes (found ${boxes.length})`);
    type(boxes[0], 'Password@123'); await settle(2);
    type(boxes[1], 'FreshPass@2026'); await settle(2);
    type(boxes[2], 'FreshPass@2027'); await settle(3);
    expect(has('do not match'), 'mismatch is caught here');
    click([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Change password' && b.closest('[role=dialog], .fixed')));
    await settle(4);
    expect(!calls.some((c) => c.key === 'POST /api/auth/change-password'), 'and nothing is sent while it is wrong');
  },

};

let fails = 0;
const out = [];
function expect(cond, msg) { if (!cond) throw new Error(msg); }

window.__runProbe = async () => {
  for (const [name, fn] of Object.entries(CASES)) {
    calls = [];
    try { await fn(); out.push(`  ok   ${name}`); }
    catch (e) { fails += 1; out.push(`  FAIL ${name}\n         ${e.message}`); }
    finally { try { root && root.unmount(); } catch {} document.body.innerHTML = ''; }
  }
  out.push(fails ? `\n${fails} of ${Object.keys(CASES).length} cases failed` : `\nall ${Object.keys(CASES).length} probe cases clean`);
  return out.join('\n');
};
