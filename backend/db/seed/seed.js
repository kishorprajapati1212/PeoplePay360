#!/usr/bin/env node
/**
 * Demo seeder. Zero arguments needed — it reads the same config as the API (root .env, defaults baked in).
 *
 *   node db/seed/seed.js                 seed what is missing; stop if the demo company is already there
 *   node db/seed/seed.js --force         re-run the demo data over an existing company (upserts, so safe)
 *   node db/seed/seed.js --reset         truncate the app tables first (dev only, obviously)
 *   node db/seed/seed.js --skip-payroll  master data only, no payruns (fast for API smoke tests)
 *   node db/seed/seed.js --if-empty      used by docker compose: same as the default, but says nothing
 *
 * Payslip money is NOT written here: the seeder drives the real services (payrun create → compute →
 * validate → mark paid, time-off apply → approve) so the demo company is produced by the same code the
 * UI uses. If a rule or a trigger breaks, the seeder fails loudly instead of shipping pretty numbers.
 */
import { config } from '../../src/config.js';
import { query, one, rows, pool } from '../../src/db/pool.js';
import { hashPassword } from '../../src/middleware/auth.js';
import { eachDay, toIso, fmtDate, periodKey, monthAnchor } from '../../src/lib/shared/index.js';
import { COMPANY, DEPARTMENTS, SCHEDULES, HOLIDAYS, HOLIDAY_TEMPLATES, STRUCTURES, PT_SLABS, USERS, EMPLOYEES,
         LEAVE_TYPES, RUNS, ATTENDANCE_MONTHS, rng } from './data.js';
import { banner } from '../../src/utils/urls.js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const log = (...a) => { if (!has('--quiet')) console.log(...a); };
const step = (m) => log(`\n▸ ${m}`);
const pad = (s, n = 22) => String(s).padEnd(n);
const monthOf = (iso) => iso.slice(0, 7);
// day 0 of the *next* month index = last day of this month
const monthEnd = (iso) => `${iso.slice(0, 7)}-${String(new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7), 0)).getUTCDate()).padStart(2, '0')}`;

const shift = (mins) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const hhmm = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const dayHours = (d) => (d.is_rest_day || d.rest || !d.start || !d.end ? 0 : (hhmm(d.end) - hhmm(d.start) - (d.brk ?? d.break ?? 0)) / 60);

async function assertMigrated() {
  const t = await query(`select count(*) as n from information_schema.tables where table_schema = 'public' and table_name in ('payruns','payslip_lines','company_settings')`).then((r) => Number(r.rows[0].n));
  if (t < 3) throw new Error('Schema is not applied yet — run: node db/migrate.js');
}
const RESET_TABLES = ['payslip_lines', 'payslip_inputs', 'payslip_arrears', 'payslip_documents', 'payslip_downloads', 'payslips',
  'payrun_employees', 'payruns', 'email_deliveries', 'task_queue', 'audit_logs', 'time_off_requests', 'time_off_allocations',
  'attendance', 'contracts', 'employees', 'refresh_tokens', 'user_role_grants', 'users', 'salary_rules', 'salary_structures',
  'pt_slabs', 'holidays', 'holiday_templates', 'working_schedule_days', 'working_schedules', 'departments', 'invitations'];
async function reset() {
  step('Resetting (dev only)');
  await query(`truncate table ${RESET_TABLES.map((t) => `"${t}"`).join(', ')} restart identity cascade`);
  log(`  truncated ${RESET_TABLES.length} tables`);
}
/**
 * Has the demo company been created already? Everything below this check is an upsert, so re-running is
 * safe — we still stop, because recomputing six months of payroll for nothing is slow. `--force` continues
 * anyway, and `--reset` is the way to start over.
 */
