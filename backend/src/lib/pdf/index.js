import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { renderPayslipPdf } from './payslip.js';
export { renderPayslipPdf };
export { pdfText, currencyFor, inr } from './text.js';
export { makeZip } from './zip.js';
/** Render + persist one payslip PDF; returns the metadata the worker records in payslip_documents. */
export async function generatePayslipPdf(input, { storageDir, key }) {
  const { buffer, sha256, bytes } = await renderPayslipPdf(input);
  const path = join(storageDir, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);
  return { path, sha256, bytes };
}
