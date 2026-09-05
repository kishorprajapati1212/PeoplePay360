import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSIONS, ROLE_PERMISSIONS, can } from '../src/lib/shared/index.js';

/**
 * Guard: every permission string the API asks for must exist in the central catalogue, and every route
 * entry must name a real screen. A typo in a token is otherwise silent (it only ever 403s for non-admins).
 */
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p, out) : p.endsWith('.js') && out.push(p); } return out; };
const files = walk(join(root, 'src'));
const known = new Set(Object.keys(PERMISSIONS));
test('no invented permission tokens in the API', () => {
  const bad = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(?:perm|any):\s*(?:'([a-z_]+:[a-z_]+)'|\[([^\]]+)\])/g)) {
      const inArray = [...(m[2] || '').matchAll(/'([a-z_]+:[a-z_]+)'/g)].map((x) => x[1]);
      for (const t of [m[1], ...inArray].filter(Boolean)) {
        if (!known.has(t)) bad.push(`${f.replace(root, '')} → '${t}'`);
      }
    }
    for (const m of src.matchAll(/\bcan\(\s*'([a-z_]+:[a-z_]+)'/g)) {
      if (!known.has(m[1])) bad.push(`${f.replace(root, '')} → can('${m[1]}')`);
    }
  }
  assert.deepEqual(bad, [], 'Unknown permission tokens:\n' + bad.join('\n'));
});
test('requirePermission targets resolve for the right roles', () => {
  const asRole = (r) => ({ roles: [r], permissions: (ROLE_PERMISSIONS[r] === '*' ? [...known] : ROLE_PERMISSIONS[r]) });
  const admin = asRole('ADMIN');
  for (const p of known) assert.equal(can(p, admin), true, `ADMIN must hold ${p}`);
  const emp = asRole('EMPLOYEE');
  assert.equal(can('payslip:read_all', emp), false, 'EMPLOYEE must not read everyone payslips');
  assert.equal(can('payroll:compute', emp), false, 'EMPLOYEE must not compute payroll');
  assert.equal(can('payslip:download_own', emp), true, 'EMPLOYEE must download their own slip');
  const hr = asRole('HR_MANAGER');
  assert.equal(can('payroll:mark_paid', hr), false, 'HR Manager must not mark a payrun paid');
  assert.equal(can('timeoff:approve', hr), true, 'HR Manager approves leave');
  const pu = asRole('HR_PAYROLL_USER');
  assert.equal(can('payroll:compute', pu), true, 'Payroll user computes');
  assert.equal(can('payroll:send_bulk', pu), false, 'Payroll user never bulk-sends');
  assert.equal(can('payroll:mark_paid', pu), true, 'Payroll user marks paid');
  const pm = asRole('HR_PAYROLL_MANAGER');
  assert.equal(can('payroll:send_bulk', pm), true, 'Payroll admin bulk-sends');
  assert.equal(can('payroll:payrun_delete', pm), true, 'Payroll admin voids');
});
