import { z } from 'zod';
import { uuid, email, trimmed, optText, pagination, intIn } from './common.js';
export { idParam } from './common-helpers.js';
const ROLES = ['EMPLOYEE', 'HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'];
export const listQuery = z.object({ ...pagination, q: z.string().max(120).optional(), role: z.enum(ROLES).optional(), employee_id: uuid.optional() });
// Creating a login takes three answers: a name, a work email, a role. A password is optional because the
// service falls back to the demo password from .env, which is what the admin hands over out of band.
// The problem statement has five roles and one of them per account, so creation takes exactly one role.
// `roles` is still accepted — but only as a one-item list, so a client written against the old shape gets
// a sentence that explains the model instead of a silent union of powers.
const oneRole = z.union([z.enum(ROLES), z.array(z.enum(ROLES)).length(1).transform(([r]) => r)])
  .refine((v) => !Array.isArray(v) || v.length === 1, { message: 'An account has exactly one role' });
export const createBody = z.object({
  name: trimmed(120), work_email: email,
  password: optText(200).optional(),
  role: oneRole.optional(),
  // The list shape stays accepted, as exactly one item, and arrives as that role — a client written
  // against the old contract gets the same account, not a union of powers quietly applied.
  roles: z.array(z.enum(ROLES)).length(1, 'An account has exactly one role — send it as role').optional(),
  employee_id: uuid.optional(), must_change_pw: z.boolean().default(false),
  // An account with no password handed over is useless until someone sets one, so the invite link is the
  // default when the admin did not type a temporary password themselves.
  send_invite: z.boolean().optional(),
}).transform((v) => {
  const role = v.role ?? v.roles?.[0] ?? 'EMPLOYEE';
  return { ...v, role, roles: [role] };
});
export const updateBody = z.object({ name: trimmed(120).optional(), work_email: email.optional(), employee_id: uuid.optional(),
  role: oneRole.optional(), roles: z.array(z.enum(ROLES)).length(1, 'An account has exactly one role').optional(),
  is_active: z.boolean().optional(), must_change_pw: z.boolean().optional() });
export const roleBody = z.object({ role: z.enum(ROLES), roles: z.array(z.enum(ROLES)).max(1).optional() });
// The old shape, kept alive: one role in a list, and a sentence if someone sends two.
export const rolesBodyLegacy = z.object({ roles: z.array(z.enum(ROLES)).min(1).max(5) });
export const inviteBody = z.object({ send_email: z.boolean().default(true) });
// The bulk send is bounded by the request, not by a queue: it sends one message per account in this
// request, so a "limit" is how long you are willing to wait, and 100 is a full day of hiring.
export const sendPendingBody = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });
export const passwordBody = z.object({ password: z.string().min(10, 'Use at least 10 characters').max(200), must_change_pw: z.boolean().optional() });
