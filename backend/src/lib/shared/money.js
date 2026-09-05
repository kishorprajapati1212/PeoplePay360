/**
 * Money is an INTEGER number of paise inside the engine. Postgres holds NUMERIC(16,2) and
 * node-postgres hands those back as *strings* — parse through here, never with parseFloat at call sites.
 */
export const toPaise = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Math.round(v * 100);
  const s = String(v).replace(/[,\s₹]/g, '');
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace(/^-/, '').split('.');
  if (!f) return (neg ? -1 : 1) * Number(BigInt(i || '0') * 100n);
  // numeric(14,4) amounts exist, so a fraction can have 4 digits: round half-up at the paisa
  const keep = 2;
  const digits = (f + '0'.repeat(keep + 1)).slice(0, keep + 1);
  const roundUp = Number(digits[keep]) >= 5;
  const frac = Number(digits.slice(0, keep)) + (roundUp ? 1 : 0);
  const paise = Math.abs(Number(BigInt(i || '0') * 100n) + frac);
  return neg ? -paise : paise;
};
export const fromPaise = (p) => (Number(p) / 100).toFixed(2);
/** JSON-safe: numbers with exactly 2 decimals (plus a display string for the UI). */
export const money = (v) => {
  const paise = toPaise(v);
  return { value: Number((paise / 100).toFixed(2)), paise, display: fromPaise(paise) };
};
export const mulPct = (basePaise, pct) => Math.round((basePaise * Number(pct)) / 100);
export const div = (totalPaise, parts) => (parts ? Math.round(totalPaise / parts) : 0);
export const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
export const clampRange = (v, min, max) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));

const ONES = ['', 'One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const TENS = ['', '', 'Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function two(n) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`; }
function three(n) { return `${n > 99 ? `${ONES[Math.floor(n / 100)]} Hundred ` : ''}${two(n % 100)}`.trim(); }
/** Indian numbering (lakh/crore) — payslips are expected to print this. */
export function rupeesInWords(amount) {
  let paise = toPaise(amount);
  const neg = paise < 0;
  paise = Math.abs(paise);
  let n = Math.floor(paise / 100);
  const p = paise % 100;
  if (n === 0 && p === 0) return 'Zero Rupees Only';
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  for (const [v, label] of [[crore, 'Crore'], [lakh, 'Lakh'], [thousand, 'Thousand'], [n, '']]) {
    if (v) parts.push(`${three(v)}${label ? ' ' + label : ''}`);
  }
  const words = parts.join(' ').replace(/\s+/g, ' ').trim();
  const out = `${neg ? 'Minus ' : ''}${words} Rupees${p ? ` and ${two(p)} Paise` : ''} Only`;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** paise → rupees with 2 decimals, as a number (for formula contexts and logs). */
export const round2p = (paise) => Math.round((Number(paise) || 0)) / 100;
