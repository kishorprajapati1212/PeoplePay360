/**
 * pdfkit's built-in fonts are WinAnsi: no ₹ (U+20B9), no →, ÷, ×, – or ∞. Without this map a payslip
 * silently prints "¹34,000" and "2026-02-01 !’ 2026-02-28". Every string that reaches the page is
 * passed through here, so a rule's computation_log can never corrupt the document.
 */
const MAP = {
  '₹': 'Rs.', '→': ' to ', '÷': '/', '×': 'x', '–': '-', '—': '-', '−': '-', '∞': 'no limit',
  '·': '.', '’': "'", '‘': "'", '“': '"', '”': '"', '\u00a0': ' ', '…': '...', '•': '-',
};
export function pdfText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[₹→÷×–—−∞·’‘“”\u00a0…•]/g, (c) => MAP[c])
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}
/** Symbol to print in front of an amount. '₹' becomes 'Rs.' unless a real rupee font is supplied. */
export const currencyFor = (company = {}, { hasRupeeFont = false } = {}) => {
  const sym = company.currency_symbol || '';
  if (!sym) return '';
  if (sym === '₹' && !hasRupeeFont) return 'Rs.';
  return pdfText(sym);
};
export const inr = (v, symbol = 'Rs.') => {
  const n = Number(v ?? 0);
  const s = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol}${n < 0 ? ` -${s}` : s}`;
};
