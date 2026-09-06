/** Tiny {{var}} renderer — no template engine dependency, and unknown keys are left visible on purpose. */
export function render(text, vars = {}) {
  return String(text ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), vars);
    return v === undefined || v === null ? `{{${k}}}` : String(v);
  });
}
export const firstName = (name = '') => String(name).split(' ')[0];
export const htmlEscape = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Subject/body templates are stored per company, so payroll wording never needs a deploy. */
export function payslipEmailVars({ company, employee, payslip, net, periodLabel, link }) {
  return {
    company: company.company_name, first_name: firstName(employee.name), name: employee.name,
    period: periodLabel, net, gross: payslip.gross_display ?? '', link,
    date: new Date().toISOString().slice(0, 10), payrun: payslip.payrun ?? '',
  };
}
