import { z } from 'zod';
import { uuid, dateStr, optDate, money, hours, trimmed, optText, pagination, timeStr, dtStr, dow, boolish, pct, intIn } from './common.js';
export const idParam = z.object({ id: uuid });
export const periodQuery = z.object({ from: optDate, to: optDate, month: z.string().regex(/^\d{4}-\d{2}$/).optional(), day: optDate,
  employee_id: uuid.optional(), department_id: uuid.optional(), status: z.string().max(20).optional(), q: z.string().max(80).optional(),
  only_exceptions: boolish.optional(), ...pagination });
export const deptBody = z.object({ name: trimmed(80), code: optText(20), manager_id: uuid.optional(), parent_id: uuid.optional(), is_active: boolish.optional() });
export const scheduleDay = z.object({ day: dow, start: timeStr.optional(), end: timeStr.optional(), break: intIn(0, 480).optional(), rest: z.boolean().optional(), code: optText(40) });
export const scheduleBody = z.object({ name: trimmed(80), type: z.enum(['FIXED', 'FLEXIBLE', 'SHIFT', 'PART_TIME']).optional(),
  company_name: optText(80), timezone: optText(60), description: optText(500), is_active: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  total_weekly_hours: z.coerce.number().min(0).max(168).optional(), days: z.array(scheduleDay).min(1).max(7) });
export const holidayBody = z.object({ day: dateStr, name: trimmed(80), type: z.enum(['PUBLIC', 'COMPANY', 'OPTIONAL']).optional(), note: optText(300) });
export const contractBody = z.object({ employee_id: uuid.optional(), start_date: dateStr, end_date: optDate, department_id: uuid.optional(),
  job_position: optText(120), wage: money, salary_structure_id: uuid.optional(), working_schedule_id: uuid.optional(),
  status: z.enum(['DRAFT', 'RUNNING', 'TERMINATED', 'EXPIRED']).optional(), is_primary: z.boolean().optional(), notes: optText(500) });
export const attendanceBody = z.object({ employee_id: uuid, day: dateStr, check_in: dtStr.optional(), check_out: dtStr.optional(),
  break_minutes: intIn(0, 480).optional(), expected_hours: hours.optional(), overtime_hours: hours.optional(), worked_hours: hours.optional(),
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'OVERTIME']).optional(), manual_reason: optText(300),
  overtime_approved: z.boolean().optional() });
export const clockBody = z.object({ employee_id: uuid.optional(), at: dtStr.optional() });
export const overtimeBody = z.object({ approved: z.boolean().default(true) });
export const typeListQuery = z.object({ include_inactive: boolish.optional() });
export const timeOffTypeBody = z.object({ name: trimmed(80), code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,20}$/, 'Code: letters/numbers, 2–21 chars'),
  unit: z.enum(['DAYS', 'HOURS']).default('DAYS'), requires_allocation: z.boolean().default(true), max_days_per_year: intIn(0, 400).optional(),
  approval_route: z.enum(['NONE', 'MANAGER', 'HR', 'PAYROLL_OFFICER']).default('MANAGER'), work_entry_type: optText(60),
  is_unpaid: z.boolean().default(false), payslip_code: optText(30), is_encashable: z.boolean().default(false), carry_forward: z.boolean().default(false),
  sandwich_rule: z.boolean().default(false), min_notice_days: intIn(0, 120).optional(), display_color: optText(20),
  is_active: z.enum(['ACTIVE', 'INACTIVE']).optional(), description: optText(500) });
export const timeOffRequestBody = z.object({ employee_id: uuid.optional(), time_off_type_id: uuid, start_date: dateStr, end_date: optDate,
  duration: z.coerce.number().min(0.5).max(400).optional(), half_day_period: z.enum(['MORNING', 'AFTERNOON']).optional().nullable(),
  reason: optText(500), status: z.enum(['DRAFT', 'TO_APPROVE']).optional() });
export const timeOffPatch = z.object({ start_date: dateStr.optional(), end_date: optDate, duration: z.coerce.number().min(0.5).max(400).optional(),
  reason: optText(500), status: z.enum(['CANCELLED']).optional() });
export const decideBody = z.object({ status: z.enum(['APPROVED', 'REFUSED', 'CANCELLED']).default('APPROVED'),
  approved_days: z.coerce.number().min(0).max(400).optional(), refuse_reason: optText(300) });
export const allocationBody = z.object({ employee_id: uuid, time_off_type_id: uuid, allocated_days: z.coerce.number().min(0).max(400),
  taken_days: z.coerce.number().min(0).max(400).optional(), valid_from: dateStr, valid_until: dateStr,
  status: z.enum(['DRAFT', 'TO_APPROVE', 'APPROVED']).optional(), description: optText(300) });
/** POST /time-off/allocations/bulk — the same grant for a list of employees. */
export const allocateManyBody = z.object({ time_off_type_id: uuid, employee_ids: z.array(uuid).min(1).max(500),
  allocated_days: z.coerce.number().min(0).max(400), valid_from: dateStr, valid_until: dateStr,
  description: optText(300).optional(), on_existing: z.enum(['skip', 'add', 'replace']).default('skip') });
export const carryBody = z.object({ type_id: uuid, from_year: intIn(2000, 2100), to_year: intIn(2000, 2100), cap: z.coerce.number().min(0).max(400).optional() });
export const terminateBody = z.object({ date_of_exit: dateStr, reason: optText(300) });
export const renewBody = z.object({ start_date: dateStr, end_date: optDate.optional(), wage: money.optional(), notes: optText(500) });
export const countDaysBody = z.object({ employee_id: uuid.optional(), type_id: uuid.optional(), start_date: dateStr, end_date: optDate, half_day_period: z.enum(['MORNING','AFTERNOON']).optional().nullable() });
export const importBody = z.object({ csv: z.string().min(10, 'Paste the CSV contents'), employee_id: uuid.optional(),
  default_source: z.enum(['DEVICE', 'MANUAL']).default('DEVICE'), overwrite: z.boolean().default(true) });
