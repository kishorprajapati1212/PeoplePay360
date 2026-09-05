import PDFDocument from 'pdfkit';
import { createHash } from 'node:crypto';
import { table } from './table.js';
import { pdfText, currencyFor, inr } from './text.js';

/**
 * One payslip per page, Odoo-flavoured layout: header, employee grid, earnings | deductions side by
 * side, totals, amount in words, and a provenance block (period, version, hash) so a printed PDF can
 * be tied back to the exact computation that produced it.
 */
export function renderPayslipPdf({ payslip, employee, company, lines, totals, meta = {}, amountInWords = '', branding = {} }) {
  const doc = new PDFDocument({ size: 'A4', margin: 34, info: { Title: `Payslip ${payslip.period_key} — ${employee.name}`, Author: company.company_name, Subject: 'Salary slip' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const W = doc.page.width - 68;
  const accent = branding.accent || '#1f3a5f';

  doc.rect(0, 0, doc.page.width, 92).fill(accent);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(17).text(company.company_name || 'Company', 34, 22);
  doc.font('Helvetica').fontSize(8).fillColor('#dbe3ef')
     .text(company.address || '', 34, 44, { width: W * 0.62 })
     .text([company.city, company.state, company.postal_code].filter(Boolean).join(', '), 34, 58, { width: W * 0.62 });
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#fff').text('PAYSLIP', doc.page.width - 34 - 120, 26, { width: 120, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor('#dbe3ef')
     .text(payslip.period_label || payslip.period_key, doc.page.width - 34 - 170, 44, { width: 170, align: 'right' })
     .text(`${payslip.kind_label || payslip.payslip_kind} · v${payslip.document_version || 1}`, doc.page.width - 34 - 170, 56, { width: 170, align: 'right' });

  let y = 106;
  const grid = [
    ['Employee', `${pdfText(employee.name)} (${pdfText(employee.employee_code)})`, 'Pay Period', `${payslip.period_start} → ${payslip.period_end}`],
    ['Designation', employee.job_position || '—', 'Working Days (expected)', meta.expected_working_days ?? '—'],
    ['Department', employee.department || '—', 'Paid Days', meta.paid_days ?? '—'],
    ['Location', employee.work_location || '—', 'Unpaid Leave (LOP)', meta.unpaid_leave_days ?? 0],
    ['Date of Joining', employee.date_of_joining || '—', 'Overtime Hours', meta.overtime_hours ?? 0],
    ['Bank A/C · IFSC', [employee.bank_account_number, employee.bank_ifsc].filter(Boolean).join(' · ') || 'Not provided', 'Worked Hours', meta.worked_hours ?? '—'],
    ['PF / UAN - ESI', pdfText([employee.uan_number && `UAN ${employee.uan_number}`, employee.esi_number && `ESI ${employee.esi_number}`].filter(Boolean).join('  ')) || '—', 'Pro-rata factor', meta.pro_rata_factor != null ? Number(meta.pro_rata_factor).toFixed(4) : '1.0000'],
  ];
  y = block(doc, { x: 34, y, width: W, rows: grid, accent }).bottom;

  const fmt = (v) => inr(v, currencyFor(company));
  const earnings = lines.filter((l) => l.line_kind === 'EARNING' && !l.is_hidden && (Number(l.amount) !== 0 || l.rule_code === 'BASIC'));
  const deductions = lines.filter((l) => (l.line_kind === 'DEDUCTION' || l.line_kind === 'ADJUSTMENT') && !l.is_hidden && Number(l.amount) !== 0);
  const cols = [
    { label: 'Earning / Deduction', weight: 3 },
    { label: 'Code', weight: 1 },
    { label: 'Amount', weight: 1.2, align: 'right' },
  ];
  const colW = (W - 10) / 2;
  const e = table(doc, { x: 34, y: y + 10, width: colW, columns: cols, rows: earnings.map((l) => [l.rule_name, l.rule_code, fmt(l.amount)]) });
  const d = table(doc, { x: 34 + colW + 10, y: y + 10, width: colW, columns: [{ label: 'Deduction', weight: 3 }, { label: 'Code', weight: 1 }, { label: 'Amount', weight: 1.2, align: 'right' }],
                        rows: deductions.map((l) => [l.rule_name, l.rule_code, fmt(Math.abs(l.amount))]) });
  y = Math.max(e.bottom, d.bottom);

  const summary = [
    ['Gross Earnings', fmt(totals.gross)],
    ['Total Deductions', fmt(totals.deductions)],
    ...(Number(totals.adjustments) ? [['Adjustments / Arrears', fmt(totals.adjustments)]] : []),
    ['NET PAY', fmt(totals.net)],
  ];
  table(doc, { x: 34, y: y + 8, width: W, columns: [{ label: 'Summary', weight: 3 }, { label: 'Amount', weight: 1.2, align: 'right' }], rows: summary, header: false });
  y += 8 + summary.length * 15 + 4;
  doc.rect(34, y, W, 1).fill('#cfd4dc');
  doc.fillColor('#111418').font('Helvetica-Bold').fontSize(9).text(`Amount in words: ${amountInWords}`, 34, y + 6, { width: W });

  if (meta.computation_summary?.rules?.length) {
    doc.font('Helvetica').fontSize(8).fillColor('#5a6472')
       .text('How each line was computed', 34, y + 24, { width: W });
    const trace = meta.computation_summary.rules.filter((r) => r.log).slice(0, 12)
      .map((r) => [r.code, r.log]);
    const t2 = table(doc, { x: 34, y: y + 36, width: W, columns: [{ label: 'Rule', weight: 1 }, { label: 'Computation', weight: 6 }], rows: trace, fontSize: 7 });
    y = t2.bottom + 6;
  } else y += 30;

  doc.fontSize(7).fillColor('#5a6472').font('Helvetica')
     .text(company.payslip_footer || 'System generated payslip. No signature required.', 34, doc.page.height - 74, { width: W, align: 'center' })
     .text(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC · payrun ${payslip.payrun || '—'} · doc v${payslip.document_version || 1}` , 34, doc.page.height - 62, { width: W, align: 'center' });
  if (payslip.pdf_hash) doc.text(`SHA-256 ${String(payslip.pdf_hash).slice(0, 24)}…`, 34, doc.page.height - 50, { width: W, align: 'center' });
  doc.end();
  return new Promise((resolve, reject) => {
    doc.on('end', () => { const buf = Buffer.concat(chunks); resolve({ buffer: buf, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length }); });
    doc.on('error', reject);
  });
}
function block(doc, { x, y, width, rows, accent }) {
  const rowH = 15;
  const colW = [width * 0.19, width * 0.31, width * 0.19, width * 0.31];
  rows.forEach((r, i) => {
    const yy = y + i * rowH;
    doc.rect(x, yy, width, rowH).fill(i % 2 ? '#f6f8fb' : '#ffffff');
    let cx = x;
    r.forEach((cell, ci) => {
      doc.font(ci % 2 ? 'Helvetica' : 'Helvetica-Bold').fontSize(7.6)
         .fillColor(ci % 2 ? '#111418' : '#5a6472')
         .text(pdfText(cell) || '-', cx + 4, yy + 4, { width: colW[ci] - 8, ellipsis: true });
      cx += colW[ci];
    });
  });
  doc.rect(x, y, width, rows.length * rowH).lineWidth(0.5).strokeColor('#cfd4dc').stroke();
  doc.strokeColor('#000');
  return { bottom: y + rows.length * rowH };
}
