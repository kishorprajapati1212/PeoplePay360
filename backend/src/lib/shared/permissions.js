/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *  THE ONE PLACE ACCESS CONTROL IS DEFINED
 *  ------------------------------------------------------------------------
 *  • backend  : requirePermission('employee:write')            (middleware/rbac.js)
 *  • frontend : <Can perm="payroll:validate">, nav filtering     (src/rbac/)
 *  • menus    : ROLE_NAV                                        (drives the top bar)
 *
 *  TO CHANGE WHO CAN DO WHAT → edit ROLE_PERMISSIONS below. Nothing else.
 *  Deny wins over allow, `*` means everything, `resource:*` means every action on a resource,
 *  and `@own` on a permission means "row-level scope: only your own records" (enforced by
 *  src/middleware/scope.js — see the note on each role).
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import { ROLES } from './enums.js';

/** Catalogue of every permission: label + what it actually unlocks (shown in the Roles screen). */
export const PERMISSIONS = {
  // employee self-service
  'profile:read':            { label: 'View own profile',              desc: 'Employee portal: profile card' },
  'attendance:read_own':     { label: 'View own attendance',           desc: 'Own monthly registers' },
  'attendance:clock':        { label: 'Clock in / out',                desc: 'Kiosk + own-day attendance' },
  'contract:read_own':       { label: 'View own contract',             desc: 'Wage, dates, schedule' },
  'timeoff:read_own':        { label: 'View own leave requests',       desc: 'Portal: my time off' },
  'timeoff:request':         { label: 'Raise time off request',        desc: 'Create / cancel own request' },
  'payslip:read_own':        { label: 'View own payslips',             desc: 'Portal: net, gross, period' },
  'payslip:download_own':    { label: 'Download own payslip PDF',      desc: 'Portal download; every hit is audited' },

  // HR operations
  'employee:read':           { label: 'View employees',                desc: 'Directory, kanban, smart buttons' },
  'employee:create':         { label: 'Create employee',               desc: 'Includes employee + user together' },
  'employee:write':          { label: 'Edit employee',                 desc: 'Master data, bank, reporting' },
  'employee:terminate':      { label: 'Terminate / soft delete',       desc: 'Never a hard delete' },
  'employee:import':         { label: 'Bulk import employees',          desc: 'CSV import + validation report' },
  'department:read':         { label: 'View departments' },
  'department:write':        { label: 'Create / edit departments' },
  'schedule:read':           { label: 'View working schedules' },
  'schedule:write':          { label: 'Create / edit schedules',        desc: 'Weekly grid: start, end, break, hours' },
  'holiday:read':            { label: 'View holidays' },
  'holiday:write':           { label: 'Create / edit holidays' },
  'attendance:read':         { label: 'View everyone’s attendance',     desc: 'Registers, imports, corrections' },
  'attendance:write':        { label: 'Edit attendance',                desc: 'Manual entry + missing punch fixes' },
  'attendance:approve_overtime': { label: 'Approve overtime',          desc: 'Only approved OT reaches payroll' },
  'timeoff:type_read':       { label: 'View leave types' },
  'timeoff:type_write':      { label: 'Create / edit leave types' },
  'timeoff:approve':         { label: 'Approve / refuse time off',      desc: 'Also moves the days off the balance' },
  'timeoff:allocation_read': { label: 'View leave balances' },
  'timeoff:allocation_write':{ label: 'Grant / adjust balances',        desc: 'Carry-forward, accruals, manual' },
  'contract:read':           { label: 'View all contracts' },
  'contract:write':          { label: 'Create / edit contracts',        desc: 'One running contract per period' },
  'contract:terminate':      { label: 'Terminate / renew contracts' },

  // payroll
  'dashboard:payroll':       { label: 'Payroll dashboard',             desc: 'KPIs, cost by dept, trend, alerts' },
  'dashboard:hr':            { label: 'HR dashboard',                  desc: 'Attendance + time-off overviews' },
  'salary:structure_read':   { label: 'View salary structures' },
  'salary:structure_write':  { label: 'Create / edit structures' },
  'salary:rule_read':        { label: 'View salary rules' },
  'salary:rule_write':       { label: 'Create / edit salary rules',     desc: 'Fixed, % of wage, formula (sandboxed)' },
  'payroll:payrun_read':     { label: 'View payruns' },
  'payroll:payrun_create':   { label: 'Create payrun',                desc: 'Select employees → draft payslips' },
  'payroll:compute':         { label: 'Compute / recompute payslips' },
  'payroll:validate':        { label: 'Validate payrun',              desc: 'Locks the computation' },
  'payroll:mark_paid':       { label: 'Mark payrun paid',              desc: 'After this the numbers are frozen' },
  'payroll:payrun_delete':   { label: 'Void payrun',                  desc: 'Only while nothing was paid or sent' },
  'payslip:read_all':        { label: "View anyone's payslip" },
  'payslip:edit_lines':      { label: 'Edit payslip lines',           desc: 'Manual bonus, loan recovery, arrear' },
  'payslip:arrear':          { label: 'Raise arrear payslip',          desc: 'Correction for a paid/locked period' },
  'payroll:export':          { label: 'Export CSV (bank + salary register)' },
  'payroll:pdf':             { label: 'Generate payslip PDFs',        desc: 'Queued to the worker' },
  'payroll:send_bulk':       { label: 'Email payslips to everyone',    desc: 'Bulk send via Redis queue' },
  'report:attendance':       { label: 'Attendance reports / exports' },
  'report:payroll':          { label: 'Payroll registers / exports' },

  // administration
  'user:read':               { label: 'View users / access matrix' },
  'user:create':             { label: 'Create user (with employee)' },
  'user:write':              { label: 'Edit user + assign roles',      desc: 'Admin only — stops privilege escalation' },
  'user:deactivate':         { label: 'Activate / deactivate users' },
  'user:reset_password':     { label: 'Reset a password' },
  'settings:read':           { label: 'View company settings' },
  'settings:write':          { label: 'Change company settings',        desc: 'Weekoff, PT slab, payslip header/footer' },
  'audit:read':              { label: 'View the audit log' },
  'system:queue':            { label: 'View jobs / queue health' },
  'system:seed':             { label: 'Load demo data' },
};

