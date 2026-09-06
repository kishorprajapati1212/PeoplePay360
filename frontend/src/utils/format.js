/** Money, dates and labels — the whole app formats numbers through these functions. */
const inrFormatter = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFormatter = new Intl.NumberFormat('en-IN');
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Accepts 1234.5, '1234.50', null. Never throws, always two decimals, Indian grouping. */
export function inr(value) {
  const n = Number(value);
  return '₹' + (Number.isFinite(n) ? inrFormatter.format(n) : '0.00');
}
/** Short form for KPI cards: ₹78.90L / ₹1.20Cr. */
export function inrCompact(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e7) return '₹' + (n / 1e7).toFixed(2) + 'Cr';
  if (abs >= 1e5) return '₹' + (n / 1e5).toFixed(2) + 'L';
  if (abs >= 1e3) return '₹' + (n / 1e3).toFixed(1) + 'K';
  return inr(n);
}
export function num(value) { return intFormatter.format(Number(value) || 0); }
export function pct(value) { const n = Number(value); return Number.isFinite(n) ? n.toFixed(1) + '%' : '—'; }
export function signed(value) { const n = Number(value) || 0; return (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }

/** 'YYYY-MM-DD' is parsed by hand so a UTC midnight can never roll back a day in local time. */
export function date(value) {
  if (!value) return '—';
  const parts = String(value).slice(0, 10).split('-');
  if (parts.length !== 3) return String(value);
  return `${Number(parts[2])} ${MONTHS_SHORT[Number(parts[1]) - 1]} ${parts[0]}`;
}
/** Punch times are shown in the COMPANY's zone (set from GET /api/meta once at startup), not the
 *  viewer's: payroll runs in one timezone, and a browser set to UTC turning a 10:05 IST check-in
 *  into "04:35" on the attendance screen is exactly the kind of thing that gets a screenshot filed
 *  as a bug. Falls back to the browser zone when meta has not answered yet. */
let COMPANY_TZ = null;
export function setCompanyTimezone(tz) {
  if (!tz || typeof tz !== 'string') return;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); COMPANY_TZ = tz; } catch { /* unknown zone: stay local */ }
}
const clockTime = (instant) => instant.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(COMPANY_TZ ? { timeZone: COMPANY_TZ } : {}) });
export function datetime(value) {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return `${date(value)}, ${clockTime(dt)}`;
}
/** 'HH:MM' in the company zone; a plain '09:30' (schedule times have no date) stays untouched. */
export function time(value) {
  if (!value) return '—';
  const s = String(value);
  if (!s.includes('T') && !s.includes(' ')) return s.slice(0, 5);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 5);
  return clockTime(d);
}
/** 'HR_PAYROLL_USER' → 'Hr Payroll User', so tables stay readable without a lookup table. */
export function human(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value)
    .toLowerCase()
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
/** Pay-period key ('2026-02-H1', '2026-10-C01-15') → a label a human recognises. */
export function periodLabel(key) {
  if (!key) return '—';
  const m = /^(\d{4})-(\d{2})(?:-(H\d|C\d+-\d+))?(?:-(\d+))?$/.exec(String(key));
  if (!m) return String(key);
  const base = `${MONTHS_LONG[Number(m[2]) - 1]} ${m[1]}`;
  if (!m[3]) return base;
  if (m[3] === 'H1') return `${base} · 1st half`;
  if (m[3] === 'H2') return `${base} · 2nd half`;
  return `${base} · days ${m[3].slice(1).replace('-', '–')}${m[4] ? ' (run ' + m[4] + ')' : ''}`;
}
export function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
export const today = () => new Date().toISOString().slice(0, 10);
export const firstOfMonth = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
/** Last day of the month an ISO date falls in — mirrors resolvePeriodEnd() in payrun.service.js. */
export const endOfMonth = (iso) => {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [y, m] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
