/** Tiny {{var}} renderer — no template engine dependency, and unknown keys are left visible on purpose. */
/**
 * How a validity window is spoken about, in the mail and on the screen that sent it: "10 minutes", "3 hours".
 * One function because an inbox that says "3 hours" above a link the app already refused at 10 minutes is worse
 * than either number on its own.
 */
export function linkTtlSentence(minutes) {
  const m = Math.max(1, Math.round(Number(minutes) || 10));
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = m / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? '' : 's'}`;
}

/**
 * The account invitation, in one place: the request that creates a login and the worker that retries one must
 * not send two different letters. The address is on its own line in the plain-text part and repeated under the
 * button in the HTML part, because people copy-paste a link into a browser more often than they trust an e-mail
 * client to carry them there.
 */
export function inviteMail({ name, link, minutes, inviter, company = 'PeoplePay360' }) {
  const vars = { first_name: firstName(name), link, ttl: linkTtlSentence(minutes),
                 inviter: inviter || 'the payroll team', company };
  const text = render('Hi {{first_name}},\n\n{{inviter}} created an account for you on {{company}}. Pick a password to finish it off.\n\n'
    + 'Valid for {{ttl}}, and it works once:\n{{link}}\n\n'
    + 'Copy that address into your browser if the button does not open. If you did not expect this, ignore the message — nothing happens to your account.', vars);
  const html = render('<p>Hi <b>{{first_name}}</b>,</p><p><b>{{inviter}}</b> created an account for you on <b>{{company}}</b>. Choose a password to finish setting it up.</p>'
    + '<p><a href="{{link}}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2f5bd7;color:#fff;text-decoration:none">Choose your password</a></p>'
    + '<p style="color:#666">The link is valid for {{ttl}} and can be used once. If the button does not open, copy this address into your browser:\n'
    + '</p><p style="margin:6px 0;font-family:ui-monospace,Menlo,monospace;word-break:break-all;font-size:13px">{{link}}</p>'
    + '<p style="color:#666">Did not expect this? Ignore it — nothing changes on your account.</p>', vars)
    .replace('copy this address into your browser:\n', 'copy this address into your browser:');
  return { subject: `Finish your ${company} account — choose a password`, text, html };
}

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