/**
 * Role → permissions. Multi-role logins are unioned (the mockup allows several roles per user).
 * `@own` suffix = the user only sees rows that belong to them (enforced by scope middleware).
 */
const HR_CORE = [
  'employee:read', 'employee:create', 'employee:write', 'employee:terminate',
  'department:read', 'department:write',
  'schedule:read', 'schedule:write', 'holiday:read', 'holiday:write',
  'attendance:read', 'attendance:write', 'attendance:approve_overtime', 'report:attendance',
  'timeoff:type_read', 'timeoff:type_write', 'timeoff:request', 'timeoff:approve',
  'timeoff:allocation_read', 'timeoff:allocation_write', 'attendance:clock',
  'contract:read', 'contract:write', 'contract:terminate',
  'salary:structure_read', 'settings:read', 'dashboard:hr',
];
const PAYROLL_CALC = [
  'salary:rule_read', 'payroll:payrun_read', 'payroll:payrun_create', 'payroll:compute',
  'payroll:validate', 'payroll:mark_paid', 'payslip:read_all', 'payroll:pdf', 'report:payroll', 'dashboard:payroll',
];
const PAYROLL_CONTROL = [
  'salary:structure_write', 'salary:rule_write', 'payroll:payrun_delete', 'payslip:edit_lines',
  'payslip:arrear', 'payroll:export', 'payroll:send_bulk', 'settings:read',
];
export const ROLE_PERMISSIONS = {
  EMPLOYEE: [
    'profile:read', 'attendance:read_own', 'attendance:clock', 'contract:read_own',
    'timeoff:read_own', 'timeoff:request', 'timeoff:type_read', 'payslip:read_own', 'payslip:download_own',
    'department:read', 'schedule:read', 'holiday:read',
  ],
  HR_MANAGER: HR_CORE,
  HR_PAYROLL_USER: [...HR_CORE, ...PAYROLL_CALC],
  HR_PAYROLL_MANAGER: [...HR_CORE, ...PAYROLL_CALC, ...PAYROLL_CONTROL],
  ADMIN: ['*'],
};

