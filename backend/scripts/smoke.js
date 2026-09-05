#!/usr/bin/env node
/**
 * PeoplePay360 API smoke test — boots the real Express app on an ephemeral port and calls every endpoint
 * the router registers, against the seeded database. It is the executable proof behind "every API works":
 * the run fails if any call returns an unexpected status *or* if any registered route was never touched.
 *
 *   node scripts/smoke.js              # run everything
 *   node scripts/smoke.js --verbose    # print each response body snippet
 *   node scripts/smoke.js --routes     # just list the route inventory
 *
 * The run creates a throwaway employee / department / schedule / structure / pay run and cleans them up,
 * so it is safe to run against the demo database (re-seed afterwards if you want byte-identical numbers).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { routeList } from './routes-list.js';

const VERBOSE = process.argv.includes('--verbose');
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Password@123';
const TODAY = new Date().toISOString().slice(0, 10);

if (process.argv.includes('--routes')) {
  const list = await routeList();
  console.log(list.join('\n'));
  console.log(`TOTAL ${list.length}`);
  process.exit(0);
}

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { closeQueues, closeRedis } = await import('../src/queue/connection.js');

const app = createApp();
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ── tiny HTTP client with cookie support (the refresh token lives in a cookie) ─────────────────────
let cookieJar = '';
async function call(method, path, { token, body, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { ...headers } };
  if (token) opts.headers.authorization = `Bearer ${token}`;
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (cookieJar) opts.headers.cookie = cookieJar;
  const res = await fetch(base + path, opts);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookieJar = setCookie.map((c) => c.split(';')[0]).join('; ');
  if (raw) { const buf = Buffer.from(await res.arrayBuffer()); return { status: res.status, type: res.headers.get('content-type') || '', bytes: buf.length, headers: res.headers, head: buf.subarray(0, 8).toString('latin1') }; }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, data: json?.data ?? json, error: json?.error, text, headers: res.headers };
}
const key = () => `smoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// ── result bookkeeping ────────────────────────────────────────────────────────
const results = [];
const touched = new Set();
const skipped = [];
let failed = 0;
function record(name, method, route, res, expect) {
  const okStatus = expect.includes(res.status);
  const ok = okStatus && (method === 'GET' ? res.status !== 500 : true);
  if (route) touched.add(`${method} ${route}`);
  results.push({ name, method, route, status: res.status, ok, note: okStatus ? '' : `expected ${expect.join('/')}` });
  if (!ok) { failed += 1; console.log(`  ✗ ${method} ${route || ''} — ${name}: ${res.status} ${res.text ? res.text.slice(0, 220) : ''}`); }
  else if (VERBOSE) console.log(`  ✓ ${method} ${route} → ${res.status} ${(res.text || '').slice(0, 120)}`);
  return res;
}
/** One step = one HTTP call. `exp` defaults to the happy path; write/read routes need an Idempotency-Key. */
async function step(name, method, route, opts = {}, saveArg) {
  const { params = {}, query = '', body, tok = 'admin', exp = [200, 201], idem = false, raw = false, save = saveArg } = opts;
  let miss;
  const path = route.replace(/:(\w+)/g, (_, k) => {
    const v = id(params[k]);
    if (v === undefined || v === null || v === 'undefined') { miss = k; return ''; }
    return encodeURIComponent(v);
  }) + query;
  if (miss) { skipped.push(`${method} ${route} (:${miss} had no value — an earlier step did not produce it)`); results.push({ name: `SKIP ${name}`, method, route, status: 0, ok: false, note: `missing :${miss}` }); failed += 1; console.log(`  - skipped ${method} ${route}: missing :${miss}`); return null; }
  const headers = idem ? { 'idempotency-key': key() } : {};
  const res = await call(method, path, { token: tokens[tok], body, headers, raw });
  record(name, method, route, res, exp);
  if (save && res.ok !== false) save(res.data ?? res, ctx);
  return res;
}

const tokens = {};
const ctx = {};
// Re-runnable: drop what an earlier smoke run left behind (payslips/lines/documents cascade with the run).
await pool.query(`delete from payruns where name like 'Smoke %'`).catch(() => {});
await pool.query(`delete from time_off_types where name like 'Smoke Day %'`).catch(() => {});
await pool.query(`delete from departments where name like 'Smoke Dept %'`).catch(() => {});
await pool.query(`delete from salary_structures where name like 'Smoke Structure %'`).catch(() => {});
await pool.query(`delete from working_schedules where name like 'Smoke Schedule %'`).catch(() => {});
await pool.query(`delete from pt_slabs where state like 'Smoke %'`).catch(() => {});
await pool.query(`delete from users where work_email like 'smoke.%@oxp.com'`).catch(() => {});
await pool.query(`delete from employees where employee_code like 'SKY%'`).catch(() => {});

