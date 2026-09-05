#!/usr/bin/env node
/** Proves the PDF and mail paths actually produce artefacts (not just that the code parses). */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderPayslipPdf, makeZip, generatePayslipPdf } from '../src/lib/pdf/index.js';
import { createMailer, render, payslipEmailVars } from '../src/lib/mailer/index.js';
import { rupeesInWords } from '../src/lib/shared/index.js';

let n = 0; const ok = (m) => { n += 1; console.log(`  ✓ ${m}`); };
const dir = await mkdtemp(join(tmpdir(), 'pp360-docs-'));

const payslip = { period_key: '2026-02', period_start: '2026-02-01', period_end: '2026-02-28', payslip_kind: 'MONTHLY', document_version: 1, payrun: 'February 2026' };
const lines = [
  { rule_code: 'BASIC', rule_name: 'Basic Salary', line_kind: 'EARNING', amount: 34000 },
  { rule_code: 'HRA', rule_name: 'House Rent Allowance', line_kind: 'EARNING', amount: 17000 },
  { rule_code: 'MEDA', rule_name: 'Medical Allowance', line_kind: 'EARNING', amount: 1250 },
  { rule_code: 'CONV', rule_name: 'Conveyance Allowance', line_kind: 'EARNING', amount: 1600 },
  { rule_code: 'PERB', rule_name: 'Performance Bonus', line_kind: 'EARNING', amount: 8500 },
  { rule_code: 'OT', rule_name: 'Overtime', line_kind: 'EARNING', amount: 1593.75 },
  { rule_code: 'PF', rule_name: 'Provident Fund', line_kind: 'DEDUCTION', amount: 1800 },
  { rule_code: 'PT', rule_name: 'Professional Tax', line_kind: 'DEDUCTION', amount: 200 },
  { rule_code: 'LOAN', rule_name: 'Salary Loan', line_kind: 'DEDUCTION', amount: 5000 },
];
const totals = { gross: 63943.75, deductions: 7000, adjustments: 0, net: 56943.75 };
const { buffer, sha256, bytes } = await renderPayslipPdf({
  payslip,
  employee: { name: 'Aarav Mehta', employee_code: 'EMP0042', job_position: 'Payroll Specialist', department: 'Finance', work_location: 'Mumbai', date_of_joining: '2025-04-01', bank_account_number: '9876543210', bank_ifsc: 'HDFC0001234', uan_number: '100220334455' },
  company: { company_name: 'OXP Pvt Ltd', address: 'GIFT City, Gandhinagar', city: 'Ahmedabad', state: 'Gujarat', postal_code: '382310', currency_symbol: '₹', payslip_footer: 'System generated payslip. No signature required.' },
  lines, totals,
  meta: { expected_working_days: 20, paid_days: 20, unpaid_leave_days: 0, overtime_hours: 1.5, worked_hours: 168, pro_rata_factor: 1,
          computation_summary: { rules: [{ code: 'BASIC', log: '40% of CONTRACT_WAGE ₹85000.00 = ₹34000.00' }, { code: 'PF', log: '12% of ₹15000.00 (ceiling applied: wage ₹85000.00)' }] } },
  amountInWords: rupeesInWords(56943.75),
});
assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
assert.ok(bytes > 3000, `pdf too small (${bytes})`);
assert.equal(sha256.length, 64);
const pdfPath = join(dir, 'payslip.pdf');
await writeFile(pdfPath, buffer);
ok(`payslip PDF renders (${bytes} bytes, sha256 ${sha256.slice(0, 12)}…)`);
try {
  const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  assert.match(info, /Pages:\s+1/);
  const text = execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' });
  for (const must of ['PAYSLIP', 'Aarav Mehta', 'Basic Salary', 'Rs.56,943.75', 'Rs.63,943.75', 'Fifty Six Thousand', 'Professional Tax', 'ceiling applied', '2026-02-01 to 2026-02-28']) {
    assert.ok(text.includes(must), `printed page is missing “${must}”`);
  }
  ok('pdfinfo/pdftotext confirm the content is really on the page');
} catch (e) { if (e.code === 'ENOENT') console.log('  · pdfinfo/pdftotext not installed here — skipped (size + magic bytes checked)'); else throw e; }

const gen = await generatePayslipPdf({ payslip, employee: { name: 'X', employee_code: 'E1' }, company: { company_name: 'C' }, lines, totals, meta: {}, amountInWords: 'Zero' }, { storageDir: dir, key: 'payslips/2026-02/E1.pdf' });
assert.ok(gen.bytes > 1000 && gen.sha256.length === 64);
ok('generatePayslipPdf writes to the storage path the API will stream from');

const zip = makeZip([{ name: 'payslip-EMP0042-2026-02.pdf', data: buffer }, { name: 'README.txt', data: '2 payslips' }]);
assert.equal(zip.subarray(0, 2).toString(), 'PK');
const zipPath = join(dir, 'payslips.zip');
await writeFile(zipPath, zip);
try {
  const list = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
  assert.match(list, /payslip-EMP0042-2026-02\.pdf/);
  execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' });
  ok('zip of payslips is a valid archive (unzip -t passes)');
} catch (e) { if (e.code === 'ENOENT') console.log('  · unzip not installed here — skipped'); else throw new Error(`unzip rejected the archive: ${e.stderr || e.message}`); }

const mailer = createMailer({ MAIL_DRIVER: 'preview', MAIL_FROM: 'OXP Payroll <payroll@oxp.com>' });
const vars = payslipEmailVars({ company: { company_name: 'OXP Pvt Ltd' }, employee: { name: 'Aarav Mehta' }, payslip, net: '₹56,943.75', periodLabel: 'February 2026', link: 'http://localhost:5173/payslips/p1' });
const sent = await mailer.send({ to: 'aarav@oxp.com', subject: render('Your payslip for {{period}} — {{company}}', vars), text: render('Hi {{first_name}},\n\nNet pay {{net}} for {{period}}.\n\nDownload: {{link}}', vars), previewDir: join(dir, 'mail') });
assert.ok(sent.ok && sent.accepted.includes('aarav@oxp.com'));
const { readdir } = await import('node:fs/promises');
const files = await readdir(join(dir, 'mail'));
assert.equal(files.length, 1);
const body = await readFile(join(dir, 'mail', files[0]), 'utf8');
assert.match(body, /^Subject: Your payslip for February 2026 — OXP Pvt Ltd/m);
assert.match(body, /Aarav/);
ok(`preview mailer wrote an .eml (${files[0]}) that a mail client can open`);
assert.equal(render('{{nope}}', {}), '{{nope}}', 'unknown placeholders stay visible instead of silently blanking');
ok('template renderer leaves unknown keys visible');

await rm(dir, { recursive: true, force: true });
console.log(`\nall ${n} document/email tests passed`);
