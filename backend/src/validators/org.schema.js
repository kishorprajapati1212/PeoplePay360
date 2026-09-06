import { z } from 'zod';
import { uuid, dateStr, optDate, trimmed, optText, intIn, dow, timeStr, boolish } from './common.js';
export { idParam } from './common-helpers.js';
export const deptQuery = z.object({ include_inactive: boolish.optional() });
export const deptBody = z.object({ name: trimmed(80), code: optText(20), manager_id: uuid.optional(), parent_id: uuid.optional(), is_active: boolish.optional() });
export const listQuery = z.object({ search: optText(80), company: optText(120), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), include_inactive: boolish.optional() });
export const scheduleDay = z.object({ day: dow, start: timeStr.optional(), end: timeStr.optional(), break: intIn(0, 480).optional(), rest: z.boolean().optional() });
export const scheduleBody = z.object({ name: trimmed(80), type: z.enum(['FIXED', 'FLEXIBLE', 'SHIFT', 'PART_TIME']).optional(),
  company_name: optText(120), timezone: optText(60), description: optText(500), is_active: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  days: z.array(scheduleDay).min(1).max(7) });
export const holidayQuery = z.object({ year: intIn(1990, 2200).optional(), from: optDate, to: optDate, type: z.enum(['PUBLIC', 'COMPANY', 'OPTIONAL']).optional() });
export const holidayBody = z.object({ day: dateStr, name: trimmed(80), type: z.enum(['PUBLIC', 'COMPANY', 'OPTIONAL']).default('PUBLIC'), note: optText(300) });
export const generateBody = z.object({ template_id: uuid.optional(), state: optText(60), year: intIn(1990, 2200) });