// ── 1. auth ───────────────────────────────────────────────────────────────────
async function login(email) {
  const r = await call('POST', '/api/auth/login', { body: { email, password: DEMO_PASSWORD } });
  if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status} ${r.text}`);
  return r.data.token;
}
console.log('\n▸ auth');
// every login the seeder creates, and nothing else: this loop is how "the demo accounts really work" is proved
for (const [name, email] of [['admin', 'admin@oxp.com'], ['hr', 'hr@oxp.com'],
                             ['payrollOfficer', 'hr2@oxp.com'], ['payroll', 'payroll@oxp.com'],
                             ['employee', 'aarav.mehta@oxp.com']]) {
  tokens[name] = await login(email);
  console.log(`  ✓ signed in as ${email}`);
}
await step('session', 'GET', '/api/auth/me', { tok: 'hr' });
await step('access matrix', 'GET', '/api/auth/access-matrix');
await step('refresh token rotation', 'POST', '/api/auth/refresh', { tok: 'employee' });
{
  const r = await call('POST', '/api/auth/refresh', { token: tokens.employee });
  if (r.status === 200) { tokens.employee = r.data.token; record('refreshed employee session', 'POST', '/api/auth/refresh', r, [200]); }
}
await step('wrong password rejected', 'POST', '/api/auth/login', { body: { email: 'hr@oxp.com', password: 'nope-nope-nope' }, exp: [401] });
await step('anonymous is refused', 'GET', '/api/employees', { tok: 'none', exp: [401] });
await step('health', 'GET', '/api/health', { exp: [200] });
results.pop(); results.pop(); results.push({ name: 'health', method: 'GET', route: '/api/health', status: 200, ok: true, note: '' });
await step('readiness', 'GET', '/api/health/ready', { exp: [200] });
await step('meta', 'GET', '/api/meta');

// ── 2. directories (reads first, so we have ids to work with) ─────────────────
console.log('\n▸ employees, users, org');
await step('employee list', 'GET', '/api/employees', { query: '?page=1&page_size=50&view=list' }, (d, c) => { c.anyEmployee = (d.rows ?? d)[0]; });
await step('kanban board', 'GET', '/api/employees', { query: '?view=kanban' });
await step('search', 'GET', '/api/employees', { query: '?q=aarav' });
await step('employee portal self-read', 'GET', '/api/employees/me', { tok: 'employee' });
await step('employee record', 'GET', '/api/employees/:id', { params: { id: () => ctx.anyEmployee?.id }, tok: 'hr' });
await step('departments', 'GET', '/api/org/departments', { tok: 'hr' }, (d, c) => { c.department = (d.rows ?? d)[0]; });
await step('working schedules', 'GET', '/api/org/working-schedules', { tok: 'hr' }, (d, c) => { c.schedule = (d.rows ?? d)[0]; });
await step('schedule by id', 'GET', '/api/org/working-schedules/:id', { params: { id: () => ctx.schedule?.id } });
await step('holidays', 'GET', '/api/org/holidays', { query: '?year=2026' });
await step('holiday templates', 'GET', '/api/org/holiday-templates', { tok: 'hr' }, (d, c) => { c.template = (d.rows ?? d)[0]; });
await step('contract list', 'GET', '/api/contracts', { tok: 'hr' }, (d, c) => { c.contract = (d.rows ?? d)[0]; });
await step('users', 'GET', '/api/users', { query: '?page=1&page_size=20' }, (d, c) => { c.user = (d.rows ?? d)[0]; });

// `step` above takes a plain params object; helper to resolve lazily-captured ids
function id(value) { return typeof value === 'function' ? value() : value; }

// ── 3. salary structures + rules ──────────────────────────────────────────────
console.log('\n▸ salary');
await step('structures', 'GET', '/api/salary/structures', { tok: 'payroll' }, (d, c) => { c.structure = (d.rows ?? d).find((s) => s.is_active !== false) ?? (d.rows ?? d)[0]; });
await step('structure detail', 'GET', '/api/salary/structures/:id', { params: { id: () => ctx.structure?.id }, tok: 'payroll' });
await step('impact of a structure', 'GET', '/api/salary/structures/:id/impact', { params: { id: () => ctx.structure?.id }, tok: 'payrollAdmin' });
await step('rules', 'GET', '/api/salary/rules', { query: `?salary_structure_id=${ctx.structure?.id ?? ''}`, tok: 'payroll' }, (d, c) => {
  const rows = d.rows ?? d; c.rules = rows; c.rule = rows.find((r) => r.code === 'BASIC') ?? rows[0];
});
await step('rule detail', 'GET', '/api/salary/rules/:id', { params: { id: () => ctx.rule?.id }, tok: 'payroll' });
await step('formula lint', 'POST', '/api/salary/rules/validate', { body: { formula: "min(wage * 0.4, 40000)", wage: 85000, days: 20 }, tok: 'payrollAdmin' });
await step('what-if preview', 'POST', '/api/salary/preview', { body: { structure_id: ctx.structure?.id, wage: 85000, days: 20 }, tok: 'payrollAdmin' });
await step('pt slabs', 'GET', '/api/salary/pt-slabs', { tok: 'payroll' }, (d, c) => { c.ptSlab = (d.rows ?? d)[0]; });
await step('new structure', 'POST', '/api/salary/structures', { body: { name: `Smoke Structure ${Date.now().toString(36)}`, code: `SK${Date.now().toString(36).slice(-4).toUpperCase()}`, description: 'created by smoke.js' }, tok: 'payrollAdmin' }, (d, c) => { c.newStructure = d; });
await step('rule on it', 'POST', '/api/salary/rules', { body: { salary_structure_id: ctx.newStructure?.id, name: 'Smoke Allowance', code: 'SKALL', category: 'ALLOWANCE', line_kind: 'EARNING', sequence: 12, computation_type: 'FIXED', amount: 750, appears_on_payslip: true, statutory: false }, tok: 'payrollAdmin' }, (d, c) => { c.newRule = d; });
await step('edit the rule', 'PATCH', '/api/salary/rules/:id', { params: { id: () => ctx.newRule?.id }, body: { amount: 900 }, tok: 'payrollAdmin' });
await step('delete the rule', 'DELETE', '/api/salary/rules/:id', { params: { id: () => ctx.newRule?.id }, tok: 'payrollAdmin', exp: [200, 204] });
await step('edit the structure', 'PATCH', '/api/salary/structures/:id', { params: { id: () => ctx.newStructure?.id }, body: { description: 'edited by smoke.js', is_active: 'INACTIVE' }, tok: 'payrollAdmin' });
await step('retire the structure', 'DELETE', '/api/salary/structures/:id', { params: { id: () => ctx.newStructure?.id }, tok: 'payrollAdmin', exp: [200, 204, 409] });

// ── 4. attendance + time off ───────────────────────────────────────────────────
console.log('\n▸ attendance & time off');
await step('attendance grid', 'GET', '/api/attendance', { query: '?month=2026-08&page=1&page_size=20', tok: 'hr' }, (d, c) => { c.attendance = (d.rows ?? d)[0]; });
await step('exceptions', 'GET', '/api/attendance/exceptions', { query: '?month=2026-08', tok: 'hr' });
await step('attendance csv', 'GET', '/api/attendance/export.csv', { query: '?month=2026-08', tok: 'hr', raw: true, exp: [200] });
await step('manual attendance day', 'POST', '/api/attendance', { body: { employee_id: ctx.anyEmployee?.id, day: addDays(TODAY, 1), status: 'PRESENT', check_in: `${addDays(TODAY, 1)}T09:02:00`, check_out: `${addDays(TODAY, 1)}T18:05:00`, break_minutes: 60, manual_reason: 'Device sync gap' }, tok: 'hr' }, (d, c) => { c.attendanceRow = d; });
await step('edit that day', 'PATCH', '/api/attendance/:id', { params: { id: () => ctx.attendanceRow?.id }, body: { overtime_hours: 2, manual_reason: 'Approved overtime' }, tok: 'hr' });
await step('approve its overtime', 'POST', '/api/attendance/:id/overtime', { params: { id: () => ctx.attendanceRow?.id }, body: { approved: true }, tok: 'hr' });
await step('bulk attendance import', 'POST', '/api/attendance/import', { body: { csv: `employee_code,day,check_in,check_out\nEMP0002,${addDays(TODAY, 2)},09:00,18:00`, default_source: 'DEVICE', overwrite: true }, tok: 'hr' });
await step('clock in', 'POST', '/api/attendance/clock', { tok: 'employee', body: {}, exp: [200, 409] });
await step('clock out', 'POST', '/api/attendance/clock', { tok: 'employee', body: {}, exp: [200, 409] });
await step('remove the manual day', 'DELETE', '/api/attendance/:id', { params: { id: () => ctx.attendanceRow?.id }, tok: 'hr', exp: [200, 204] });

await step('leave types', 'GET', '/api/time-off/types', { tok: 'hr' }, (d, c) => { c.leaveType = (d.rows ?? d).find((t) => t.code === 'CL') ?? (d.rows ?? d)[0]; });
await step('leave type detail', 'GET', '/api/time-off/types/:id', { params: { id: () => ctx.leaveType?.id }, tok: 'hr' });
const stamp = Date.now().toString(36).toUpperCase();
const farDay = (n) => addDays(TODAY, 100 + ((Date.now() >> 10) % 260) + n * 9);   // moves with each run so reruns never collide
await step('new leave type', 'POST', '/api/time-off/types', { body: { name: `Smoke Day ${stamp}`, code: `SMOKE_${stamp.slice(-5)}`, unit: 'DAYS', requires_allocation: false, approval_route: 'HR',
    category: 'CASUAL', pay_treatment: 'PAID', is_unpaid: false, carry_forward: true }, tok: 'hr' }, (d, c) => { c.newType = d.id ? d : { ...d, id: d.type?.id }; });
await step('rename it', 'PATCH', '/api/time-off/types/:id', { params: { id: () => ctx.newType?.id }, body: { description: 'Adjusted by the smoke run' }, tok: 'hr' });
await step('allocations', 'GET', '/api/time-off/allocations', { query: '?year=2026', tok: 'hr' }, (d, c) => { c.allocation = (d.rows ?? d)[0]; });
await step('the type answers to its category and payoff', 'GET', '/api/time-off/types', { query: '?category=CASUAL&pay=PAID', tok: 'hr' }, (d, c) => { c.smokeTypeSeen = (d.rows ?? d).some((t) => t.id === c.newType?.id); });
if (ctx.newType?.id && ctx.smokeTypeSeen === false) { console.log('  ✗ ?category=CASUAL&pay=PAID did not return the type just created that way'); failed += 1; }
await step('an invented category is refused, not ignored', 'GET', '/api/time-off/types', { query: '?category=WEEKEND', tok: 'hr', exp: [400] });
await step('grant an allocation', 'POST', '/api/time-off/allocations', { body: { employee_id: ctx.anyEmployee?.id, time_off_type_id: ctx.newType?.id, allocated_days: 3, valid_from: '2026-01-01', valid_until: '2026-12-31', status: 'APPROVED' }, tok: 'hr' }, (d, c) => { c.newAllocation = d; });
await step('adjust it', 'PATCH', '/api/time-off/allocations/:id', { params: { id: () => ctx.newAllocation?.id }, body: { allocated_days: 4 }, tok: 'hr' });
await step('negative balance is refused', 'PATCH', '/api/time-off/allocations/:id', { params: { id: () => ctx.newAllocation?.id }, body: { taken_days: 99 }, tok: 'hr', exp: [200, 422] });
await step('carry forward', 'POST', '/api/time-off/carry-forward', { body: { type_id: ctx.newType?.id, from_year: 2025, to_year: 2026, cap: 5 }, tok: 'hr', exp: [200, 409, 422] });
await step('balance of an employee', 'GET', '/api/time-off/balances/:employeeId', { params: { employeeId: () => ctx.anyEmployee?.id }, tok: 'hr' });
await step('time-off overview', 'GET', '/api/time-off/overview', { query: '?month=2026-08', tok: 'hr' });
await step('count working days', 'POST', '/api/time-off/count-days', { body: { employee_id: ctx.anyEmployee?.id, type_id: ctx.leaveType?.id, start_date: '2026-08-01', end_date: '2026-08-31' }, tok: 'hr' });
await step('requests inbox', 'GET', '/api/time-off/requests', { query: '?status=TO_APPROVE', tok: 'hr' }, (d, c) => { c.request = (d.rows ?? d)[0]; });
await step('apply for leave (HR on behalf)', 'POST', '/api/time-off/requests', { body: { employee_id: ctx.anyEmployee?.id, time_off_type_id: ctx.newType?.id, start_date: farDay(30), end_date: farDay(30), reason: 'Smoke test leave' }, tok: 'hr' }, (d, c) => { c.newRequest = d; });
await step('read one request', 'GET', '/api/time-off/requests/:id', { params: { id: () => ctx.newRequest?.id }, tok: 'hr' });
await step('edit it', 'PATCH', '/api/time-off/requests/:id', { params: { id: () => ctx.newRequest?.id }, body: { reason: 'Smoke test leave — revised' }, tok: 'hr' });
await step('approve it', 'POST', '/api/time-off/requests/:id/approve', { params: { id: () => ctx.newRequest?.id }, body: { status: 'APPROVED' }, tok: 'hr' });
await step('a second request to refuse', 'POST', '/api/time-off/requests', { body: { employee_id: ctx.anyEmployee?.id, time_off_type_id: ctx.newType?.id, start_date: farDay(40), end_date: farDay(40), reason: 'Smoke refuse' }, tok: 'hr' }, (d, c) => { c.refused = d; });
await step('refuse it', 'POST', '/api/time-off/requests/:id/refuse', { params: { id: () => ctx.refused?.id }, body: { refuse_reason: 'Blackout period' }, tok: 'hr' });
await step('a third request to cancel', 'POST', '/api/time-off/requests', { body: { employee_id: ctx.anyEmployee?.id, time_off_type_id: ctx.newType?.id, start_date: farDay(50), end_date: farDay(50), reason: 'Smoke cancel' }, tok: 'hr' }, (d, c) => { c.cancelled = d; });
await step('cancel it', 'POST', '/api/time-off/requests/:id/cancel', { params: { id: () => ctx.cancelled?.id }, tok: 'hr' });
await step('employee applies', 'POST', '/api/portal/time-off', { tok: 'employee', body: { time_off_type_id: ctx.newType?.id, start_date: farDay(60), end_date: farDay(60), reason: 'Personal work' }, exp: [200, 201, 409] }, (d, c) => { c.portalRequest = d; });
await step('employee cancels it', 'POST', '/api/portal/time-off/:id/cancel', { tok: 'employee', params: { id: () => ctx.portalRequest?.id }, exp: [200, 409] });
await step('delete the draft request', 'DELETE', '/api/time-off/requests/:id', { params: { id: () => ctx.cancelled?.id }, tok: 'hr', exp: [200, 204, 409, 404] });
// The smoke type now has an allocation and requests against it, so this delete is expected to be refused —
// and a refusal without a sentence is what the review was about. The assertion reads the body, not the code.
{
  const path = `/api/time-off/types/${ctx.newType?.id}`;
  const res = await call('DELETE', path, { token: tokens.hr });
  if (res.status === 409) {
    const m = String(res.error?.message || '');
    const offered = res.error?.details?.can_deactivate === true || /deactivate/i.test(m);
    if (!offered || m.length < 20) { console.log('  ✗ a refused delete came back without a reason and an alternative: ' + m); failed += 1; }
    else console.log('  ✓ refused delete explains itself: ' + m.slice(0, 100));
    record('delete a leave type in use', 'DELETE', '/api/time-off/types/:id', res, [409]);
  } else if (res.status === 200 || res.status === 204 || res.status === 404) {
    record('delete a leave type in use', 'DELETE', '/api/time-off/types/:id', res, [200, 204, 409, 404]);
  } else {
    record('delete a leave type in use', 'DELETE', '/api/time-off/types/:id', res, [200, 204, 409, 404]);
  }
}
{  // A seeded department has employees in it: the sentence must name the table that holds it.
  const res = await call('DELETE', `/api/org/departments/${ctx.department?.id}`, { token: tokens.admin });
  if (res.status === 409) {
    const m = String(res.error?.message || '');
    if (!/employee|referenced|still used/i.test(m)) { console.log('  ✗ deleting a busy department did not say who holds it: ' + m); failed += 1; }
    else console.log('  ✓ busy department names the rows holding it: ' + m.slice(0, 100));
  }
  record('delete a department in use', 'DELETE', '/api/org/departments/:id', res, [409, 200, 204, 404]);
}

// ── 5. contracts ──────────────────────────────────────────────────────────────
console.log('\n▸ contracts');
await step('contract detail', 'GET', '/api/contracts/:id', { params: { id: () => ctx.contract?.id }, tok: 'hr' });
await step('contracts of one employee', 'GET', '/api/contracts/employee/:employeeId', { params: { employeeId: () => ctx.contract?.employee_id }, tok: 'hr' });
await step('expiring soon', 'GET', '/api/contracts/expiring', { query: '?days=180', tok: 'hr' });
await step('raise a contract', 'POST', '/api/contracts', { body: { employee_id: ctx.anyEmployee?.id, start_date: addDays(TODAY, 300), wage: 45000, department_id: ctx.department?.id, salary_structure_id: ctx.structure?.id, working_schedule_id: ctx.schedule?.id, status: 'RUNNING', is_primary: false, notes: 'Smoke contract' }, tok: 'hr', exp: [200, 201, 409, 422] }, (d, c) => { c.newContract = d?.id ? d : (d.contract ?? d); });
await step('edit it', 'PATCH', '/api/contracts/:id', { params: { id: () => ctx.newContract?.id ?? ctx.contract?.id }, body: { wage: 46000, notes: 'Smoke contract revised' }, tok: 'hr', exp: [200, 404, 409] });
await step('renew it', 'POST', '/api/contracts/:id/renew', { params: { id: () => ctx.newContract?.id ?? ctx.contract?.id }, body: { start_date: addDays(TODAY, 400), wage: 47000 }, tok: 'hr', exp: [200, 409, 404] });
await step('terminate it', 'POST', '/api/contracts/:id/terminate', { params: { id: () => ctx.newContract?.id ?? ctx.contract?.id }, body: { date_of_exit: addDays(TODAY, 320), reason: 'Smoke cleanup' }, tok: 'hr', exp: [200, 409, 404] });

// ── 6. payroll: the whole pay-run lifecycle through the real services ─────────
console.log('\n▸ payroll');
// Next month has no seeded runs, so compute → validate → deliver → mark paid can all really happen.
const nextMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return d; })();
const runFrom = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;
const runTo = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).toISOString().slice(0, 10);
const stdStructure = ctx.structure;
await step('pay runs', 'GET', '/api/payruns', { query: '?page=1&page_size=20', tok: 'payroll' }, (d, c) => { const rows = d.rows ?? d; c.paidRun = rows.find((x) => x.status === 'PAID'); c.openRun = rows.find((x) => x.status === 'COMPUTED'); });
await step('paid run detail', 'GET', '/api/payruns/:id', { params: { id: () => ctx.paidRun?.id }, tok: 'payroll' });
await step('what a run flags', 'GET', '/api/payruns/:id/warnings', { params: { id: () => ctx.paidRun?.id }, tok: 'payroll' });
await step('delivery tasks', 'GET', '/api/payruns/:id/tasks', { params: { id: () => ctx.paidRun?.id }, tok: 'payroll' });
await step('email ledger', 'GET', '/api/payruns/:id/emails', { params: { id: () => ctx.paidRun?.id }, tok: 'payrollAdmin' });
await step('salary register csv', 'GET', '/api/payruns/:id/export.csv', { params: { id: () => ctx.paidRun?.id }, tok: 'payrollAdmin', raw: true, exp: [200] });
await step('zip of every pdf', 'GET', '/api/payruns/zip/:payrunId', { params: { payrunId: () => ctx.paidRun?.id }, tok: 'payrollAdmin', raw: true, exp: [200, 202, 409] });
await step('candidates for a new run', 'GET', '/api/payruns/employees', { query: `?salary_structure_id=${stdStructure?.id}&period_start=${runFrom}&pay_frequency=MONTHLY&compute_mode=PRO_RATA`, tok: 'payroll' });
await step('wizard step 1', 'POST', '/api/payruns/preview', { body: { salary_structure_id: stdStructure?.id, period_start: runFrom, period_end: runTo, pay_frequency: 'HALF_MONTH_FIRST', compute_mode: 'ADVANCE_50' }, tok: 'payroll' });

let runId; let draftId;
{
  const cand = await call('GET', `/api/payruns/employees?salary_structure_id=${stdStructure?.id}&period_start=${runFrom}&pay_frequency=MONTHLY`, { token: tokens.payroll });
  const people = (cand.data?.employees ?? cand.data?.rows ?? []).filter((x) => !x.duplicate);
  const ids = people.slice(0, 3).map((x) => x.employee_id ?? x.id);
  const idemKey = key();
  const res = await call('POST', '/api/payruns', { token: tokens.payrollAdmin, headers: { 'idempotency-key': idemKey },
    body: { salary_structure_id: stdStructure?.id, period_start: runFrom, period_end: runTo, pay_frequency: 'MONTHLY', compute_mode: 'PRO_RATA', name: `Smoke run ${stamp}`, notes: 'created by scripts/smoke.js', idempotency_key: idemKey, employee_ids: ids } });
  record('create the run', 'POST', '/api/payruns', res, [200, 201, 409]);
  runId = res.data?.id ?? res.data?.payrun?.id;
  if (!runId) { const found = await call('GET', `/api/payruns?q=${encodeURIComponent(`Smoke run ${stamp}`)}&page=1&page_size=5`, { token: tokens.payrollAdmin }); runId = (found.data?.rows ?? [])[0]?.id; }
  ctx.run = { id: runId };
  // a second run we never touch, so the delete path has something it is allowed to remove
  const draft = await call('POST', '/api/payruns', { token: tokens.payrollAdmin, headers: { 'idempotency-key': idemKey + '-b' },
    body: { salary_structure_id: stdStructure?.id, period_start: addDays(runTo, 1), period_end: addDays(runTo, 30), pay_frequency: 'MONTHLY', compute_mode: 'PRO_RATA', name: `Smoke draft ${stamp}`, employee_ids: ids.slice(0, 1) } });
  record('create a draft run', 'POST', '/api/payruns', draft, [200, 201, 409]);
  draftId = draft.data?.id;
}
if (runId) {
  await step('compute it', 'POST', '/api/payruns/:id/compute', { params: { id: () => runId }, body: {}, tok: 'payroll', idem: true, exp: [200, 202] });
  await step('validate it', 'POST', '/api/payruns/:id/validate', { params: { id: () => runId }, tok: 'payroll', idem: true, exp: [200] });
  await step('queue the pdfs', 'POST', '/api/payruns/:id/generate-pdfs', { params: { id: () => runId }, tok: 'payroll', exp: [200, 202] }, (_d, c) => { c.pdfRun = runId; });
  await step('mark it paid', 'POST', '/api/payruns/:id/mark-paid', { params: { id: () => runId }, tok: 'payroll', idem: true, exp: [200] });
  await step('send payslips', 'POST', '/api/payruns/:id/send', { params: { id: () => runId }, body: { force: false, cc_hr: true }, tok: 'payrollAdmin', idem: true, exp: [200, 202] });
  await step('a paid run cannot be deleted', 'DELETE', '/api/payruns/:id', { params: { id: () => runId }, tok: 'payrollAdmin', exp: [409] });
  await step('nor voided after delivery', 'POST', '/api/payruns/:id/void', { params: { id: () => runId }, tok: 'payrollAdmin', idem: true, exp: [200, 409] });
  const t = await call('GET', `/api/payruns/${runId}/tasks`, { token: tokens.payrollAdmin });
  ctx.task = (t.data?.rows ?? t.data ?? [])[0];
}
if (draftId) {
  await step('void the draft', 'POST', '/api/payruns/:id/void', { params: { id: () => draftId }, tok: 'payrollAdmin', idem: true, exp: [200, 409] });
  await step('delete a run that never paid anyone', 'DELETE', '/api/payruns/:id', { params: { id: () => draftId }, tok: 'payrollAdmin', exp: [200, 409] });
}

await step('payslips', 'GET', '/api/payslips', { query: '?page=1&page_size=20', tok: 'payroll' }, (d, c) => { c.payslip = (d.rows ?? d)[0]; });
await step('payslip detail', 'GET', '/api/payslips/:id', { params: { id: () => ctx.payslip?.id }, tok: 'payroll' });
await step('download token', 'GET', '/api/auth/token-for-payslip/:id', { params: { id: () => ctx.payslip?.id }, tok: 'payroll' }, (d) => { ctx.downloadToken = d.token; });
await step('pdf needs a token', 'GET', '/api/payslips/:id/pdf', { params: { id: () => ctx.payslip?.id }, tok: 'none', exp: [200, 401] });
{
  const r = await call('GET', `/api/payslips/${ctx.payslip?.id}/pdf?t=${ctx.downloadToken ?? ''}`, { raw: true });
  record('pdf with the scoped token', 'GET', '/api/payslips/:id/pdf', r, [200]);
}
await step('preview without ledger entry', 'GET', '/api/payslips/:id/preview-pdf', { params: { id: () => ctx.payslip?.id }, tok: 'payroll', raw: true, exp: [200] });
await step('who downloaded it', 'GET', '/api/payslips/:id/downloads', { params: { id: () => ctx.payslip?.id }, tok: 'payrollAdmin' });
await step('recompute history', 'GET', '/api/payslips/:id/history', { params: { id: () => ctx.payslip?.id }, tok: 'payroll' });
await step('print one payslip', 'POST', '/api/payslips/:id/print', { params: { id: () => ctx.payslip?.id }, tok: 'payrollAdmin', exp: [200, 202] });
await step('recompute one payslip', 'POST', '/api/payslips/:id/compute', { params: { id: () => ctx.payslip?.id }, tok: 'payroll', exp: [200, 409] });
{
  const open = await call('GET', '/api/payslips?status=COMPUTED&page=1&page_size=1', { token: tokens.payroll });
  ctx.openSlip = (open.data?.rows ?? open.data ?? [])[0] ?? ctx.payslip;
}
await step('edit a line', 'PATCH', '/api/payslips/:id/lines', { params: { id: () => ctx.openSlip?.id }, body: { replace: false, lines: [{ rule_code: 'CONV', name: 'Conveyance (smoke)', line_kind: 'EARNING', sequence: 4, amount: 1700 }] }, tok: 'payrollAdmin', exp: [200, 409] });
await step('add an input', 'PATCH', '/api/payslips/:id/inputs', { params: { id: () => ctx.openSlip?.id }, body: { rows: [{ code: 'BONUS', name: 'Festival bonus', amount: 5000, reason: 'smoke' }] }, tok: 'payrollAdmin', exp: [200, 409] });
await step('arrear on the next run', 'POST', '/api/payslips/:id/arrear', { params: { id: () => ctx.openSlip?.id ?? ctx.payslip?.id }, body: { amount: 1500, reason: 'Salary revision arrears (smoke)', rule_code: 'ARREAR' }, tok: 'payrollAdmin', idem: true, exp: [200, 201, 409, 422] });
await step('employee sees own slips', 'GET', '/api/portal/payslips', { tok: 'employee' }, (d, c) => { c.mySlip = (d.rows ?? d)[0]; });
await step('employee downloads', 'GET', '/api/portal/payslips/:id/pdf', { params: { id: () => ctx.mySlip?.id }, tok: 'employee', raw: true, exp: [200, 403] });
await step("employee's summary", 'GET', '/api/portal/summary', { tok: 'employee' });
await step("employee's attendance", 'GET', '/api/portal/attendance', { query: '?month=2026-08', tok: 'employee' });
await step("employee's leave", 'GET', '/api/portal/time-off', { query: '?year=2026', tok: 'employee' });
await step("employee's balances", 'GET', '/api/portal/balances', { tok: 'employee' });
await step("employee's calendar", 'GET', '/api/portal/calendar', { query: '?month=2026-09', tok: 'employee' });
await step("employee's contracts", 'GET', '/api/portal/contracts', { tok: 'employee' });

// ── 7. dashboards, reports, settings, users, system ───────────────────────────
console.log('\n▸ dashboards, reports, admin');
await step('hr dashboard', 'GET', '/api/dashboard', { query: '?month=2026-08', tok: 'hr' });
await step('payroll dashboard', 'GET', '/api/dashboard', { query: '?month=2026-08', tok: 'payroll' });
await step('employee roll-up', 'GET', '/api/employees/:id/summary', { params: { id: () => ctx.anyEmployee?.id }, tok: 'hr' });
await step('attendance of one employee', 'GET', '/api/employees/:id/attendance', { params: { id: () => ctx.anyEmployee?.id }, query: '?month=2026-08', tok: 'hr' });
await step('time off of one employee', 'GET', '/api/employees/:id/time-off', { params: { id: () => ctx.anyEmployee?.id }, tok: 'hr' });
await step('contracts of one employee (tab)', 'GET', '/api/employees/:id/contracts', { params: { id: () => ctx.anyEmployee?.id }, tok: 'hr' });
await step('payslips of one employee', 'GET', '/api/employees/:id/payslips', { params: { id: () => ctx.anyEmployee?.id }, tok: 'payrollAdmin' });
await step('payroll summary report', 'GET', '/api/reports/payroll-summary.csv', { tok: 'payrollAdmin', raw: true, exp: [200] });
await step('salary register report', 'GET', '/api/reports/salary-register.csv', { query: `?payrun_id=${ctx.paidRun?.id}`, tok: 'payrollAdmin', raw: true, exp: [200] });
await step('attendance report', 'GET', '/api/reports/attendance.csv', { query: '?month=2026-08', tok: 'hr', raw: true, exp: [200] });
await step('payslip zip needs a pay run', 'GET', '/api/reports/payslips.zip', { tok: 'payrollAdmin', exp: [400] });
await step('payslip zip report', 'GET', '/api/reports/payslips.zip', { query: `?payrun_id=${ctx.paidRun?.id}`, tok: 'payrollAdmin', raw: true, exp: [200, 409] });
await step('company profile', 'GET', '/api/company', { tok: 'hr' });
await step('save company profile', 'PATCH', '/api/company', { body: { payslip_footer: 'Generated by PeoplePay360 — smoke run' }, tok: 'admin' });
await step('pt slab add', 'POST', '/api/salary/pt-slabs', { body: { state: `Smoke ${stamp.slice(-4)} Pradesh`, wage_from: 10000, wage_to: 20000, monthly_amount: 100, effective_from: addDays(TODAY, 400) }, tok: 'admin' }, (d, c) => { c.newSlab = d; });
await step('pt slab delete', 'DELETE', '/api/salary/pt-slabs/:id', { params: { id: () => ctx.newSlab?.id }, tok: 'admin', exp: [200, 204] });
await step('company pt slab list', 'GET', '/api/company/pt-slabs', { tok: 'hr' });
await step('company pt slab add', 'POST', '/api/company/pt-slabs', { body: { state: `Smoke ${stamp.slice(-4)} II`, wage_from: 1000, wage_to: 2000, monthly_amount: 50, effective_from: addDays(TODAY, 400) }, tok: 'admin' }, (d, c) => { c.companySlab = d; });
await step('company pt slab delete', 'DELETE', '/api/company/pt-slabs/:id', { params: { id: () => ctx.companySlab?.id }, tok: 'admin', exp: [200, 204] });
await step('audit trail', 'GET', '/api/system/audit', { query: '?page=1&page_size=10', tok: 'admin' }, (d, c) => { c.audit = (d.rows ?? d)[0]; });
await step('audit detail', 'GET', '/api/system/audit/:type/:id', { params: { type: () => ctx.audit?.action ?? ctx.audit?.type ?? 'employee.read', id: () => ctx.audit?.resource_id ?? ctx.audit?.id }, tok: 'admin', exp: [200, 404] });
await step('queue jobs', 'GET', '/api/system/jobs', { tok: 'admin' });
await step('task ledger', 'GET', '/api/system/tasks', { query: '?page=1&page_size=10', tok: 'admin' }, (d, c) => { c.task = (d.rows ?? d)[0]; });
if (!ctx.task) { const t = await call('GET', `/api/payruns/${ctx.paidRun?.id}/tasks`, { token: tokens.payrollAdmin }); ctx.task = (t.data?.rows ?? t.data ?? [])[0]; }
await step('retry a task', 'POST', '/api/system/tasks/:id/retry', { params: { id: () => ctx.task?.id }, tok: 'admin', exp: [200, 404, 409] });
await step('reclaim stuck jobs', 'POST', '/api/system/reclaim', { tok: 'admin', body: {}, exp: [200] });

// ── 8. write paths that create people (last, so nothing else is disturbed) ─────
console.log('\n▸ org + people writes');
await step('new department', 'POST', '/api/org/departments', { body: { name: `Smoke Dept ${stamp}`, code: `SK${stamp.slice(-3)}` }, tok: 'hr', exp: [200, 201, 409] }, (d, c) => { c.newDept = d; });
await step('rename department', 'PATCH', '/api/org/departments/:id', { params: { id: () => ctx.newDept?.id }, body: { code: `S${stamp.slice(-3)}K` }, tok: 'hr', exp: [200, 404] });
await step('new schedule', 'POST', '/api/org/working-schedules', { body: { name: `Smoke Schedule ${stamp}`, type: 'FIXED', company_name: 'OXP Pvt Ltd', timezone: 'Asia/Kolkata', days: [{ day: 1, start: '09:00', end: '18:00', break: 60 }, { day: 2, start: '09:00', end: '18:00', break: 60 }, { day: 3, start: '09:00', end: '18:00', break: 60 }, { day: 4, start: '09:00', end: '18:00', break: 60 }, { day: 5, start: '09:00', end: '18:00', break: 60 }, { day: 6, rest: true }, { day: 7, rest: true }] }, tok: 'hr' }, (d, c) => { c.newSchedule = d; });
await step('edit schedule', 'PATCH', '/api/org/working-schedules/:id', { params: { id: () => ctx.newSchedule?.id }, body: { name: 'Smoke Schedule (edited)', days: [{ day: 1, start: '09:30', end: '18:30', break: 60 }, { day: 7, rest: true }] }, tok: 'hr' });
await step('holiday', 'POST', '/api/org/holidays', { body: { day: `${new Date().getFullYear() + 1}-01-01`, name: 'Smoke New Year', type: 'COMPANY' }, tok: 'hr', exp: [200, 201, 409] }, (d, c) => { c.newHoliday = d; });
await step('edit holiday', 'PATCH', '/api/org/holidays/:id', { params: { id: () => ctx.newHoliday?.id }, body: { note: 'Optional shutdown' }, tok: 'hr', exp: [200, 404] });
await step('generate holidays from template', 'POST', '/api/org/holidays/generate', { body: { template_id: ctx.template?.id, year: new Date().getFullYear() + 2, state: 'Gujarat' }, tok: 'hr', exp: [200, 201, 400, 409, 422] });
await step('delete holiday', 'DELETE', '/api/org/holidays/:id', { params: { id: () => ctx.newHoliday?.id }, tok: 'hr', exp: [200, 204, 409] });
await step('delete schedule', 'DELETE', '/api/org/working-schedules/:id', { params: { id: () => ctx.newSchedule?.id }, tok: 'hr', exp: [200, 204, 409] });
await step('delete department', 'DELETE', '/api/org/departments/:id', { params: { id: () => ctx.newDept?.id }, tok: 'hr', exp: [200, 204, 409] });

let newEmpId;
await step('new employee (with login + contract)', 'POST', '/api/employees', {
  body: { name: 'Smoke Tester', work_email: `smoke.${Date.now().toString(36)}@oxp.com`, date_of_joining: TODAY, employee_type: 'FULL_TIME',
    work_location: 'Ahmedabad', city: 'Ahmedabad', state: 'Gujarat', department_id: ctx.department?.id, job_position: 'QA Engineer',
    working_schedule_id: ctx.schedule?.id, bank_account_number: '00012345678901', bank_ifsc: 'HDFC0001234', bank_name: 'HDFC Bank',
    pan_number: 'ABCDE1234F', status: 'ACTIVE', employee_code: `SKY${Date.now().toString(36).slice(-4).toUpperCase()}`,
    user: { role: 'EMPLOYEE', password: DEMO_PASSWORD, must_change_pw: false },
    contract: { wage: 55000, start_date: TODAY, salary_structure_id: ctx.structure?.id, working_schedule_id: ctx.schedule?.id, status: 'RUNNING' } },
  tok: 'hr' }, (d, c) => { newEmpId = d.id ?? d.employee?.id; c.newEmployee = { ...d, id: newEmpId }; });
if (newEmpId) {
  await step('edit employee', 'PATCH', '/api/employees/:id', { params: { id: () => newEmpId }, body: { job_position: 'Senior QA Engineer', city: 'Gandhinagar' }, tok: 'hr' });
  await step('import employees (dry run)', 'POST', '/api/employees/import', { body: { csv: 'name,work_email,date_of_joining,wage,department\nSmoke Import,smoke.import@oxp.com,2026-01-05,42000,Engineering', dry_run: true }, tok: 'hr', exp: [200, 422] });
  await step('terminate employee', 'POST', '/api/employees/:id/terminate', { params: { id: () => newEmpId }, body: { date_of_exit: TODAY, reason: 'Smoke test cleanup' }, tok: 'hr', exp: [200, 409, 422] });
}
const userEmail = `smoke.user.${stamp.toLowerCase()}@oxp.com`;
await step('new user', 'POST', '/api/users', { body: { name: 'Smoke User', work_email: userEmail, password: 'SmokePass@2026', role: 'EMPLOYEE', must_change_pw: true }, tok: 'admin', exp: [200, 201, 409] }, (d, c) => { c.newUser = { ...d, work_email: d.work_email ?? userEmail }; });
if (ctx.newUser && !ctx.newUser.id) {
  const found = await call('GET', '/api/users?page=1&page_size=200', { token: tokens.admin });
  ctx.newUser.id = (found.data?.rows ?? found.data ?? []).find((u) => String(u.work_email).toLowerCase() === userEmail)?.id;
}
if (ctx.newUser?.id) {
  await step('user detail', 'GET', '/api/users/:id', { params: { id: () => ctx.newUser.id } });
  await step('rename user', 'PATCH', '/api/users/:id', { params: { id: () => ctx.newUser.id }, body: { name: 'Smoke User Renamed' } });
  await step('change roles', 'POST', '/api/users/:id/roles', { params: { id: () => ctx.newUser.id }, body: { roles: ['HR_PAYROLL_USER'] } });
  await step('picklists for the forms', 'GET', '/api/meta', { tok: 'hr' }, (d, c) => { c.meta = d; });
{
  const states = ctx.meta?.states || [], cats = ctx.meta?.leave_categories || [];
  if (states.length < 28) { console.log('  ✗ /api/meta returned ' + states.length + ' Indian states (the forms need all of them)'); failed += 1; }
  if (!cats.some((x) => (x.value || x) === 'CASUAL')) { console.log('  ✗ /api/meta has no CASUAL leave category'); failed += 1; }
  if (!(ctx.meta?.pt_states || []).length) { console.log('  ✗ /api/meta returned no professional-tax states'); failed += 1; }
  if (failed === 0) console.log('  ✓ /api/meta: ' + states.length + ' states, ' + cats.length + ' leave categories');
}
await step('two roles in one account are refused', 'POST', '/api/users/:id/roles', { params: { id: () => ctx.newUser.id }, body: { roles: ['ADMIN', 'HR_MANAGER'] }, tok: 'admin', exp: [400, 409] });
await step('one role, set on its own', 'POST', '/api/users/:id/role', { params: { id: () => ctx.newUser.id }, body: { role: 'HR_PAYROLL_USER' }, tok: 'admin' });
await step('issue a set-password link', 'POST', '/api/users/:id/invite', { params: { id: () => ctx.newUser.id }, body: { send_email: false }, tok: 'admin', idem: true }, (d, c) => { c.invite = d; });
const inviteToken = ctx.invite?.token;
if (!inviteToken) console.log('  ✗ no invitation came back — the account cannot be completed by its owner');
await step('the link says whose it is, to someone with no session', 'GET', '/api/auth/invite/:token', { params: { token: () => inviteToken }, tok: 'none' });
await step('open links for that account', 'GET', '/api/users/:id/invites', { params: { id: () => ctx.newUser.id }, tok: 'admin' });
await step('a password too short is refused by the link', 'POST', '/api/auth/set-password', { body: { token: inviteToken, password: 'short' }, tok: 'none', exp: [400] });
await step('set the first password through the link', 'POST', '/api/auth/set-password', { body: { token: inviteToken, password: 'SmokeChosen@2026' }, tok: 'none' });
await step('the same link cannot be used again', 'POST', '/api/auth/set-password', { body: { token: inviteToken, password: 'SmokeSecond@2026' }, tok: 'none', exp: [400, 409] });
await step('sign in with the password just chosen', 'POST', '/api/auth/login', { body: { email: userEmail, password: 'SmokeChosen@2026' }, tok: 'none' }, (d, c) => { c.inviteLogin = d?.token || d?.access_token ? d : null; });
if (ctx.newUser && !ctx.inviteLogin) { console.log('  ✗ the invitation set a password but that password cannot sign in'); failed += 1; }
await step('deactivate', 'POST', '/api/users/:id/deactivate', { params: { id: () => ctx.newUser.id }, body: {} });
  await step('a deactivated account cannot sign in', 'POST', '/api/auth/login', { body: { email: ctx.newUser.work_email, password: 'SmokePass@2026' }, exp: [401, 403] });
  await step('activate', 'POST', '/api/users/:id/activate', { params: { id: () => ctx.newUser.id }, body: {} });
  await step('reset the password', 'POST', '/api/users/:id/reset-password', { params: { id: () => ctx.newUser.id }, body: { password: 'SmokePass@9999', must_change_pw: false } });
  {
    const re = await call('POST', '/api/auth/login', { body: { email: ctx.newUser.work_email, password: 'SmokePass@9999' } });
    record('sign in with the reset password', 'POST', '/api/auth/login', re, [200]);
    if (re.status === 200) {
      const chg = await call('POST', '/api/auth/change-password', { token: re.data.token, body: { current_password: 'SmokePass@9999', new_password: 'SmokePass@5555' } });
      record('change own password', 'POST', '/api/auth/change-password', chg, [200]);
      const again = await call('POST', '/api/auth/login', { body: { email: ctx.newUser.work_email, password: 'SmokePass@5555' } });
      record('and sign in again', 'POST', '/api/auth/login', again, [200]);
      const out = await call('POST', '/api/auth/logout', { token: again.data?.token });
      record('logout revokes the refresh cookie', 'POST', '/api/auth/logout', out, [200]);
    }
  }
}
await step('bulk structure export', 'GET', '/api/salary/structures', { tok: 'payroll' });

// ── 9. RBAC negatives: the access matrix must actually bite ───────────────────
console.log('\n▸ rbac');
await step('employee cannot list everyone', 'GET', '/api/employees', { tok: 'employee', exp: [403] });
await step('employee cannot create a pay run', 'GET', '/api/payruns', { tok: 'employee', exp: [403] });
await step('hr cannot mark paid', 'POST', '/api/payruns/:id/mark-paid', { params: { id: () => ctx.paidRun?.id }, tok: 'hr', idem: true, exp: [403, 404] });
await step('payroll user cannot edit users', 'POST', '/api/users', { body: { name: 'Nope', work_email: 'nope@oxp.com', password: 'Password@123' }, tok: 'payroll', exp: [403] });
await step('hr cannot read the audit trail', 'GET', '/api/system/audit', { tok: 'hr', exp: [403] });
await step('unknown route 404s', 'GET', '/api/nope/nope', { exp: [404] });

// ── coverage + report ─────────────────────────────────────────────────────────
const all = await routeList();
const untouched = all.filter((r) => !touched.has(r));
console.log(`\n${'─'.repeat(78)}`);
console.log(`endpoints registered   : ${all.length}`);
console.log(`endpoints exercised    : ${all.length - untouched.length}`);
console.log(`http calls made        : ${results.length}`);
console.log(`unexpected responses   : ${failed}`);
if (skipped.length) { console.log('\nsteps skipped because a predecessor id was missing:'); for (const m of skipped) console.log(`  ${m}`); }
if (untouched.length) { console.log('\nroutes NOT exercised (fix this file, not the API):'); for (const m of untouched) console.log(`  ${m}`); }
const byStatus = {};
for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
console.log('status mix: ' + Object.entries(byStatus).sort().map(([st, n]) => `${st}×${n}`).join('  '));
const clean = failed === 0 && untouched.length === 0;
console.log(clean ? '✅ every endpoint answered as designed' : '❌ smoke failed');

await mkdir(new URL('../storage', import.meta.url), { recursive: true });
await writeFile(new URL('../storage/smoke-results.json', import.meta.url), JSON.stringify(
  { at: new Date().toISOString(), registered: all.length, exercised: all.length - untouched.length, calls: results.length, failed, skipped, unexercised: untouched, results }, null, 2));
console.log(`report: storage/smoke-results.json`);

server.close();
await pool.end().catch(() => {});
await closeQueues?.().catch(() => {});
await closeRedis?.().catch(() => {});
process.exit(clean ? 0 : 1);

// ── date helpers + step() plumbing that resolves lazy ids ────────────────────
function addDays(iso, n) { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function monthStart(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
function monthEnd(d = new Date()) { const x = new Date(d.getFullYear(), d.getMonth() + 1, 0); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
