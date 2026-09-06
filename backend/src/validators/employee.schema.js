import { z } from 'zod';
import { uuid, dateStr, optDate, money, email, trimmed, optText, mobile, pagination, statusEnum, boolish } from './common.js';
export const EMP_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'];
export const EMP_STATUS = ['ACTIVE', 'ON_LEAVE', 'TERMINATED', 'SUSPENDED'];
export const listQuery = z.object({ ...pagination, view: z.enum(['list', 'kanban']).optional(), q: z.string().max(120).optional(),
  department_id: uuid.optional(), status: z.enum(EMP_STATUS).optional(), employee_type: z.enum(EMP_TYPES).optional(),
  missing_bank: boolish.optional(), user_role: z.string().max(30).optional() });
export const contractBlock = z.object({
  wage: money, start_date: dateStr, end_date: optDate, department_id: uuid.optional(), job_position: z.string().max(120).optional(),
  salary_structure_id: uuid.optional(), salary_structure: z.string().max(120).optional(), working_schedule_id: uuid.optional(),
  status: statusEnum(['DRAFT', 'RUNNING', 'TERMINATED', 'EXPIRED'], 'Contract status').optional(), notes: optText(500),
}).partial().extend({ wage: money, start_date: dateStr });
export const userBlock = z.object({
  password: z.string().min(6, 'At least 6 characters for the demo account').optional(),
  /** true = don't set a password here; mail the person a one-time set-password link instead. */
  send_invite: z.boolean().optional(),
  role: z.enum(['EMPLOYEE', 'HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN']).optional(),
  roles: z.array(z.enum(['EMPLOYEE', 'HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'])).min(1).optional(),
  must_change_pw: z.boolean().optional(),
});
export const createBody = z.object({
  name: trimmed(120), work_email: email, phone: mobile, gender: optText(20),
  date_of_birth: optDate, address: optText(400), city: optText(80), state: optText(80), pincode: optText(12),
  work_location: optText(80), department_id: uuid.optional(), manager_id: uuid.optional(), job_position: optText(120),
  employee_type: z.enum(EMP_TYPES).default('FULL_TIME'), working_schedule_id: uuid.optional(), date_of_joining: dateStr,
  status: z.enum(EMP_STATUS).default('ACTIVE'), employment_tag: optText(60), basic_salary: money.optional(),
  bank_account_number: optText(40), bank_ifsc: optText(20), bank_name: optText(120), pan_number: optText(20), uan_number: optText(30),
  esi_number: optText(30), notes: optText(1000),
  user: userBlock.optional(), contract: contractBlock.optional(),
});
export const updateBody = createBody.partial().omit({ contract: true }).extend({ user_roles: z.array(z.any()).optional(), user: userBlock.optional() });
export const terminateBody = z.object({ date_of_exit: optDate, reason: optText(300) });
export const importBody = z.object({ csv: z.string().min(10, 'Paste the CSV contents'), dry_run: z.boolean().default(true), default_structure_id: uuid.optional() });
export const idParam = z.object({ id: uuid });