async function alreadySeeded() {
  const n = await query(`select count(*) as n from employees`).then((r) => Number(r.rows[0].n));
  if (!n) return false;
  if (has('--force')) { log(`  ${n} employees already there — topping up where something is missing`); return false; }
  if (!has('--if-empty')) {
    log(`\n  ${n} employee(s) and their payruns are already in this database — nothing else to do.`);
    log('  (--force tops up the demo data, --reset truncates the app tables and starts over)');
  }
  return true;
}
async function seedCompany() {
  step('Company settings');
  const cols = Object.keys(COMPANY);
  await query(`insert into company_settings (id, ${cols.join(', ')}) values (true, ${cols.map((_, i) => `$${i + 1}`).join(', ')})
               on conflict (id) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}, updated_at = now()`,
              cols.map((c) => COMPANY[c]));
  log(`  ${pad(COMPANY.company_name)} day basis ${COMPANY.payroll_day_basis} · FY starts month ${COMPANY.fiscal_year_start_month}`);
}
async function seedDepartments() {
  step('Departments');
  const out = {};
  for (const d of DEPARTMENTS) {
    const r = await query(`insert into departments (name, code) values ($1, $2)
                           on conflict (name) do update set code = excluded.code, is_active = true returning id`, [d.name, d.code]);
    out[d.name] = r.rows[0].id;
    log(`  ${pad(d.name)} ${d.code}`);
  }
  return out;
}
async function seedSchedules() {
  step('Working schedules');
  const out = [];
  for (const s of SCHEDULES) {
    let id = await query(`select id from working_schedules where name = $1`, [s.name]).then((r) => r.rows[0]?.id);
    if (id) await query(`delete from working_schedule_days where schedule_id = $1`, [id]);
    else ({ id } = await query(`insert into working_schedules (name, type, timezone, description) values ($1,$2,$3,$4) returning id`,
      [s.name, s.type, s.timezone, s.description]).then((r) => r.rows[0]));
    for (const d of s.days) {
      await query(`insert into working_schedule_days (schedule_id, day_of_week, start_time, end_time, break_minutes, is_rest_day)
                   values ($1,$2,$3,$4,$5,$6)`, [id, d.day, d.start || null, d.end || null, d.brk ?? d.break ?? 0, !!d.rest]);
    }
    const tot = await query(`select total_weekly_hours, days_per_week from working_schedules where id = $1`, [id]).then((r) => r.rows[0]);
    out.push({ id, name: s.name, days: s.days, weekly: Number(tot.total_weekly_hours), perWeek: Number(tot.days_per_week) });
    log(`  ${pad(s.name)} ${tot.days_per_week} days · ${tot.total_weekly_hours} h/week (trigger-derived)`);
  }
  return out;
}
async function seedHolidays() {
  step('Holidays + templates');
  for (const t of HOLIDAY_TEMPLATES) {
    await query(`insert into holiday_templates (name, month, day, type) values ($1,$2,$3,$4) on conflict do nothing`, [t.name, t.month, t.day, t.type]);
  }
  for (const h of HOLIDAYS) {
    await query(`insert into holidays (day, name, type, year, template_id) values ($1,$2,$3,$4,
                   (select id from holiday_templates where name = $5)) on conflict (day) do update set name = excluded.name, type = excluded.type`,
                [h.day, h.name, h.type, +h.day.slice(0, 4), h.name]);
  }
  log(`  ${HOLIDAYS.length} dated holidays across 2025-26 and 2026-27`);
}
async function seedStructures() {
  step('Salary structures + rules');
  const out = {};
  for (const s of STRUCTURES) {
    const st = await query(`insert into salary_structures (name, code, description) values ($1,$2,$3)
                            on conflict (name) do update set description = excluded.description returning id`, [s.name, s.code, s.description]).then((r) => r.rows[0]);
    await query(`delete from salary_rules where salary_structure_id = $1`, [st.id]);
    for (const r of s.rules) {
      const cols = { salary_structure_id: st.id, name: r.name, code: r.code, category: r.category, line_kind: r.line_kind, sequence: r.sequence,
        computation_type: r.computation_type, amount: r.amount ?? null, percentage: r.percentage ?? null, base_code: r.base_code ?? null,
        formula: r.formula ?? null, condition_expr: r.condition_expr ?? null, quantity_expr: r.quantity_expr ?? null,
        pro_rata: r.pro_rata ?? true, evaluation_period: r.evaluation_period || 'PERIOD', cap_amount: r.cap_amount ?? null, annual_cap: r.annual_cap ?? null,
        rounding_mode: r.rounding_mode || 'half_up', is_taxable: r.is_taxable ?? true, is_report_only: !!r.is_report_only,
        appears_on_payslip: r.appears_on_payslip ?? true, appears_in_report: r.appears_in_report ?? true, statutory: !!r.statutory,
        notes: r.notes ?? null };
      const names = Object.keys(cols);
      await query(`insert into salary_rules (${names.join(', ')}) values (${names.map((_, i) => `$${i + 1}`).join(', ')})`,
                  names.map((n) => cols[n]));
    }
    const n = await query(`select count(*) as n from salary_rules where salary_structure_id = $1`, [st.id]).then((r) => Number(r.rows[0].n));
    out[s.code] = { id: st.id, name: s.name, rules: n, inputs: s.inputs || null };
    log(`  ${pad(s.name)} ${n} rules`);
  }
  for (const s of PT_SLABS) {
    await query(`insert into pt_slabs (state, wage_from, wage_to, monthly_amount) values ($1,$2,$3,$4) on conflict (state, wage_from, effective_from) do update set monthly_amount = excluded.monthly_amount`,
                [s.state, s.wage_from, s.wage_to, s.monthly_amount]);
  }
  log(`  ${PT_SLABS.length} professional-tax slabs`);
  return out;
}
async function seedUsers() {
  step('Logins');
  const hash = await hashPassword(config.demo.password); // everyone in the demo shares one password
  const out = {};
  for (const u of USERS) {
    let id = await query(`select id from users where work_email = $1`, [u.work_email]).then((r) => r.rows[0]?.id);
    if (!id) ({ id } = await query(`insert into users (name, work_email, password_hash, role, is_active, must_change_pw)
                                    values ($1,$2,$3,$4,true,$5) returning id`, [u.name, u.work_email, hash, u.role, false]).then((r) => r.rows[0]));
    else await query(`update users set name=$2, role=$3, is_active=true, must_change_pw=false where id=$1`, [id, u.name, u.role]);
    await query(`delete from user_role_grants where user_id = $1`, [id]);
    for (const role of u.roles) await query(`insert into user_role_grants (user_id, role, granted_by) values ($1,$2,$1) on conflict do nothing`, [id, role]);
    out[u.key] = id;
    log(`  ${pad(u.work_email)} ${u.roles.join(' + ')}`);
  }
  return { ids: out, hash };
}
async function seedEmployees({ depts, schedules, structures, users }) {
  step('Employees + contracts');
  const hash = users.hash;
  const map = {};
  for (const [i, e] of EMPLOYEES.entries()) {
    const deptId = depts[e.dept];
    const schedule = schedules[e.schedule] || schedules[0];
    const structure = structures[e.structure];
    let emp = await query(`select id from employees where work_email = $1`, [e.email]).then((r) => r.rows[0]) || null;
    let userId = await query(`select id from users where work_email = $1`, [e.email]).then((r) => r.rows[0]?.id);
    if (!userId) ({ id: userId } = await query(`insert into users (name, work_email, password_hash, role, is_active, must_change_pw)
                               values ($1,$2,$3,'EMPLOYEE',true,false) returning id`, [e.name, e.email, hash]).then((r) => r.rows[0]));
    const code = `EMP${String(i + 1).padStart(4, '0')}`;
    if (emp) await query(`update employees set name=$2, work_email=$3, department_id=$4, job_position=$5, employee_type=$6, working_schedule_id=$7,
                                 date_of_joining=$8, date_of_exit=$9, status='ACTIVE', user_id=$10 where id=$1`,
                         [emp.id, e.name, e.email, deptId, e.position, e.type, schedule.id, e.joining, e.exit || null, userId]);
    else {
      emp = await query(`insert into employees (employee_code, user_id, name, work_email, phone, gender, date_of_birth, address, city, state, pincode,
                                            work_location, department_id, job_position, employee_type, working_schedule_id, date_of_joining, date_of_exit, status,
                                            employment_tag, basic_salary, bank_account_number, bank_ifsc, bank_name, pan_number, uan_number, esi_number, notes)
                                     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28) returning id`,
        [code, userId, e.name, e.email, `98${(25000000 + i * 12345).toString().slice(0, 8)}`, e.gender,
         `199${4 + (i % 4)}-0${(i % 8) + 1}-1${(i % 9) + 1}`, `${101 + i * 3} Sadan Road`, e.city, 'Gujarat', `3800${(15 + i).toString().padStart(2, '0')}`,
         e.city, deptId, e.position, e.type, schedule.id, e.joining, e.exit || null, 'ACTIVE',
         e.type === 'INTERN' ? 'Internship' : e.type === 'CONTRACT' ? 'Fixed term' : 'Permanent', e.wage,
         `5${(i * 7 + 11).toString().padStart(4, '0')}${(i * 13 + 7).toString().padStart(6, '0')}`, 'HDFC0000123', 'HDFC Bank',
         `ABCP${(1000 + i)}M`, `100${(2400000 + i * 137).toString().padStart(9, '0')}`, e.wage < 21000 ? `ESI${(400000 + i).toString().padStart(10, '0')}` : null,
         `Demo profile · ${schedule.name}`]).then((r) => r.rows[0]);
    }
    map[e.key] = { id: emp.id, code, wage: e.wage, structure: e.structure, schedule, inputs: e.inputs || null, deptId, joining: e.joining, exit: e.exit || null };
    // one primary contract that runs to the exit date (or open-ended)
    const existingId = await query(`select id from contracts where employee_id = $1 and is_primary = true`, [emp.id]).then((r) => r.rows[0]?.id);
    const c = { employee_id: emp.id, start_date: e.joining, end_date: e.exit || null, department_id: deptId, job_position: e.position,
                wage: e.wage, salary_structure_id: structure.id, working_schedule_id: schedule.id, status: 'RUNNING', is_primary: true,
                notes: `Seeded contract for ${e.name}` };
    if (existingId) await query(`update contracts set end_date=$2, wage=$3, salary_structure_id=$4, working_schedule_id=$5, status='RUNNING', department_id=$6, job_position=$7 where id=$1`,
      [existingId, c.end_date, c.wage, c.salary_structure_id, c.working_schedule_id, c.department_id, c.job_position]);
    else await query(`insert into contracts (employee_id, start_date, end_date, department_id, job_position, wage, salary_structure_id, working_schedule_id, status, is_primary, notes)
                      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, Object.values(c));
    log(`  ${pad(code)} ${pad(e.name, 20)} ${pad(e.structure, 5)} ₹${String(e.wage).padStart(7)}  ${e.dept}`);
  }
  // reporting lines + department heads once everyone exists
  for (const e of EMPLOYEES) if (e.manager && map[e.manager]) await query(`update employees set manager_id = $2 where id = $1`, [map[e.key].id, map[e.manager].id]);
  for (const d of DEPARTMENTS) {
    const head = EMPLOYEES.find((e) => e.dept === d.name && !e.manager);
    if (head && depts[d.name] && map[head.key]?.id) await query(`update departments set manager_id = $2 where id = $1`, [depts[d.name], map[head.key].id]);
  }
  return map;
}
async function seedAttendance({ empMap }) {
  step('Attendance');
  const rand = rng(20260905);
  const holidaySet = new Set((await rows(`select day from holidays`)).map((h) => toIso(h.day)));
  const inserts = [];
  for (const e of Object.values(empMap)) {
    for (const month of ATTENDANCE_MONTHS) {
      const from = `${month}-01`;
      const to = month < monthOf(toIso(new Date())) ? monthEnd(`${month}-01`) : toIso(new Date());
      for (const day of eachDay(from, to)) {
        const dow = new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
        const sched = e.schedule.days.find((d) => d.day === dow);
        if (!sched || sched.rest || holidaySet.has(day)) continue;
        if (e.exit && day > e.exit) continue;
        if (day < e.joining) continue;
        const expected = dayHours(sched);
        const roll = rand();
        if (roll < 0.04) { inserts.push([e.id, day, null, null, null, null, 0, expected, 0, 'ABSENT', false, null]); continue; }
        const late = roll > 0.86;
        const half = roll > 0.985;
        const inMin = hhmm(sched.start) + Math.floor(rand() * (late ? 42 : 12));
        const outMin = half ? inMin + Math.round(expected * 30) : hhmm(sched.end) + Math.floor(rand() * (roll > 0.93 ? 75 : 12));
        const brk = sched.brk || 0;
        const worked = ((outMin - inMin) / 60).toFixed(2);
        const net = Math.max(0, (outMin - inMin - brk) / 60);
        const over = Math.max(0, net - expected);
        const ot = over >= 0.5 ? Math.round(over * 4) / 4 : 0;
        inserts.push([e.id, day, `${day}T${shift(inMin)}:00+05:30`, `${day}T${shift(outMin)}:00+05:30`, Number(worked), Number(net.toFixed(2)), brk,
                      expected, ot, half ? 'HALF_DAY' : ot ? 'OVERTIME' : late ? 'LATE' : 'PRESENT', ot > 0 && rand() > 0.15, null]);
      }
    }
  }
  const COLS = 12;
  for (let i = 0; i < inserts.length; i += 200) {
    const chunk = inserts.slice(i, i + 200);
    const values = chunk.map((_, r) => `(${Array.from({ length: COLS }, (_, c) => `$${r * COLS + c + 1}`).join(',')})`).join(',');
    await query(`insert into attendance (employee_id, day, check_in, check_out, worked_hours, net_worked_hours, break_minutes,
                                          expected_hours, overtime_hours, status, overtime_approved, manual_reason, source)
                 values ${chunk.map((_, r) => `(${Array.from({ length: COLS }, (_, c) => `$${r * COLS + c + 1}`).join(',')}, 'seed')`).join(',')}
                 on conflict (employee_id, day) do update set check_in = excluded.check_in, check_out = excluded.check_out,
                       worked_hours = excluded.worked_hours, net_worked_hours = excluded.net_worked_hours, break_minutes = excluded.break_minutes,
                       expected_hours = excluded.expected_hours, overtime_hours = excluded.overtime_hours, status = excluded.status,
                       overtime_approved = excluded.overtime_approved`,
                chunk.flat());
  }
  log(`  ${inserts.length} attendance rows across ${ATTENDANCE_MONTHS.length} months (source='seed')`);
}
async function seedTimeOff({ empMap, auth }) {
  step('Time off: types, allocations, requests');
  const typeIds = {};
  for (const t of LEAVE_TYPES) {
    const cols = { name: t.name, code: t.code, unit: t.unit, requires_allocation: t.requires_allocation, max_days_per_year: t.max_days_per_year,
      approval_route: t.approval_route, work_entry_type: t.work_entry_type, is_unpaid: t.is_unpaid, payslip_code: t.payslip_code,
      is_encashable: false, carry_forward: t.carry_forward, sandwich_rule: t.sandwich_rule, min_notice_days: t.min_notice_days,
      display_color: t.display_color, is_active: 'ACTIVE', description: t.description, category: t.category || 'OTHER' };
    const row = await query(`insert into time_off_types (${Object.keys(cols).join(', ')}) values (${Object.keys(cols).map((_, i) => `$${i + 1}`).join(', ')})
                            on conflict (code) do update set description = excluded.description, is_active = 'ACTIVE' returning id`, Object.values(cols)).then((r) => r.rows[0]);
    typeIds[t.code] = row.id;
  }
  log(`  ${LEAVE_TYPES.length} types`);
  const fyFrom = '2026-04-01';
  const fyTo = '2027-03-31';
  // What to grant is read off LEAVE_TYPES, not hard-coded: every type that both needs a balance and has an
  // annual entitlement gets one, so a type added to the seed data is funded automatically instead of showing
  // up as "No leave balance yet" on someone's dashboard.
  const grants = LEAVE_TYPES.filter((t) => t.requires_allocation && t.max_days_per_year).map((t) => [t.code, t.max_days_per_year]);
  for (const e of Object.values(empMap)) {
    for (const [code, days] of grants) {
      await query(`insert into time_off_allocations (employee_id, time_off_type_id, allocated_days, taken_days, pending_days, remaining_days, valid_from, valid_until, status, description)
                   values ($1,$2,$3,0,0,$3,$4,$5,'APPROVED','FY 2026-27 grant')
                   on conflict (employee_id, time_off_type_id, valid_from) do update set allocated_days = excluded.allocated_days, remaining_days = excluded.allocated_days - time_off_allocations.taken_days, status='APPROVED'`,
                  [e.id, typeIds[code], days, fyFrom, fyTo]);
    }
  }
  log(`  ${grants.length} grant(s) per employee for FY 2026-27: ${grants.map(([c, d]) => c + ' ' + d).join(', ')}`);
  const already = await query(`select count(*) as n from time_off_requests`).then((r) => Number(r.rows[0].n));
  if (already) { log(`  ${already} request(s) already recorded — leaving them alone`); return; }
  // Requests go through the service so the balance maths and the approval trail are the real thing.
  const svc = await import('../../src/services/timeoff.service.js');
  const people = Object.values(empMap);
  const plan = [
    { who: people[0], code: 'CL', from: '2026-08-11', to: '2026-08-12', status: 'APPROVED', reason: 'Family function in Surat' },
    { who: people[1], code: 'SL', from: '2026-08-19', to: '2026-08-19', status: 'APPROVED', reason: 'Fever' },
    { who: people[3], code: 'LWP', from: '2026-09-07', to: '2026-09-08', status: 'APPROVED', reason: 'Extended travel, unpaid' },
    { who: people[2], code: 'PL', from: '2026-10-15', to: '2026-10-20', status: 'TO_APPROVE', reason: 'Diwali with family' },
    { who: people[5], code: 'CL', from: '2026-09-11', to: '2026-09-11', status: 'TO_APPROVE', reason: 'Client visit afterwards' },
    { who: people[7], code: 'CL', from: '2026-09-18', to: '2026-09-19', status: 'TO_APPROVE', reason: 'Personal' },
    { who: people[4], code: 'CL', from: '2026-08-05', to: '2026-08-06', status: 'REFUSED', reason: 'Two of us cannot be off the same day' },
    { who: people[6], code: 'PL', from: '2026-11-30', to: '2026-12-04', status: 'TO_APPROVE', reason: 'Wedding in the family' },
  ];
  let approved = 0;
  for (const p of plan) {
    const type = LEAVE_TYPES.find((t) => t.code === p.code);
    if (!type.requires_allocation && p.status === 'TO_APPROVE') { /* fine */ }
    let req;
    try {
      req = await svc.createRequest({ employee_id: p.who.id, time_off_type_id: typeIds[p.code], start_date: p.from, end_date: p.to, reason: p.reason, status: 'TO_APPROVE' }, { auth });
    } catch (err) {
      const expected = ['NO_ALLOCATION', 'NOTICE_REQUIRED', 'MAX_DAYS_EXCEEDED', 'INSUFFICIENT_BALANCE', 'DUPLICATE_PERIOD'];
      if (expected.includes(err.code)) { log(`  · skipped ${p.code} ${p.from}: ${err.code}`); continue; }
      throw err;
    }
    if (p.status === 'APPROVED') { await svc.decide(req.id, { status: 'APPROVED' }, { auth }); approved += 1; }
    if (p.status === 'REFUSED') await svc.decide(req.id, { status: 'REFUSED', refuse_reason: p.reason }, { auth });
  }
  log(`  ${plan.length} requests (${approved} approved through the service, 3 waiting for HR)`);
}
async function seedPayroll({ empMap, structures, auth }) {
  step('Payroll: 9 runs driven through the real services');
  const payrun = await import('../../src/services/payrun.service.js');
  const payslip = await import('../../src/services/payslip.service.js');
  const byStructure = {};
  for (const [key, e] of Object.entries(empMap)) (byStructure[e.structure] ||= []).push(e);
  const created = [];
  for (const run of RUNS) {
    for (const [code, list] of Object.entries(byStructure)) {
      const structure = structures[code];
      const eligible = list.filter((e) => (!e.exit || e.exit >= run.to) && e.joining <= run.to);
      if (!eligible.length) continue;
      let pay;
      try {
        pay = await payrun.create({ salary_structure_id: structure.id, period_start: run.from, period_end: run.to,
          pay_frequency: run.freq, compute_mode: run.mode, employee_ids: eligible.map((e) => e.id),
          name: `${run.halves === 'H1' ? 'First half' : run.halves === 'H2' ? 'Second half' : new Date(`${run.from}T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${run.from.slice(0, 4)} — ${structure.name}`,
          notes: 'Seeded demo run' }, { auth });
      } catch (err) {
        if (err.code === 'PAYRUN_EXISTS' || err.code === 'DUPLICATE_PERIOD') { log(`  · ${structure.name} ${run.from.slice(0, 7)} already exists`); continue; }
        throw err;
      }
      // per-employee inputs first, so the formula rules have their variables
      if (structure.inputs) {
        for (const e of eligible) {
          const slip = await query(`select id from payslips where payrun_id = $1 and employee_id = $2`, [pay.id, e.id]).then((r) => r.rows[0]);
          if (!slip) continue;
          const vals = { ...structure.inputs, ...(e.inputs || {}) };
          for (const [code, amount] of Object.entries(vals)) {
            await query(`insert into payslip_inputs (payslip_id, code, name, amount, reason) values ($1,$2,$3,$4,'Seeded input')
                         on conflict (payslip_id, code) do update set amount = excluded.amount`, [slip.id, code.toUpperCase(), code, amount]);
          }
        }
      }
      const res = await payrun.compute(pay.id, { auth });
      created.push({ id: pay.id, run, structure: structure.name, computed: res.computed, failed: res.failed });
      if (run.status === 'PAID') {
        await payrun.validate(pay.id, { auth });
        await payrun.markPaid(pay.id, { auth, releaseDocuments: false });
      }
      log(`  ${pad(run.from.slice(0, 7))} ${pad(structure.name, 24)} ${String(eligible.length).padStart(2)} slips  net ₹${(await query(`select coalesce(sum(net_amount),0) as n from payslips where payrun_id=$1`, [pay.id]).then((r) => Number(r.rows[0].n))).toLocaleString('en-IN')}`);
    }
  }
  const failed = created.reduce((a, c) => a + (c.failed || 0), 0);
  if (failed) log(`  ⚠ ${failed} payslip(s) failed to compute — check the payrun warnings`);
  // A couple of real PDFs so the portal download works the first click
  const sample = await query(`select p.id, e.employee_code from payslips p join employees e on e.id = p.employee_id
                              where p.status = 'PAID' order by p.period_end desc, e.name limit 3`);
  for (const s of sample.rows) { try { await payslip.renderPdf(s.id, { auth, persist: true }); } catch (e) { log(`  · pdf skipped: ${e.message}`); } }
  log(`  ${sample.rowCount ?? sample.rows.length} payslip PDF(s) rendered into storage/pdfs`);
  // A correction for a locked period, raised the supported way
  const target = await query(`select p.id from payslips p join payruns r on r.id = p.payrun_id
                              join employees e on e.id = p.employee_id
                              where r.status = 'PAID' and e.employee_code = 'EMP0006' order by p.period_end desc limit 1`).then((r) => r.rows[0]);
  const open = await query(`select r.id from payruns r where r.status = 'DRAFT' order by r.period_start desc limit 1`).then((r) => r.rows[0]);
  if (target && open) {
    try {
      const out = await payslip.raiseArrear(target.id, { amount: 4200, reason: 'HRA revision arrears for Q1 (retrospective)', target_payrun_id: open.id }, { auth });
      log(`  arrear ₹4,200 carried into ${out.payrun.name}`);
    } catch (e) { log(`  · arrear skipped: ${e.code || e.message}`); }
  }
  return created;
}
async function seedWrinkles() {
  step('Demo wrinkles (things HR has to fix)');
  await query(`update employees set bank_account_number = null, bank_ifsc = null, bank_name = null where employee_code = 'EMP0009'`);
  log('  EMP0009 has no bank details → "missing bank" warning + report filter');
  const ot = await query(`update attendance set overtime_approved = false where overtime_hours > 0 and day = (select max(day) from attendance)
                          and employee_id = (select id from employees where employee_code = 'EMP0008') returning id`);
  log(`  ${ot.rowCount} overtime row(s) left unapproved → they must not reach payroll`);
  await query(`update contracts set notes = coalesce(notes,'') || ' · contract expiring, renewal due' where employee_id = (select id from employees where employee_code='EMP0010') and end_date is null`);
}
async function summary() {
  const s = await query(`select (select count(*) from employees) as employees, (select count(*) from users) as users,
                                 (select count(*) from contracts) as contracts, (select count(*) from attendance) as attendance,
                                 (select count(*) from payruns) as payruns, (select count(*) from payslips where status='PAID') as paid_slips,
                                 (select coalesce(sum(net_amount),0) from payslips where status='PAID') as paid_net,
                                 (select count(*) from time_off_requests where status='TO_APPROVE') as pending_leave,
                                 (select count(*) from salary_rules) as rules`);
  const r = s.rows[0];
  console.log('\n┌─ Seeded ─────────────────────────────────────────────┐');
  for (const [k, v] of Object.entries({ employees: r.employees, users: r.users, contracts: r.contracts, attendance: r.attendance,
    'salary rules': r.rules, payruns: r.payruns, 'paid payslips': r.paid_slips, 'net paid': `₹${Number(r.paid_net).toLocaleString('en-IN')}`,
    'leave awaiting HR': r.pending_leave })) console.log(`│ ${pad(k, 20)} ${String(v).padStart(12)} │`);
  console.log('└────────────────────────────────────────────────────────┘');
  printLogins();
}
/** The sign-in details, printed after a seed *and* when a seed was already done — that is the moment
 *  someone needs them. */
