/** Minimal table drawing for pdfkit — no plugins, so the PDF renders identically on any machine. */
import { pdfText } from './text.js';
export function table(doc, { x, y, width, columns, rows, header = true, fontSize = 8.5, padding = 4, zebra = true, lineColor = '#cfd4dc' }) {
  const colWidths = normalise(columns, width);
  let cy = y;
  const rowH = (cells, bold) => {
    let max = doc.currentPageHeightLeft?.() ?? 0;
    let h = 0;
    cells.forEach((c, i) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      const t = pdfText(c);
      const lines = doc.heightOfString(t, { width: colWidths[i] - padding * 2 }) ;
      h = Math.max(h, lines + padding * 2);
    });
    return Math.max(h, fontSize + padding * 2);
  };
  const draw = (cells, { bold = false, fill = null } = {}) => {
    const h = rowH(cells, bold);
    if (cy + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); cy = doc.page.margins.top; }
    if (fill) { doc.rect(x, cy, width, h).fill(fill); }
    doc.fillColor('#111418').rect(x, cy, width, h).lineWidth(0.5).strokeColor(lineColor).stroke();
    let cx = x;
    cells.forEach((c, i) => {
      const align = columns[i].align || 'left';
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor('#111418');
      const text = pdfText(c);
      const w = colWidths[i] - padding * 2;
      // let pdfkit justify inside the cell box; shifting x *and* passing align double-counts and
      // right-aligned amounts end up off-page (they were silently disappearing from the totals block)
      doc.text(text, cx + padding, cy + padding, { width: w, lineGap: 1.2, align });
      cx += colWidths[i];
    });
    cy += h;
    doc.strokeColor('#000');
  };
  if (header) draw(columns.map((c) => c.label), { bold: true, fill: '#eef1f6' });
  rows.forEach((r, idx) => draw(r, zebra && idx % 2 ? { fill: '#f8fafc' } : {}));
  return { bottom: cy, widths: colWidths };
}
function normalise(columns, width) {
  const totalWeight = columns.reduce((a, c) => a + (c.weight ?? 1), 0);
  return columns.map((c) => c.width ?? (width * (c.weight ?? 1)) / totalWeight);
}
