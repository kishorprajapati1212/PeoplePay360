import { z } from 'zod';
import { uuid, email, trimmed, optText, pagination, intIn } from './common.js';
export { idParam } from './common-helpers.js';
const ROLES = ['EMPLOYEE', 'HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'];
export const listQuery = z.object({ ...pagination, q: z.string().max(120).optional(), role: z.enum(ROLES).optional(), employee_id: uuid.optional() });
export const createBody = z.object({
  name: trimmed(120), work_email: email, password: z.string().min(8, 'Use at least 8 characters').max(200),
  role: z.enum(ROLES).default('EMPLOYEE'), roles: z.array(z.enum(ROLES)).min(1).max(5).optional(),
  employee_id: uuid.optional(), must_change_pw: z.boolean().default(true),
});
export const updateBody = z.object({ name: trimmed(120).optional(), work_email: email.optional(), employee_id: uuid.optional() });
export const rolesBody = z.object({ roles: z.array(z.enum(ROLES)).min(1, 'Pick at least one role').max(5) });
export const passwordBody = z.object({ password: z.string().min(8, 'Use at least 8 characters').max(200), must_change_pw: z.boolean().optional() });