/** Roles that may open the "User Access" screen at all (Admin only, per the mockup). */
export const USER_ADMIN_ROLES = ['ADMIN'];

/** Explicit denials, evaluated after allows. Kept here so "who can never do what" is also one-glance. */
export const DENIES = {
  EMPLOYEE: ['employee:*', 'payroll:*', 'salary:*', 'user:*', 'audit:read', 'settings:*'],
  HR_MANAGER: ['payroll:compute', 'payroll:validate', 'payroll:mark_paid', 'salary:rule_write', 'salary:structure_write', 'user:*', 'audit:read', 'settings:write', 'payroll:send_bulk'],
  HR_PAYROLL_USER: ['user:*', 'audit:read', 'settings:*', 'payroll:send_bulk', 'payroll:payrun_delete', 'salary:structure_write', 'salary:rule_write', 'payslip:edit_lines'],
  HR_PAYROLL_MANAGER: ['user:*', 'audit:read', 'settings:write', 'system:*'],
};

/** Row-level scope: which employees' rows a role may read/write. */
export const SCOPE = {
  EMPLOYEE: 'own',            // only their own records
  HR_MANAGER: 'company',      // everything except payroll money
  HR_PAYROLL_USER: 'company',
  HR_PAYROLL_MANAGER: 'company',
  ADMIN: 'company',
};

/** Top navigation — order and labels follow the mockup (Employees / Contracts / Attendance / Time Off / Payroll). */
export const ROLE_NAV = {
  EMPLOYEE: [
    { key: 'portal', label: 'My Portal', to: '/portal', perm: 'profile:read' },
    { key: 'attendance', label: 'Attendance', to: '/attendance', perm: 'attendance:read_own' },
    { key: 'timeoff', label: 'Time Off', to: '/time-off/my-requests', perm: 'timeoff:read_own' },
    { key: 'payslips', label: 'Payslips', to: '/payslips', perm: 'payslip:read_own' },
  ],
  HR_MANAGER: [
    { key: 'dashboard', label: 'Dashboard', to: '/dashboard', perm: 'dashboard:hr' },
    { key: 'employees', label: 'Employees', to: '/employees', children: [
      { label: 'Directory', to: '/employees' },
      { label: 'Departments', to: '/departments' },
      { label: 'Working Schedules', to: '/working-schedules' },
      { label: 'Holidays', to: '/holidays' },
    ] },
    { key: 'contracts', label: 'Contracts', to: '/contracts' },
    { key: 'attendance', label: 'Attendance', to: '/attendance', perm: 'attendance:read' },
    { key: 'timeoff', label: 'Time Off', to: '/time-off', perm: 'timeoff:approve', children: [
      { label: 'Dashboard', to: '/time-off' },
      { label: 'Time Off Requests', to: '/time-off/requests' },
      { label: 'Time Off Types', to: '/time-off/types' },
      { label: 'Allocations', to: '/time-off/allocations' },
    ] },
    { key: 'payroll', label: 'Payroll', to: '/payroll', perm: 'salary:structure_read', children: [
      { label: 'Structures', to: '/salary/structures' },
      { label: 'Rules', to: '/salary/rules' },
    ] },
  ],
  HR_PAYROLL_USER: ['+payroll_user'],  // '+name' = inherit that role's nav, then apply OVERRIDES
  HR_PAYROLL_MANAGER: ['+payroll_user', 'payrun_admin'],
  ADMIN: ['*'],
};
/** Payroll additions layered on top of the HR nav (the mockup's Payroll menu). */
export const NAV_OVERRIDES = {
  payroll_user: [
    { key: 'payroll', label: 'Payroll', to: '/payroll', children: [
      { label: 'Dashboard', to: '/payroll' },
      { label: 'Payruns', to: '/payruns' },
      { label: 'Payslips', to: '/payslips' },
      { label: 'Structures', to: '/salary/structures' },
      { label: 'Rules', to: '/salary/rules' },
    ] },
  ],
  payrun_admin: [
    { key: 'settings', label: 'Settings', to: '/company', children: [
      { label: 'Company', to: '/company' },
      { label: 'Salary Rules Help', to: '/salary/rules' },
    ] },
  ],
};

