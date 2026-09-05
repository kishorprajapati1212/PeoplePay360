import { z } from 'zod';
/** Dates arrive as YYYY-MM-DD from <input type=date> and as DD-Mon-YYYY from the mockup's display; accept both. */
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const DD_MON_YYYY = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/;
export const dateStr = z.preprocess((v) => {
  const m = DD_MON_YYYY.exec(String(v ?? ''));
  if (!m) return v;
  const mi = MONTHS.indexOf(m[2].toLowerCase());
  return mi < 0 ? v : `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1]}`;
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD (or DD-Mon-YYYY)'));
export const optDate = dateStr.optional().nullable();
export const uuid = z.string().uuid('Pick one from the list');
export const money = z.coerce.number().finite().min(0).max(99_999_999);
export const signedMoney = z.coerce.number().finite().min(-9_999_999).max(9_999_999);
export const hours = z.coerce.number().min(0).max(168);
export const pct = z.coerce.number().min(0).max(1000);
export const email = z.string().trim().toLowerCase().email('Enter a valid email');
export const trimmed = (max = 200) => z.string().trim().min(1, 'Required').max(max);
export const optText = (max = 1000) => z.string().trim().max(max).optional().nullable().or(z.literal('').transform(() => null));
export const boolish = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);
export const intIn = (min, max) => z.coerce.number().int().min(min).max(max);
export const pagination = { page: intIn(1, 10000).optional(), page_size: intIn(1, 500).optional(), sort: z.string().max(40).optional(), dir: z.enum(['asc', 'desc']).optional() };
export const statusEnum = (values, name) => z.enum(values).optional().nullable()
  .or(z.string().transform((v) => v.toUpperCase()).pipe(z.enum(values, { errorMap: () => ({ message: `${name} must be one of: ${values.join(', ')}` }) })).optional());
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use HH:MM');
export const dtStr = z.string().min(4, 'Pick a date and time');
export const dow = z.coerce.number().int().min(1).max(7);

/**
 * One row of a working-schedule grid, read from whatever a client actually sends.
 *
 * Two shapes of mistake used to be refused in a way nobody could act on, so both are handled here rather than in
 * each screen (there are two callers of this: the schedules page and anything that imports the hr schema):
 *   · a day named instead of numbered — `mon`, `SUN`, `monday` — became `NaN` and zod said "Expected number,
 *     received nan"; and
 *   · a weekly off, which has no clock time, was sent as `start: ''` and failed the HH:MM format with a message
 *     about time, for a day that is not worked at all.
 * Blank and absent end up meaning the same thing, so an empty string is dropped before the checks below run.
 */
const DAY_NAMES = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
export function weekGridDay(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const key of ['day', 'start', 'end', 'break', 'code', 'note']) {
    if (out[key] === '' || out[key] === null) delete out[key];              // an empty box is not a bad box
  }
  if (typeof out.day === 'string') {
    const text = out.day.trim().toLowerCase();
    out.day = /^\d+$/.test(text) ? Number(text) : (DAY_NAMES[text.slice(0, 3)] ?? out.day);
  }
  const off = out.rest === true || String(out.rest) === 'true' || String(out.code || '').toUpperCase() === 'REST';
  if (off) { delete out.start; delete out.end; out.break = 0; out.rest = true; }   // a rest day keeps no times
  return out;
}
export const scheduleDay = (extra = {}) => z.preprocess(weekGridDay, z.object({
  day: dow, start: timeStr.optional(), end: timeStr.optional(), break: intIn(0, 480).optional(),
  rest: z.boolean().optional(), ...extra }));

/**
 * Indian mobile number: 10 digits, nothing else. Spaces, dashes and a leading +91 are cleaned away first,
 * because people paste numbers in however their phone shows them — a wrong digit count is still refused.
 */
export const mobile = z.preprocess(tenDigits, z.string().regex(/^\d{10}$/, 'Mobile number must be exactly 10 digits').optional());
function tenDigits(v) {
  const digits = String(v ?? '').replace(/\D/g, '');
  if (!digits) return undefined;
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}
