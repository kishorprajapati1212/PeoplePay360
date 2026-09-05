import { AppError } from '../lib/shared/index.js';
import { ROLES, ROLE_LABEL, USER_ADMIN_ROLES } from '../lib/shared/index.js';
import { createHash, randomBytes } from 'node:crypto';
import { hashPassword } from '../middleware/auth.js';
import * as repo from '../repositories/user.repo.js';
import * as employeeRepo from '../repositories/employee.repo.js';
import { transaction } from '../db/tx.js';
import { config } from '../config.js';
import * as deliveryRepo from '../repositories/delivery.repo.js';
import { schedule, QUEUES } from '../queue/queues.js';
// resolveDriver is no longer called here: the live driver comes from mailStatus(), which reads the company row.

export const list = (f) => repo.listUsers(f);
/** Only the hash of a link token is ever stored, the same way refresh tokens work. */
export const hashInvite = (token) => createHash('sha256').update(String(token)).digest('hex');
/**
 * An invitation: a 192-bit random token, a link to the SPA's /set-password screen, and — when a mailer
 * is configured — the same link in an e-mail. The token is what lets someone who has never had a password
 * create one without anyone knowing it first, so it is single-use, hashed at rest, and time-boxed.
 */
export async function createInvite(id, { auth, sendEmail = true } = {}) {
  const target = await repo.getUser(id);
  if (!target) throw AppError.notFound('User not found');
  // The peer-admin rule belongs here too, and it matters: a set-password link IS a password reset, so an
  // admin who may not type a peer's password may not mail themselves the means to either.
  assertNotAnotherAdmin(auth, target, 'send a password link to');
  if (!config.features.invite) throw new AppError('INVITES_OFF', 'Invitations are switched off on this server (FEATURE_INVITE=false) — set the password here instead', { status: 409 });
  if (target.is_active === false) throw AppError.conflict('This account is deactivated — activate it before sending an invite', { code: 'USER_INACTIVE' });
  const token = randomBytes(24).toString('base64url');
  const inv = await repo.createInvitation({ email: target.work_email, userId: target.id, tokenHash: hashInvite(token),
    invitedBy: auth?.userId, ttlHours: config.invite.ttlHours });
  const link = `${config.appUrl.replace(/\/$/, '')}/set-password?token=${token}`;
  // must_change_pw stays true until the link is used, so a half-finished sign-up cannot get a long session.
  await repo.patchUser(target.id, { must_change_pw: true });
  // The send itself belongs to the queue, one job per account, exactly like payslip mail: the request that
  // creates a hundred logins must not spend a hundred SMTP round trips in front of the admin's browser, and
  // a job that fails gets the worker's own retries. Only the invitation id and the recipient go in the
  // durable payload; the token lives in the job data, which is why it is never written to Postgres.
  const dedupe = `invite:${inv.id}`;
  // Computed once, at the top, because both returns below report it: which driver is live *now*, including a
  // login the admin pasted into Settings → Company (an env-only read here would say "preview" about a box that
  // is really sending).
  const { mailStatus } = await import('./mail.service.js');
  const mailDriver = (await mailStatus()).driver;
  // No e-mail requested means nothing to log: the link is the whole delivery, so no task row is made.
  if (!sendEmail) {
    return { id: inv.id, link, token, expires_at: inv.expires_at, expires_in_hours: config.invite.ttlHours,
      task_id: null, email: { skipped: true }, mail_queued: false, mail_sent: false, mail_skipped: true,
      mail_driver: mailDriver, sent_from: config.appUrl, delivery_mode: 'not-requested',
      how_it_is_delivered: 'No e-mail was requested — the link below is the whole delivery.' };
  }
  // One row in task_queue either way, because that is the log the admin can see (Settings → System) — whether
  // this request sent the message or a worker will. Only the invitation id and the recipient go in it:
  // the token itself is never written to Postgres, only its hash in the invitations table.
  const task = await deliveryRepo.enqueueTask({ task_type: 'SEND_EMAIL', entity_type: 'USER', entity_id: target.id,
    dedupe_key: dedupe, queue_name: QUEUES.email,
    payload: { kind: 'account-invite', invitation_id: inv.id, to: target.work_email, name: target.name, hours: config.invite.ttlHours, inviter: auth?.name || null } });
  let mail = { task_id: task.id };
  if (config.invite.viaQueue) {
    // The opt-in shape: one job per account on the mail queue, so a bulk import of logins costs the admin
    // nothing and the worker's retries cover a provider that is having a bad minute.
    try {
      await schedule(QUEUES.email, 'account-invite', { taskId: task.id, invitationId: inv.id, token }, { dedupeKey: dedupe });
      mail = { queued: true, task_id: task.id };
    } catch (e) {
      mail = await mailInvite({ name: target.name, email: target.work_email, link, hours: config.invite.ttlHours, inviter: auth?.name });
      mail.queue_fallback_reason = `the queue was unavailable (${e.message}) — sent by this request instead`;
      await deliveryRepo.markTask(task.id, mail.ok ? 'COMPLETED' : 'FAILED', { error: mail.error || (mail.ok ? null : 'send failed') });
    }
  } else {
    // The default: the link goes out from here, now, one message per account. Slow is acceptable — waiting
    // for a worker that may not be running is not.
    mail = await mailInvite({ name: target.name, email: target.work_email, link, hours: config.invite.ttlHours, inviter: auth?.name });
    await deliveryRepo.markTask(task.id, mail.ok ? 'COMPLETED' : 'FAILED', { error: mail.error || (mail.ok ? null : 'send failed') });
  }
  return {
    id: inv.id, link, token, expires_at: inv.expires_at, expires_in_hours: config.invite.ttlHours,
    task_id: mail.task_id || null, email: mail, mail_queued: !!mail.queued, mail_sent: mail.ok === true,
    mail_skipped: !!mail.skipped, mail_driver: mailDriver, sent_from: config.appUrl,
    delivery_mode: mail.queued ? 'queued' : sendEmail ? 'sent-by-request' : 'not-requested',
    how_it_is_delivered: !sendEmail
      ? 'No e-mail was requested — the link below is the whole delivery.'
      : mail.queued
        ? `One job per account, handed to the worker on queue "${QUEUES.email}"; watch it under Settings → System. Driver: ${driver}.`
        : mail.ok === false
          ? `The account and the link are ready, but the mail server refused the send (${mail.error || driver}). Copy the link below and send it yourself — the invitation stays valid until it is used.`
          : driver === 'preview'
            ? 'Sent by this request. There are no SMTP credentials in Settings \u2192 Company \u2192 E-mail delivery, so the message went to backend/storage/mail as a .eml — open it and copy the link, or set the login there and it will go out for real.'
            : `Sent to ${target.work_email} by this request via ${mail.driver || driver} — one message per account, no queue in between.`,
  };
}
async function mailInvite({ name, email, link, hours, inviter }) {
  const { render } = await import('../lib/mailer/index.js');
  // `mailerFor` = Settings → Company first, environment second, so the SMTP login an admin pasted into the
  // product is the one that sends. (An earlier round read process.env here, which is why a configured box still
  // wrote .eml files until somebody edited .env by hand.)
  const { mailer: mailerFor } = await import('./mail.service.js');
  const mailer = await mailerFor();
  const vars = { first_name: String(name || '').split(' ')[0], link, hours, inviter: inviter || 'the payroll team', company: 'PeoplePay360' };
  const text = render('Hi {{first_name}},\n\nAn account has been created for you on {{company}}. Pick a password and you are in — the link is valid for {{hours}} hours and works once.\n\n{{link}}\n\nIf you did not expect this, ignore the message: nothing happens to your account.', vars);
  const html = render('<p>Hi <b>{{first_name}}</b>,</p><p>An account has been created for you on <b>{{company}}</b>. Choose a password to finish setting it up.</p>'
    + '<p><a href="{{link}}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2f5bd7;color:#fff;text-decoration:none">Choose your password</a></p>'
    + '<p style="color:#666">The link is valid for {{hours}} hours and can be used once. Or copy this address: <code>{{link}}</code></p>'
    + '<p style="color:#666">Did not expect this? Ignore it — nothing changes on your account.</p>', vars);
  try {
    const out = await mailer.send({ to: email, subject: 'Finish your PeoplePay360 account — choose a password', text, html, previewDir: config.mailDir });
    return { ok: !!out.ok, sent_inline: true, driver: out.driver, file: out.file || null, messageId: out.messageId || null };
  } catch (e) {
    // The link is already stored, so a provider that says no must not look like a failed invite.
    return { ok: false, driver: mailer.driver, error: e.message };
  }
}
/** Used by the public /auth/invite/:token lookup and by POST /auth/set-password. */
export async function readInvite(token) {
  const row = await repo.findInvitation(hashInvite(token));
  if (!row) return { valid: false, reason: 'This link is not one we issued. Copy the whole address from the e-mail, or ask for a new link.' };
  if (row.accepted_at) return { valid: false, reason: 'This link has already been used. Ask your admin to send a new one.' };
  if (new Date(row.expires_at) < new Date()) return { valid: false, reason: 'This link expired. Ask your admin to send a new one.' };
  if (row.is_active === false) return { valid: false, reason: 'This account is switched off, so the link will not open it. Ask your admin to activate it.' };
  return { valid: true, name: row.name, work_email: row.work_email, expires_at: row.expires_at, already_set: row.must_change_pw !== true };
}
export async function completeInvite(token, password) {
  const state = await readInvite(token);
  if (!state.valid) throw AppError.badRequest(state.reason, { code: 'INVITE_UNUSABLE' });
  const row = await repo.findInvitation(hashInvite(token));
  const spent = await repo.acceptInvitation(row.id);
  if (!spent) throw AppError.conflict('That link was used a moment ago. Ask for a new one.', { code: 'INVITE_USED' });
  const { hashPassword } = await import('../middleware/auth.js');
  await repo.setPassword(row.user_id, await hashPassword(password), { mustChange: false });
  await repo.revokeAllRefresh(row.user_id);
  return { ok: true, work_email: row.work_email, note: 'Password set — sign in with it. This link cannot be used again.' };
}
export const invitesFor = (userId) => repo.openInvitations(userId);
/** Accounts that exist but have never had a password of their own, and have no open link right now. */
export const pendingInvites = async () => (await repo.accountsAwaitingPassword(1000)).map((u) => ({ id: u.id, name: u.name, work_email: u.work_email }));
/**
 * "Send them all" — one account at a time, in order, from this request. It is deliberately a loop rather
 * than a fan-out: SMTP is per message, the provider's daily cap is per message, and the report below is only
 * honest if each account's outcome is recorded as it happens. It stops early on a rate-limit so a hundred
 * failed sends do not burn the rest of the day's quota.
 */
