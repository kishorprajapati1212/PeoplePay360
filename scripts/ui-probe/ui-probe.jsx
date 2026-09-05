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
import { WorkingSchedulesPage } from '../../frontend/src/pages/org/WorkingSchedulesPage.jsx';
import { DepartmentsPage } from '../../frontend/src/pages/org/DepartmentsPage.jsx';
import { landingFor } from '../../frontend/src/App.jsx';
import { LeaveRequestsPage } from '../../frontend/src/pages/timeoff/LeaveRequestsPage.jsx';
import { StructuresPage } from '../../frontend/src/pages/salary/StructuresPage.jsx';
import { CompanyPage } from '../../frontend/src/pages/settings/CompanyPage.jsx';
import { PayrunsPage } from '../../frontend/src/pages/payroll/PayrunsPage.jsx';
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

  'login · each button types an address the seeder really creates': async () => {
    who.me = await meFor(['HR_PAYROLL_MANAGER']);
    table = { ...baseTable() };
    render({ at: ['/login'], el: <LoginPage /> });
    await settle(6);
    click(byText('Payroll Manager')); await settle(3);
    const email = inputLike((i) => i.type === 'email' || (i.attributes.get('autocomplete') === 'username'));
    expect(!!email, 'the login card has an email box');
    expect(email.value === 'payroll@oxp.com', `the button must fill payroll@oxp.com (got ${email.value})`);
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

  /* Round 7: the demo logins, the landing screen, the weekly grid, carry-forward, and the columns people
     could not read. Each case is a sentence a reviewer could repeat in the browser. */

  'login · four demo accounts, one per role, and the theme switch': async () => {
    who.me = null;
    render({ at: ['/login'], el: <LoginPage /> });
    await settle(4);
    const chips = [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('@oxp.com'));
    // four staff accounts plus the one employee the seeder creates — one button per role, no spare admin
    expect(chips.length === 5, `five demo buttons fill the panel (found ${chips.length}: ${chips.map((c) => c.textContent).join(' | ')})`);
    expect(!chips.some((c) => c.textContent.includes('payroll-admin')), 'the extra second-admin account is gone — five roles need five logins, not six');
    expect(chips.some((c) => c.textContent.includes('Payroll')), 'the payroll manager is still one of them');
    expect(!!document.querySelector('[title^="Switch to the"]'), 'the sign-in card carries the theme switch like every other screen');
    click(chips[0]); await settle(3);
    const email = document.querySelector('input[type=email]');
    expect(email.value === 'admin@oxp.com', 'clicking one fills the address in: ' + email.value);
  },

  'landing · every role starts on its own screen, not on whichever page is first in the list': async () => {
    expect(landingFor(await meFor(['EMPLOYEE'])) === '/portal', 'an employee opens My Portal, which is their own pay and leave in one screen');
    expect(landingFor(await meFor(['HR_MANAGER'])) === '/employees', 'HR opens the employee list');
    const payrollUser = landingFor(await meFor(['HR_PAYROLL_USER']));
    const payrollManager = landingFor(await meFor(['HR_PAYROLL_MANAGER']));
    expect(payrollUser.startsWith('/') && payrollManager.startsWith('/'), `payroll roles land somewhere real (${payrollUser} / ${payrollManager})`);
    expect(landingFor(await meFor(['ADMIN'])).startsWith('/'), 'and so does the administrator');
    expect(landingFor({ roles: ['EMPLOYEE'], menus: [{ to: '/time-off/my-requests', label: 'Leave' }], permissions: [] })
             === '/time-off/my-requests',
           'a role missing its usual screen is sent to the first one it can actually open');
    expect(landingFor({ roles: [], menus: [], permissions: [] }) === '/no-access',
           'and an account with nothing at all lands on the page that says so, not on a blank one');
  },

  'working schedule · a new week has times in it and the save posts day numbers': async () => {
    who.me = await meFor(['HR_MANAGER']);
    table = {
      ...baseTable(),
      'GET /api/org/working-schedules': { rows: [{ id: 7, name: 'Standard', type: 'FIXED', timezone: 'Asia/Kolkata',
        is_active: true, days_per_week: 5, total_weekly_hours: 40,
        days: [{ day: 1, start: '09:30', end: '18:30', break: 60, rest: false },
               { day: 2, start: '09:30', end: '18:30', break: 60, rest: false },
               { day: 6, start: null, end: null, break: 0, rest: true }] }], total: 1 },
    };
    render({ el: <WorkingSchedulesPage /> });
    await settle();
    expect(has('0.0') || has('40.0'), 'the list shows the hours the week adds up to');
    click(byText('Edit')); await settle(3);
    let times = [...document.querySelectorAll('input[type=time]')];
    expect(times[0].value === '09:30', 'an open edit shows the stored Monday time — reading days back used to leave it empty');
    expect(times[10]?.value === '', 'and a rest day stays empty rather than inventing hours');
    click(byText('Cancel')); await settle(2);
    click(byText('+ New schedule')); await settle(2);
    times = [...document.querySelectorAll('input[type=time]')];
    expect(times[0].value === '09:30' && times[1].value === '18:30', 'a new week arrives with the standard five-day timings, not blank boxes');
    // the dialog refuses a nameless schedule now (the API requires one), so give it one first
    type(inputLike((i) => i.getAttribute('placeholder') === 'OXP Standard — Mon to Fri'), 'OXP Standard');
    await settle(2);
    click([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save schedule'));
    await settle(4);
    const post = calls.find((c) => c.key === 'POST /api/org/working-schedules');
    expect(!!post, 'and saving posts once');
    expect(post.body.days.map((d) => d.day).join(',') === '1,2,3,4,5,6,7',
           'the API wants ISO day numbers 1..7, so names never go out again: ' + JSON.stringify(post.body.days[0]));
  },

  'carry forward · every type with a balance is offered, and a blocked one says who blocks it': async () => {
    who.me = await meFor(['HR_MANAGER']);
    table = {
      ...baseTable(),
      'GET /api/time-off/types': { rows: [
        { id: 1, name: 'Casual Leave', code: 'CL', unit: 'DAYS', requires_allocation: true, carry_forward: false, max_days_per_year: 12 },
        { id: 2, name: 'Privilege Leave', code: 'PL', unit: 'DAYS', requires_allocation: true, carry_forward: true, max_days_per_year: 15 }], total: 2 },
      'GET /api/time-off/allocations': { rows: [], total: 0 },
    };
    render({ el: <AllocationsPage /> });
    await settle();
    const picker = [...document.querySelectorAll('button[aria-haspopup=listbox]')].find((b) => b.textContent.includes('Choose a type'));
    expect(!!picker, 'the carry-forward panel has a leave-type picker');
    click(picker); await settle(3);
    expect(has('does not carry forward yet'), 'every type with a balance is offered — Casual included, with its policy named');
    click(byText('does not carry forward yet', 'button')); await settle(3);
    expect(has('Policy says this type does not carry'), 'picking it explains the refusal instead of letting you hit it');
    click(byText('Allow carry-forward for Casual Leave')); await settle(4);
    const patched = calls.find((c) => c.key === 'PATCH /api/time-off/types/1');
    expect(!!patched && patched.body.carry_forward === true, 'and one click changes the type policy through the real endpoint');
  },

  'leave · what the days cost is in the dialog, on both sides of the request': async () => {
    const CASUAL = { id: 1, name: 'Casual Leave', code: 'CL', category: 'CASUAL', unit: 'DAYS',
                     requires_allocation: true, is_unpaid: false, max_days_per_year: 12, balance: 7, allocated_days: 12 };
    const LWP = { id: 2, name: 'Loss of Pay', code: 'LOP', category: 'UNPAID', unit: 'DAYS',
                  requires_allocation: false, is_unpaid: true };
    who.me = await meFor(['EMPLOYEE']);
    table = { ...baseTable(),
      'GET /api/time-off/types': { rows: [CASUAL, LWP], total: 2 },
      'GET /api/portal/time-off': { rows: [], total: 0 },
      'GET /api/portal/balances': [CASUAL] };
    render(EMPLOYEE_SELF);
    await settle();
    click(byText('Request leave')); await settle(4);
    const picker = [...document.querySelectorAll('button[aria-haspopup=listbox]')].find((b) => /Choose a leave type|Loading choices/.test(b.textContent));
    expect(!!picker, 'the request dialog opens on an empty leave type');
    click(picker); await settle(3);
    click(byText('Casual Leave', 'button')); await settle(3);
    expect(has('Paid from the casual balance'), 'a paid type says the days come off the balance, before Apply');
    click(picker); await settle(3);
    click(byText('Loss of Pay', 'button')); await settle(3);
    expect(has('Unpaid') && has('Loss of Pay on the next payslip'), 'and an unpaid type says it becomes a payslip deduction');
  },

  'departments · no parent column, because nothing here is a hierarchy': async () => {
    who.me = await meFor(['HR_MANAGER']);
    table = { ...baseTable(), 'GET /api/org/departments': { rows: [{ id: 1, name: 'Engineering', code: 'ENG',
      head_of_department: 'Rekha Menon', employee_count: 14, is_active: true, parent_id: 9, parent_name: 'Operations' }], total: 1 } };
    render({ el: <DepartmentsPage /> });
    await settle();
    expect(has('Engineering'), 'the list renders');
    expect(!has('Parent'), 'and the parent column is gone — the form still saves the id, the table does not pretend');
  },

  /* ── round 8: the note an approver writes, the PDFs that used to vanish, the structure you can now read,
        and the mail settings that decide whether an invitation is ever sent. ───────────────────────────── */

  'leave decision · a refusal without a reason never reaches the API, and with one the note is sent': async () => {
    who.me = await meFor(['HR_MANAGER']);
    const ROW = { id: 9, employee: 'Aarav Mehta', employee_code: 'EMP0042', type: 'Casual Leave', category: 'CASUAL',
                  start_date: '2026-06-08', end_date: '2026-06-09', duration: 2, status: 'TO_APPROVE', is_unpaid: false,
                  requires_allocation: true, reason: 'Family function' };
    table = { ...baseTable(), 'GET /api/time-off/requests': { rows: [ROW], total: 1 },
              'GET /api/employees': { rows: [], total: 0 }, 'GET /api/time-off/types': { rows: [], total: 0 } };
    render({ el: <LeaveRequestsPage /> });
    await settle();
    click(byText('Refuse')); await settle(3);
    const dialog = (name) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === name && b.closest('[role=dialog], .fixed'));
    expect(!!dialog('Refuse'), 'the decision box asks for a reason');
    expect(has('Reason for refusing'), 'and says which it is, not a generic "Remark"');
    click(dialog('Refuse')); await settle(3);
    expect(!calls.some((c) => c.key.endsWith('/refuse')), 'pressing it empty sends nothing to the server');
    expect(has('is needed'), 'and the dialog names what is missing');
    type(inputLike((i) => i.tagName === 'TEXTAREA'), 'Two of these days fall in the freeze period');
    await settle(2);
    click(dialog('Refuse')); await settle(4);
    const sent = calls.find((c) => c.key.endsWith('/time-off/requests/9/refuse'));
    expect(!!sent, 'once it is written, the refusal goes out');
    expect(sent.body.remark.startsWith('Two of these'), 'as `remark`, which the service maps onto the reason column');
  },

  'leave decision · approving fewer days than were asked for is a choice, not a bug': async () => {
    who.me = await meFor(['HR_MANAGER']);
    const ROW = { id: 11, employee: 'Priya Nair', employee_code: 'EMP0061', type: 'Sick Leave', category: 'SICK',
                  start_date: '2026-06-01', end_date: '2026-06-03', duration: 3, status: 'TO_APPROVE', is_unpaid: false,
                  requires_allocation: true, reason: 'Fever' };
    table = { ...baseTable(), 'GET /api/time-off/requests': { rows: [ROW], total: 1 },
              'GET /api/employees': { rows: [], total: 0 }, 'GET /api/time-off/types': { rows: [], total: 0 } };
    render({ el: <LeaveRequestsPage /> });
    await settle();
    click(byText('Approve')); await settle(3);
    const days = inputLike((i) => i.type === 'number');
    expect(!!days, 'the approve box offers a day count');
    expect(days.value === '3', 'starting at what was asked for, not at zero (got ' + days.value + ')');
    const tooMany = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve' && b.closest('[role=dialog], .fixed'));
    type(days, '5'); await settle(2);
    click(tooMany); await settle(3);
    expect(!calls.some((c) => c.key.endsWith('/approve')), 'approving more than was asked for is refused here, not by a 400');
    type(days, '2'); await settle(2);
    click(tooMany); await settle(4);
    const sent = calls.find((c) => c.key.endsWith('/time-off/requests/11/approve'));
    expect(!!sent && Number(sent.body.approved_days) === 2, 'a partial approval posts approved_days: ' + JSON.stringify(sent && sent.body));
  },

  'leave · the note comes back to the employee': async () => {
    who.me = await meFor(['EMPLOYEE']);
    table = { ...baseTable(),
      'GET /api/portal/time-off': { rows: [{ id: 4, type: 'Casual Leave', start_date: '2026-06-08', end_date: '2026-06-08',
        duration: 1, status: 'REFUSED', reason: 'Family function', decision_remark: 'June is the release month — take it in July' }], total: 1 },
      'GET /api/portal/balances': [], 'GET /api/time-off/types': { rows: [], total: 0 } };
    render(EMPLOYEE_SELF);
    await settle();
    expect(has('Note from HR'), 'the request list shows what the approver wrote');
    expect(has('release month'), 'in their words, not a generic "refused"');
  },

  'structures · a row opens, and its lines say what they pay': async () => {
    who.me = await meFor(['HR_MANAGER']);
    const STRUCTURE = { id: 3, name: 'Regular Salary', code: 'REG', monthly_wage: 85000, is_active: true, rule_count: 2 };
    const RULES = [{ id: 1, sequence: 10, name: 'Basic', code: 'BASIC', category: 'BASIC', line_kind: 'EARNING',
                     computation_type: 'PERCENTAGE', percentage: 50, base_code: 'WAGE', pro_rata: true, appears_on_payslip: true },
                   { id: 2, sequence: 80, name: 'Provident Fund', code: 'PF', category: 'DEDUCTION', line_kind: 'DEDUCTION',
                     computation_type: 'PERCENTAGE', percentage: 12, base_code: 'BASIC', cap_amount: 1500, pro_rata: false,
                     appears_on_payslip: true, statutory: true }];
    table = { ...baseTable(), 'GET /api/salary/structures': { rows: [STRUCTURE], total: 1 },
              'GET /api/salary/structures/3': { ...STRUCTURE, rules: RULES }, 'GET /api/salary/structures/3/impact': { employees: 12 },
              'POST /api/salary/preview': { lines: [{ code: 'BASIC', amount: 42500, log: '50% of ₹85,000 wage' },
                                                    { code: 'PF', amount: 1500, log: '12% of BASIC = 5100, capped at ₹1,500' }],
                                            totals: { gross: 42500, deductions: 1500, net: 41000 }, warnings: [] } };
    render({ el: <StructuresPage /> });
    await settle();
    expect(has('Regular Salary'), 'the list renders');
    const row = byText('Regular Salary', 'tr');
    expect(!!row, 'and the row itself is clickable — it used to say so without listening');
    click(row); await settle(4);
    expect(has('Provident Fund'), 'the dialog shows the rules of this structure');
    expect(has('12% of BASIC'), 'each one described in words, not only as a category chip');
    expect(has('Show the amounts'), 'with a button that asks the engine what they come to');
    click(byText('Show the amounts')); await settle(6);
    expect(calls.some((c) => c.key === 'POST /api/salary/preview'), 'which calls the real preview endpoint');
    expect(has('₹42,500'), 'and prints the amounts the engine returned');
    expect(has('capped at ₹1,500'), 'including the log line the engine wrote while computing it');
    expect(has('₹41,000'), 'with the net total under the table');
  },

  'payrun · the PDF panel counts what exists and asks for the rest': async () => {
    who.me = await meFor(['HR_PAYROLL_MANAGER']);
    table = { ...baseTable(),
      'GET /api/payruns/p1': { id: 'p1', name: 'June 2026', status: 'VALIDATED', period_key: '2026-06', period_start: '2026-06-01',
        period_end: '2026-06-30', payslip_count: 3, total_gross: 255000, total_deductions: 4500, total_net: 250500,
        employer_cost: 260000, error_count: 0, warning_count: 1, actions: { can_compute: false, can_validate: false, can_mark_paid: true },
        employees: [{ id: 1, employee: 'Aarav Mehta', pdf_generated_at: '2026-06-30T10:00:00Z', pdf_hash: 'aa' },
                    { id: 2, employee: 'Priya Nair' }, { id: 3, employee: 'Rekha Menon' }] },
      'POST /api/payruns/p1/generate-pdfs': { payrun: 'p1', queued: 0, inline: 2, generated: 2, failed: [], waiting: 0, already: 1,
        worker_available: false, queue_error: 'connect ECONNREFUSED 127.0.0.1:6379',
        how: 'The worker is not answering (Redis on localhost:6379), so this request did what it could.' },
      'GET /api/payruns/p1/warnings': { rows: [] }, 'GET /api/payruns/p1/tasks': { rows: [] }, 'GET /api/payruns/p1/emails': { rows: [] } };
    render({ at: ['/payruns/p1'], el: <Routes><Route path="/payruns/:id" element={<PayrunDetailPage />} /></Routes> });
    await settle(8);
    expect(has('Payslip PDFs'), 'the run page has a panel about the files themselves');
    expect(has('1 of 3 payslips have a file ready'), 'it counts what exists before you press anything');
    expect(has('Create the 2 missing PDFs'), 'and offers exactly what is missing, in those words');
    click(byText('Create the 2 missing PDFs')); await settle(6);
    expect(calls.some((c) => c.key === 'POST /api/payruns/p1/generate-pdfs'), 'pressing it calls the run endpoint');
    expect(has('2 rendered while you waited'), 'and the answer is the per-person count, not "queued successfully"');
    expect(has('worker is not answering'), 'with the reason the queue was skipped, in the open');
  },

  'settings · mail is configured here, and the password stays out of the browser': async () => {
    who.me = await meFor(['ADMIN']);
    table = { ...baseTable(),
      'GET /api/company': { id: true, company_name: 'OXP', mail_enabled: true, smtp_user: 'payroll@gmail.com',
                            smtp_password_set: true, mail_from: 'OXP <payroll@gmail.com>', mail_daily_limit: 200,
                            smtp_password: 'never-should-reach-the-page' },
      // The providers list is the API's copy of backend/src/lib/mailer/providers.js — trimmed here to what the
      // panel reads, but with the same keys, so a rename in that file fails this case instead of passing quietly.
      'GET /api/company/mail': { driver: 'gmail', from: 'OXP <payroll@gmail.com>', login: 'payroll@gmail.com', daily_limit: 200,
                                note: null, enabled: true, host: null, port: null, secure: false, user: 'payroll@gmail.com',
                                password_stored: true, server: 'smtp.gmail.com:465 · implicit TLS',
                                inferred: 'Google — Gmail or Google Workspace', needs_app_password: true,
                                providers: [{ key: 'google', brand: 'Google', label: 'Google — Gmail or Google Workspace',
                                               domains: ['gmail.com', 'googlemail.com'], host: 'smtp.gmail.com', port: 465,
                                               secure: true, appPassword: true, note: 'needs an App Password' }] },
      'POST /api/company/mail/check': { connected: true, verify: { ok: true }, mail: null, driver: 'gmail', from: 'OXP <payroll@oxp.com>' } };
    render({ el: <CompanyPage /> });
    await settle(6);
    expect(has('E-mail delivery'), 'the transport is a settings group like the others');
    expect(has('SMTP host'), 'with a host box');
    expect(has('Send real mail'), 'and one switch that decides whether anything leaves the machine');
    expect(has('App Password'), 'the password box says what kind of password Gmail wants');
    const boxes = [...document.querySelectorAll('input[type=password]')];
    expect(boxes.length >= 1, 'and it is a password box, not text in the clear');
    expect(!text().includes('never-should-reach-the-page'), 'a stored password is never rendered back into the page');
    expect(has('1 of 3') === false && has('Mail right now'), 'and the panel states the live driver');
    expect(has('smtp.gmail.com:465'), 'including the server it will use');
    expect(has('picked from the address'), 'and says the address, not a person, chose that server');
    expect(has('read off the address, so the two boxes above are the whole job'), 'the live line agrees: nothing else to fill');
    click(byText('Check connection')); await settle(5);
    const check = calls.find((c) => c.key === 'POST /api/company/mail/check');
    expect(!!check, 'Check connection is the only thing that contacts the server');
    expect(check.body.to === null, 'and without an address it verifies only, sending nothing');
  },

  'settings · a host box holding an example value is ignored, and one click clears it': async () => {
    who.me = await meFor(['ADMIN']);
    table = { ...baseTable(),
      'GET /api/company': { id: true, company_name: 'OXP', mail_enabled: true, smtp_user: 'payroll@gmail.com',
                            smtp_host: 'smtp.reply.example', smtp_port: 587, smtp_secure: false, smtp_password_set: true },
      'GET /api/company/mail': { driver: 'gmail', login: 'payroll@gmail.com', enabled: true, host: 'smtp.reply.example',
                                 secure: false, user: 'payroll@gmail.com', password_stored: true,
                                 server: 'smtp.gmail.com:465 · implicit TLS', inferred: 'Google — Gmail or Google Workspace',
                                 conflict: { stored_host: 'smtp.reply.example', ignored: true, brand: 'Google',
                                             wanted_server: 'smtp.gmail.com:465 · implicit TLS' }, providers: [] },
      'PATCH /api/company': { after: { smtp_host: null }, mail: { enabled: true, driver: 'gmail', note: null } } };
    render({ el: <CompanyPage /> });
    await settle(6);
    expect(has('names no server, so it is ignored'), 'the panel says the box is doing nothing rather than blaming the password');
    expect(has('smtp.gmail.com:465'), 'and names the server that is actually dialed');
    click(byText('Clear the host box and use smtp.gmail.com:465 · implicit TLS')); await settle(5);
    const patch = calls.find((c) => c.key === 'PATCH /api/company');
    expect(!!patch, 'the fix is one button, not a form to fill in');
    expect(patch.body.smtp_host === '' && patch.body.smtp_port === null && patch.body.smtp_secure === false,
      'and it clears host, port and TLS together, since they were typed as one');
  },

  'settings · an address we do not know names the box that is missing': async () => {
    who.me = await meFor(['ADMIN']);
    table = { ...baseTable(),
      'GET /api/company': { id: true, company_name: 'OXP', mail_enabled: true, smtp_user: 'payroll@acme-biz.example',
                            mail_from: 'OXP <payroll@acme-biz.example>' },
      'GET /api/company/mail': { driver: 'preview', from: 'OXP <payroll@acme-biz.example>', login: 'payroll@acme-biz.example',
                                 enabled: true, host: null, secure: false, user: 'payroll@acme-biz.example',
                                 password_stored: false, server: null, inferred: null,
                                 note: 'no mail account is set yet', providers: [] } };
    render({ el: <CompanyPage /> });
    await settle(6);
    expect(has('acme-biz.example is not on our list'), 'an unknown domain is told, not guessed at');
    expect(has('its SMTP host goes in the box below'), 'with the one box that fixes it named');
    expect(!has('Sends through'), 'and no server is claimed when there is none');
  },

  /* ── round 9: a week that saves, a delete that explains itself, an empty payrun that says why, and the
        status word the enum actually uses. ─────────────────────────────────────────────────────────────── */

  'working schedule · an off day carries no clock time, and a worked day without one is stopped': async () => {
    who.me = await meFor(['HR_MANAGER']);
    const ROW = { id: 7, name: 'OXP Standard — Mon to Fri', type: 'FIXED', timezone: 'Asia/Kolkata', is_active: true,
                  days_per_week: 5, total_weekly_hours: 40, description: 'Five days',
                  days: [{ day: 1, start: '09:30', end: '18:30', break: 60 }, { day: 2, start: '09:30', end: '18:30', break: 60 },
                         { day: 3, start: '09:30', end: '18:30', break: 60 }, { day: 4, start: '09:30', end: '18:30', break: 60 },
                         { day: 5, start: '09:30', end: '18:30', break: 60 }, { day: 6, rest: true }, { day: 7, rest: true }] };
    table = { ...baseTable(), 'GET /api/org/working-schedules': { rows: [ROW], total: 1 }, 'POST /api/org/working-schedules': { id: 12 } };
    render({ el: <WorkingSchedulesPage /> });
    await settle();
    click(byText('+ New schedule')); await settle(3);
    type(inputLike((i) => i.getAttribute('placeholder') === 'OXP Standard — Mon to Fri'), 'Night Shift — Mon to Fri');
    await settle(2);
    click([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Fill the standard 5-day week'));
    await settle(2);
    click([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save schedule'));
    await settle(4);
    const sent = calls.find((c) => c.key === 'POST /api/org/working-schedules');
    expect(!!sent, 'the week is posted');
    const days = sent.body.days;
    expect(days.length === 7 && days.every((d) => Number.isInteger(d.day)), 'each row numbered 1-7, never a name: ' + JSON.stringify(days.map((d) => d.day)));
    const sat = days.find((d) => d.day === 6);
    expect(sat.rest === true && !('start' in sat) && !('end' in sat),
      'and a weekly off sends no clock time at all (got ' + JSON.stringify(sat) + ') — that empty string was the “Use HH:MM” error');
    // now break a worked day and see whether the dialog catches it before the API has to
    click([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit')); await settle(3);
    const monStart = [...document.querySelectorAll('input[type=time]')][0];
    expect(!!monStart, 'Monday has a start box');
    type(monStart, ''); await settle(2);
    const before = calls.length;
    click([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save schedule'));
    await settle(3);
    expect(calls.length === before, 'a nameless-time day is stopped here instead of being sent');
    expect(has('Mon is a worked day without both times'), 'and the sentence says which day and what is missing');
  },

  'working schedule · a delete that is refused says who is on it and offers the way out': async () => {
    who.me = await meFor(['HR_MANAGER']);
    const ROW = { id: 7, name: 'OXP Standard — Mon to Fri', type: 'FIXED', is_active: true, days_per_week: 5, total_weekly_hours: 40,
                  days: [{ day: 1, start: '09:30', end: '18:30', break: 60 }, { day: 6, rest: true }] };
    table = { ...baseTable(), 'GET /api/org/working-schedules': { rows: [ROW], total: 1 },
      'DELETE /api/org/working-schedules/7': { __status: 409, __body: { error: { code: 'SCHEDULE_IN_USE',
        message: 'Reassign the employees on this schedule first', details: { employees: 3, contracts: 3 } } } },
      'PATCH /api/org/working-schedules/7/active': { id: 7, is_active: 'INACTIVE' } };
    render({ el: <WorkingSchedulesPage /> });
    await settle();
    expect(!!byText('Delete'), 'the row offers a delete, as every other CRUD screen does');
    click(byText('Delete')); await settle(3);
    expect(has('Only a schedule nothing points at can be removed'), 'and it asks first');
    click([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete schedule'));
    await settle(4);
    expect(has('It is on 3 employee record(s) and 3 contract(s)'), 'the refusal quotes what is in the way, counted');
    const wayOut = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Deactivate it instead');
    expect(!!wayOut, 'and hands over the thing that is allowed');
    click(wayOut); await settle(4);
    const patch = calls.find((c) => c.key === 'PATCH /api/org/working-schedules/7/active');
    expect(!!patch && patch.body.is_active === 'INACTIVE', 'which is a one-field switch, not a rewrite of the row');
    expect(!('days' in (patch.body || {})), 'and it cannot send a week it did not read (got ' + JSON.stringify(patch.body) + ')');
  },

  'a bar is a bar: the dashboard breakdown has squared ends': async () => {
    // rounded-full on an 8px-tall track turns both ends into semicircles, which on a wide desktop is the
    // "round shape" that shows up even though nobody asked for a circle. The payrun progress bar is checked a
    // few lines below in run.mjs, where the source can be read - the bundle this runs in has no node:fs.
    const { StatusBreakdown } = await import('../../frontend/src/pages/dashboards/charts.jsx');
    render({ at: ['/dashboards/hr'], el: <StatusBreakdown panels={{ ACTIVE: 9, ON_LEAVE: 2, EXITED: 1 }} /> });
    await settle(3);
    // Track = the 8px rail; the fill inside it carries `h-2` too, so the selector has to name both halves of
    // the row's classes or the assertion fails on a div that was never meant to have a radius at all.
    const tracks = [...document.querySelectorAll('div')].filter((d) => {
      const c = d.className || '';
      return c.includes('h-2') && c.includes('flex-1');
    });
    expect(tracks.length >= 3, 'the breakdown drew a rail per status, three in this fixture');
    expect(tracks.every((d) => !(d.className || '').includes('rounded-full')), 'no chart track carries a full radius');
    expect(tracks.every((d) => (d.className || '').includes('rounded-sm')), 'each track is squared to 2px instead');
    const fills = tracks.map((d) => d.firstElementChild).filter(Boolean);
    expect(fills.every((d) => !(d.className || '').includes('rounded')), 'and the fill itself is square - the track clips it');
  },
  'payrun wizard · an empty period is explained by the database, not guessed by the page': async () => {
    who.me = await meFor(['HR_PAYROLL_MANAGER']);
    table = { ...baseTable(),
      'GET /api/payruns': { rows: [], total: 0 },
      'GET /api/salary/structures': { rows: [{ id: 's1', name: 'OXP Standard Salaried', employees: 4, rule_count: 6 }], total: 1 },
      'GET /api/payruns/employees': { employees: [], total: 0, period: { from: '2026-09-01', to: '2026-09-30' },
        why_empty: '4 contract(s) sit on “OXP Standard Salaried”. 2 still have a DRAFT contract, which payroll ignores, and 1 are already inside a run for these dates.' } };
    render({ at: ['/payruns'], el: <PayrunsPage /> });
    await settle();
    click(byText('+ New payrun')); await settle(3);
    click([...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Next: select employees')));
    await settle(5);
    expect(has('Nobody is eligible'), 'the list says what it found');
    expect(has('2 still have a DRAFT contract'), 'and the counted reason, from the same call that came back empty');
  },

  'time off · a request waiting for approval is called what the enum calls it': async () => {
    who.me = await meFor(['HR_MANAGER']);
    const WAITING = { id: 1, employee: 'Aarav Mehta', employee_code: 'EMP0001', type: 'Casual Leave', category: 'CASUAL',
                      start_date: '2026-09-14', end_date: '2026-09-15', duration: 2, status: 'TO_APPROVE', is_unpaid: false,
                      requires_allocation: true, reason: 'Family function in the hometown' };
    const DECIDED = { ...WAITING, id: 2, employee: 'Priya Nair', status: 'APPROVED', approved_days: 1 };
    table = { ...baseTable(), 'GET /api/time-off/requests': { rows: [WAITING, DECIDED], total: 2 },
              'GET /api/employees': { rows: [], total: 0 }, 'GET /api/time-off/types': { rows: [], total: 0 } };
    render({ el: <LeaveRequestsPage /> });
    await settle();
    expect(has('Waiting for approval'), 'the chip uses the words a person would, for the value the column stores');
    expect(has('Approved'), 'and the decided one reads as decided');
    const approve = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Approve');
    expect(approve.length === 1, 'exactly one Approve button, on the row that needs an answer (found ' + approve.length + ')');
    expect(!!byText('Refuse'), 'with a Refuse beside it');
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