export function permissionsFor(roles = []) {
  const set = new Set();
  for (const role of roles) {
    for (const p of ROLE_PERMISSIONS[role] || []) {
      if (p === '*') return { all: true, list: Object.keys(PERMISSIONS) };
      set.add(p);
    }
  }
  return { all: false, list: [...set] };
}

/**
 * Deny is only a veto when *no* role the user holds grants the permission — so an
 * "Hr Payroll Admin + Hr Manager" login keeps admin powers, while a lone HR Manager cannot
 * compute a payrun. ADMIN short-circuits everything.
 */
export function can(perm, { roles = [], permissions = [] } = {}) {
  if (!perm) return true;
  if (roles.includes('ADMIN') || permissions.includes('*')) return true;
  const granted = (p) => permissions.some((x) => matches(x, p)) || roles.some((r) => (ROLE_PERMISSIONS[r] || []).some((x) => matches(x, p)));
  if (granted(perm)) return true;
  return false;
}
/** Is this permission explicitly denied for every one of the roles? (used to grey out UI + tests) */
/** Pattern match: '*' , 'resource:*' or an exact permission. */
function matches(pattern, perm) {
  if (!pattern) return false;
  if (pattern === '*' || pattern === perm) return true;
  if (pattern.endsWith(':*')) return perm.startsWith(pattern.slice(0, -1));
  return false;
}
export function isDenied(perm, roles = []) {
  if (!roles.length) return false;
  return roles.every((r) => (DENIES[r] || []).some((d) => matches(d, perm))) && !grantedByRoles(perm, roles);
}
function grantedByRoles(perm, roles) {
  return roles.some((r) => (ROLE_PERMISSIONS[r] || []).some((p) => matches(p, perm)));
}
/** Expand a role's nav spec ('+other_role' inherits, '*' = everything) into concrete menus. */
export function navFor(roles = []) {
  if (roles.includes('ADMIN')) return fullNav();
  const out = new Map();
  for (const role of roles) {
    let spec = ROLE_NAV[role];
    if (!spec) continue;
    for (const item of spec) {
      if (typeof item === 'string' && item.startsWith('+')) {
        for (const x of NAV_OVERRIDES[item.slice(1)] || []) out.set(x.key, x);
        continue;
      }
      if (item === '*') return fullNav();
      out.set(item.key, item);
    }
  }
  const perms = permissionsFor(roles);
  return [...out.values()].filter((n) => canPerm(n.perm, roles, perms));
}
function canPerm(perm, roles, perms) {
  if (!perm) return true;
  return perms.all || perms.list.some((p) => matches(p, perm));
}
const FULL_NAV_ORDER = ['dashboard', 'employees', 'contracts', 'attendance', 'timeoff', 'payroll', 'settings', 'users'];
function fullNav() {
  const base = new Map();
  for (const role of ['HR_MANAGER']) for (const n of ROLE_NAV[role]) base.set(n.key, n);
  for (const n of NAV_OVERRIDES.payroll_user) base.set(n.key, n);
  for (const n of NAV_OVERRIDES.payrun_admin) base.set(n.key, n);
  base.set('users', { key: 'users', label: 'User Access', to: '/users', perm: 'user:read' });
  return FULL_NAV_ORDER.filter((k) => base.has(k)).map((k) => base.get(k));
}
export function scopeFor(roles = []) {
  for (const r of ROLES) if (roles.includes(r) && SCOPE[r] === 'company') return 'company';
  return roles.length ? 'own' : 'none';
}