function printLogins() {
  banner([
    ['API', `http://localhost:${config.port}/api`],
    ['Web', `http://localhost:${config.webPort}`],
    ['Admin', `http://localhost:${config.webPort}/login`],
  ], 'PeoplePay360 — sign in');
  // Every address the README lists has to be printed here with the roles it carries — otherwise a
  // login that was never seeded reads as a broken account.
  console.log('   ' + USERS.map((u) => u.work_email).join(' · ') + '   password: ' + config.demo.password);
  console.log('   one role each: ' + USERS.map((u) => u.work_email.split('@')[0] + '=' + u.role).join('  '));
  console.log('   every employee address above works too (e.g. aarav.mehta@oxp.com) as a plain employee login\n');
}
async function main() {
  await assertMigrated();
  if (has('--reset')) await reset();
  // Company settings and the demo logins run first and run always. Both are upserts, so re-running costs
  // nothing but guarantees that every address printed at the bottom works — even in a database that was
  // seeded before a login was added.
  await seedCompany();
  const users = await seedUsers();
  if (await alreadySeeded()) { if (!has('--if-empty')) printLogins(); return; }
  const depts = await seedDepartments();
  const schedules = await seedSchedules();
  await seedHolidays();
  const structures = await seedStructures();
  const empMap = await seedEmployees({ depts, schedules, structures, users });
  await seedAttendance({ empMap });
  const auth = { userId: users.ids.admin, roles: ['ADMIN'], scope: 'company', name: 'Seeder' };
  await seedTimeOff({ empMap, auth });
  if (!has('--skip-payroll')) await seedPayroll({ empMap, structures, auth });
  await seedWrinkles();
  await summary();
}
main().then(() => pool.end().catch(() => {})).then(() => process.exit(0)).catch(async (e) => {
  console.error('\n✗ seed failed:', e.code ? `${e.code}: ` : '', e.message);
  if (e.details) console.error('  ', JSON.stringify(e.details).slice(0, 400));
  await pool.end().catch(() => {});
  process.exit(1);
});