export async function sendPendingInvites({ auth, limit = config.invite.bulkLimit } = {}) {
  const wanted = Math.max(1, Math.min(Number(limit) || 1, 100));
  const waiting = await repo.accountsAwaitingPassword(wanted);
  const started = Date.now();
  const results = [];
  for (const u of waiting) {
    try {
      const out = await createInvite(u.id, { auth, sendEmail: true });
      results.push({ id: u.id, name: u.name, work_email: u.work_email, ok: out.mail_sent || out.mail_queued,
        via: out.delivery_mode, note: out.how_it_is_delivered, link: out.link });
      if (out.email?.ok === false && /5\.4\.5|rate|quota|daily/i.test(String(out.email.error || ''))) {
        results.push({ stopped: true, reason: 'the mail provider hit its own limit — the rest of the list was left alone' });
        break;
      }
    } catch (e) {
      results.push({ id: u.id, name: u.name, work_email: u.work_email, ok: false, note: e.message });
    }
  }
  const sent = results.filter((r) => r.ok).length;
  return {
    attempted: results.filter((r) => !r.stopped).length, sent, failed: results.filter((r) => r.ok === false).length,
    waiting_before: waiting.length, took_ms: Date.now() - started, results,
    note: waiting.length === 0
      ? 'Nobody is waiting: every active account either has a password or has a link out already.'
      : `One message per account, sent in ${Math.max(1, Math.round((Date.now() - started) / 1000))}s for ${waiting.length} account(s).`,
  };
}
export const read = async (id) => {
  const u = await repo.getUser(id);
  if (!u) throw AppError.notFound('User not found');
  return u;
};
/**
 * The mockup's Create User panel: pick an employee (or create one), tick roles, set status.
 * Guards that matter: no self-demotion, and never remove the last admin.
 */
