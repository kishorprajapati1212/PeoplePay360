/**
 * Minimal CSV reader for the paste/upload importers. Handles quoted fields and doubled quotes,
 * which is everything the Excel/Sheets exports need — no dependency, no streaming surprises.
 */
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = !quoted;
      continue;
    }
    if (c === ',' && !quoted) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
const norm = (h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/^"|"$/g, '');

/** "a,b\n1,2" → [{ a: '1', b: '2' }] with `__line` set to the 1-based source line for error messages. */
export function csvToObjects(text, { minLines = 2 } = {}) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < minLines) return null;
  const header = splitCsvLine(lines[0]).map(norm);
  return lines.slice(1).map((l, i) => {
    const cells = splitCsvLine(l);
    const row = {};
    header.forEach((h, idx) => { if (h) row[h] = (cells[idx] ?? '').trim(); });
    row.__line = i + 2;
    return row;
  });
}
/** Object rows → CSV text (used by every export endpoint). */
export function toCsv(rows, columns) {
  const cols = columns ?? Object.keys(rows[0] ?? {});
  const esc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(',')].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(','))).join('\n');
}
