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
export const idList = z.array(uuid).min(1, 'Select at least one').max(500);
export const pagination = { page: intIn(1, 10000).optional(), page_size: intIn(1, 500).optional(), sort: z.string().max(40).optional(), dir: z.enum(['asc', 'desc']).optional() };
export const statusEnum = (values, name) => z.enum(values).optional().nullable()
  .or(z.string().transform((v) => v.toUpperCase()).pipe(z.enum(values, { errorMap: () => ({ message: `${name} must be one of: ${values.join(', ')}` }) })).optional());
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use HH:MM');
export const dtStr = z.string().min(4, 'Pick a date and time');
export const dow = z.coerce.number().int().min(1).max(7);