export async function create(data, { auth } = {}) {
  if (data.roles?.length > 1) throw AppError.badRequest('An account has exactly one role — pick the one that fits, and change it later if the job changes', { code: 'ROLE_MULTI_NOT_ALLOWED', roles: data.roles });
  const roles = normaliseRoles(data.roles?.length ? data.roles : [data.role]);
  const email = String(data.work_email || '').trim().toLowerCase();
  if (await repo.getUserByEmail(email)) throw AppError.conflict('A user with this work email already exists', { code: 'EMAIL_TAKEN' });
  const password = data.password || config.demo.password;
  return transaction(async (client) => {
    const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
    let employeeId = data.employee_id || null;
    if (!employeeId && data.new_employee) {
      const code = await employeeRepo.nextEmployeeCode();
      const emp = await employeeRepo.createEmployee({ employee_code: code, name: data.new_employee.name || data.name, work_email: email,
        date_of_joining: data.new_employee.date_of_joining || new Date().toISOString().slice(0, 10),
        job_position: data.new_employee.job_position || null, department_id: data.new_employee.department_id || null,
        basic_salary: data.new_employee.basic_salary || null }, q);
      employeeId = emp.id;
    }
    const user = await repo.createUser({ name: data.name, work_email: email, password_hash: await hashPassword(password),
      role: roles.includes('ADMIN') ? 'ADMIN' : roles[0], is_active: data.is_active !== false,
      must_change_pw: !!data.must_change_pw }, q);
    await repo.setRoles(user.id, roles, auth?.userId, q);
    if (employeeId) await repo.linkEmployee(user.id, employeeId, q);
    const full = await repo.getUser(user.id, q);
    // The app never shows a password, but "the shared demo password works" and "the password you typed
    // works" are two different hand-overs. Without saying which one happened, the create dialog looks
    // like a form that ate the credentials and the first sign-in fails with no explanation.
    // The password is the awkward part of creating a login: the admin should not have to relay one. When no
    // temporary password was typed, an invite link goes out and the person sets their own.
    let invite = null;
    const sendInvite = data.send_invite ?? !data.password;
    if (sendInvite) {
      try { invite = await createInvite(full.id, { auth, sendEmail: true }); }
      catch (e) { invite = { error: e.message }; }
    }
    return { ...full, password_source: data.password ? 'provided' : 'invite', sign_in_note: data.password
      ? 'Signed in with the password you typed here.'
      : invite && !invite.error ? 'An invitation link was created — the person sets the first password themselves.'
      : `Signed in with the shared demo password (DEMO_PASSWORD in backend/.env — ${config.demo.password.length} characters).`,
      invite };
  });
}
export async function update(id, patch, { auth } = {}) {
  const target = await repo.getUser(id);
  if (!target) throw AppError.notFound('User not found');
  if (patch.roles?.length > 1) throw AppError.badRequest('An account has exactly one role', { code: 'ROLE_MULTI_NOT_ALLOWED' });
  const touching = patch.is_active !== undefined ? 'deactivate' : (patch.roles || patch.role) ? 'change the role of' : null;
  assertNotAnotherAdmin(auth, target, touching);
  const out = { ...target };
  if (patch.name !== undefined || patch.is_active !== undefined || patch.must_change_pw !== undefined) {
    await repo.patchUser(id, { name: patch.name, is_active: patch.is_active, must_change_pw: patch.must_change_pw });
  }
  if (patch.roles || patch.role) {
    const roles = normaliseRoles(patch.role ? [patch.role] : patch.roles);
    await guards({ auth, target, roles, activating: patch.is_active !== false });
    await repo.setRoles(id, roles, auth?.userId);
    await repo.linkEmployee(id, patch.employee_id === undefined ? target.employee_id : patch.employee_id);
  } else if (patch.employee_id !== undefined) {
    await repo.linkEmployee(id, patch.employee_id);
  }
  return repo.getUser(id);
}
/**
 * An administrator can create accounts, read them and switch them over — but a peer admin is untouchable.
 * Two people sharing the top role can otherwise lock each other out (deactivate the other, then remove the
 * only remaining active admin), which is exactly the failure mode an audit is supposed to prevent.
 */
