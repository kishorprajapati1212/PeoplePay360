import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_LABEL, ROLES, SCOPE, DENIES, navFor, can, isDenied } from '../lib/shared/index.js';

/**
 * ────────────────────────────────────────────────────────────────────────────────
 *  THE ONE PLACE ACCESS CONTROL IS DECIDED
 * ────────────────────────────────────────────────────────────────────────────────
 * The permission *tokens* and their role map live in src/lib/shared/src/permissions.js so the browser
 * and the server agree by construction. This file is the readable policy layer on top of it:
 *   • POLICY    — what each screen may do, in plain language (drives UI toggles + documents).
 *   • ROUTES    — which token each API family requires (mirrors routes/*.js; a test asserts they match).
 *   • MUTATIONS — state-machine rules money actions must obey on top of the permission check.
 *
 * To let, say, payroll users approve leave: add 'timeoff:approve' to PAYROLL_CONTROL in
 * src/lib/shared/src/permissions.js. That is the only edit — the API 403s, the nav, and every button
 * follow it, because they all read the same map. Nothing here hard-codes a role name in a controller.
 */
export const POLICY = {
  'Employees':     { read: 'employee:read',   write: 'employee:write',   note: 'Profiles, bank details, import. Payroll fields are on the contract.' },
  'Contracts':     { read: 'contract:read',   write: 'contract:write',   note: 'Wage + structure + schedule. Terminating here cascades nothing silently.' },
  'Attendance':    { read: 'attendance:read', write: 'attendance:write',  note: 'Punch edits are audited and need a reason; OT needs approve_overtime.' },
  'Time Off':      { read: 'timeoff:approve',    write: 'timeoff:request',     note: 'Employees apply on their own balance; approve/refuse needs timeoff:approve.' },
  'Payrun':        { read: 'payroll:payrun_read',     write: 'payroll:payrun_create',     note: 'Wizard creates rows only after the employee selection is confirmed.' },
  'Compute':       { read: 'payroll:payrun_read',     write: 'payroll:compute',    note: 'DRAFT/COMPUTED only. Re-running a VALIDATED run needs validate again.' },
  'Validate':      { read: 'payroll:payrun_read',     write: 'payroll:validate',   note: 'Blocks on ERROR warnings (negative net, missing bank, overlapping contract).' },
  'Mark Paid':     { read: 'payroll:payrun_read',     write: 'payroll:mark_paid',  note: 'Freezes payslips + PDFs. Immutable afterwards by DB trigger.' },
  'Send Payslips': { read: 'payroll:payrun_read',     write: 'payroll:send_bulk',      note: 'Queues one email per employee; ledger records delivery, never re-sends a changed PDF without force.' },
  'Payslips':      { read: 'payslip:read_all',    write: 'payslip:edit_lines',      note: 'Manual lines allowed while not PAID; after that raise an arrear.' },
  'Structures':    { read: 'salary:structure_read',  write: 'salary:structure_write',  note: 'Editing a structure never rewrites stored payslips.' },
  'Rules':         { read: 'salary:rule_read',       write: 'salary:rule_write',       note: 'Formulas are parsed, whitelisted, and previewed before saving.' },
  'Users':         { read: 'user:write',     write: 'user:write',       note: 'Role grants, activate/deactivate, password reset.' },
  'Company':       { read: 'settings:write',  write: 'settings:write',    note: 'Statutory switches, PF/ESI/PT, day divisor, mail limits.' },
  'Dashboard':     { read: 'dashboard:hr',  write: null,                note: 'Payroll numbers need dashboard:payroll; others get HR panels only.' },
  'Audit':         { read: 'audit:read',      write: null,                note: 'Read-only, append-only table.' },
  'System':        { read: 'system:queue',     write: 'system:queue',       note: 'Queue stats, retry failed jobs, run the seeder (dev).' },
};
/** Which token each API family needs, for the docs/test that keeps routes honest. */
export const ROUTES = {
  '/api/auth': null, '/api/employees': 'employee:read', '/api/users': 'user:write', '/api/org': 'department:read',
  '/api/contracts': 'contract:read', '/api/attendance': 'attendance:read', '/api/time-off': 'timeoff:approve',
  '/api/salary': 'salary:rule_read', '/api/payruns': 'payroll:payrun_read', '/api/payslips': 'payslip:read_all',
  '/api/portal': null, '/api/dashboard': 'dashboard:hr', '/api/company': 'settings:write', '/api/system': 'system:queue',
};
/** Extra guards that a permission token cannot express (they are enforced in the services). */
export const MUTATIONS = {
  'payruns.markPaid': { requires: 'payroll:mark_paid', state: 'VALIDATED', note: '409 WRONG_STATE otherwise; Idempotency-Key required' },
  'payruns.void': { requires: 'payroll:payrun_delete', forbidden_when: 'any payslip email already SENT', note: 'use an arrear run instead' },
  'payslips.lines': { requires: 'payslip:edit_lines', state: 'not PAID' },
  'payslips.arrear': { requires: 'payslip:arrear', state: 'source PAID, target run open' },
  'timeoff.approve': { requires: 'timeoff:approve', state: 'TO_APPROVE', note: 'approver may not be the requester' },
  'users.roles': { requires: 'user:write', note: 'refuses removing the last ACTIVE admin and self-demotion' },
};
/** Everything the SPA needs in one call: nav, tokens, labels, scope, denial overrides. */
export const accessMatrix = () => ({
  roles: ROLES.map((r) => ({ role: r, label: ROLE_LABEL[r], scope: SCOPE[r], permissions: ROLE_PERMISSIONS[r] === '*' ? Object.keys(PERMISSIONS) : [...(ROLE_PERMISSIONS[r] || [])],
                             denials: [...(DENIES[r] || [])], nav: navFor(r) })),
  permissions: Object.entries(PERMISSIONS).map(([token, meta]) => ({ token, ...meta })),
  policy: POLICY, routes: ROUTES, mutations: MUTATIONS,
  check: null,
});
/** The API's own guard, so controllers never re-implement role logic. */
export const allowed = (token, auth) => can(token, auth) && !isDenied(token, auth);
export { PERMISSIONS, ROLE_PERMISSIONS, ROLE_LABEL, ROLES, SCOPE, DENIES, navFor, can, isDenied };