function assertNotAnotherAdmin(auth, target, doing) {
  if (!doing) return;
  const isSelf = String(auth?.userId) === String(target.id);
  const targetIsAdmin = (target.roles || [target.role]).includes('ADMIN') || target.role === 'ADMIN';
  if (targetIsAdmin && !isSelf) {
    throw AppError.forbidden(`Administrators cannot ${doing} another administrator's account — that person has to change it themselves, or the only other admin has to do it from their own login`,
      { code: 'ADMIN_PEER', target_role: 'ADMIN' });
  }
}
async function guards({ auth, target, roles, activating }) {
  const isSelf = String(auth?.userId) === String(target.id);
  if (isSelf) {
    if (!roles.includes('ADMIN')) throw AppError.forbidden('You cannot remove your own admin access — ask another administrator');
    if (!activating) throw AppError.forbidden('You cannot deactivate your own account');
  }
  if (target.is_active && !activating && Number(await repo.countAdmins()) <= 1 && (target.roles || []).includes('ADMIN')) {
    throw new AppError('LAST_ADMIN', 'This is the only active admin account. Promote someone else first.', { status: 409 });
  }
  if (roles.includes('ADMIN') && !auth?.roles?.includes('ADMIN')) throw AppError.forbidden('Only an admin can grant admin access');
  // Promoting a peer is a one-way door by design: from then on only they can change that account,
  // which is what setRole() says out loud in its response.
}
export async function setRole(id, role, { auth }) {
  const target = await repo.getUser(id);
  if (!target) throw AppError.notFound('User not found');
  assertNotAnotherAdmin(auth, target, 'change the role of');
  const list = normaliseRoles([role]);
  await guards({ auth, target, roles: list, activating: target.is_active });
  await repo.setRoles(id, list, auth?.userId);
  const fresh = await repo.getUser(id);
  // repo.setRoles signed everybody out; say so, because the page has to tell the admin why the row is now
  // sitting at a login box instead of at the screen they were looking at.
  return { ...fresh, must_sign_in: true, note: fresh.role === 'ADMIN'
    ? 'They are an admin now, which means only they can change this account from here on.'
    : null };
}
/** Kept so an older client that posts a list still works — but only with exactly one role in it. */
export const setRoles = (id, roles, ctx) => {
  if ([].concat(roles || []).length !== 1) throw AppError.badRequest('An account has exactly one role', { code: 'ROLE_MULTI_NOT_ALLOWED' });
  return setRole(id, [].concat(roles)[0], ctx);
};
export async function setActive(id, active, { auth }) {
  const target = await repo.getUser(id);
  if (!target) throw AppError.notFound('User not found');
  assertNotAnotherAdmin(auth, target, active ? 'activate' : 'deactivate');
  if (!active) await guards({ auth, target, roles: target.roles, activating: false });
  await repo.patchUser(id, { is_active: active });
  if (!active) await repo.revokeAllRefresh(id);
  return repo.getUser(id);
}
export async function resetPassword(id, newPassword, { mustChange = true, auth } = {}) {
  const target = await repo.getUser(id);
  if (!target) throw AppError.notFound('User not found');
  assertNotAnotherAdmin(auth, target, 'reset the password of');
  if (String(newPassword || '').length < 10) throw AppError.badRequest('Password must be at least 10 characters');
  await repo.setPassword(id, await hashPassword(newPassword), { mustChange });
  await repo.revokeAllRefresh(id);
  return { ok: true, mustChange, note: 'All sessions for this user were revoked' };
}
function normaliseRoles(roles) {
  const list = [...new Set([].concat(roles || []).filter(Boolean).map((r) => String(r).toUpperCase()))];
  if (list.length > 1) throw AppError.badRequest('An account has exactly one role (the spec defines five of them) — pick the closest', { code: 'ROLE_MULTI_NOT_ALLOWED', roles: list });
  if (!list.length) throw AppError.badRequest('Pick at least one role', { code: 'ROLE_REQUIRED' });
  const bad = list.filter((r) => !ROLES.includes(r));
  if (bad.length) throw AppError.badRequest(`Unknown role(s): ${bad.join(', ')}`, { code: 'ROLE_UNKNOWN', allowed: ROLES, labels: ROLE_LABEL });
  return list;
}
export const accessMatrix = async () => {
  const { PERMISSIONS, ROLE_PERMISSIONS, ROLE_LABEL, DENIES, SCOPE, can } = await import('../lib/shared/index.js');
  return {
    permissions: Object.entries(PERMISSIONS).map(([key, meta]) => ({ key, ...meta, roles: ROLES.filter((r) => can(key, { roles: [r], permissions: [] })) })),
    roles: ROLES.map((r) => ({ key: r, label: ROLE_LABEL[r], scope: SCOPE[r], granted: ROLE_PERMISSIONS[r], denied: (DENIES[r] || []).filter(Boolean) })),
  };
};
