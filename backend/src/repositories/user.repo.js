import { query } from '../db/pool.js';
import { params0 } from './_helpers.js';

/**
 * users is the login; employees.user_id links the person. Roles live in user_role_grants, with
 * users.role kept as the primary role (it is what the mockup's single "Role" column shows).
 */
const USER_SELECT = `
  select u.id, u.name, u.work_email, u.role, u.is_active, u.must_change_pw, u.last_login_at, u.created_at,
         e.id as employee_id, e.name as employee_name, e.employee_code, e.status as employee_status,
         d.name as department,
         coalesce(array_agg(distinct g.role::text) filter (where g.role is not null), '{}') as roles
  from users u
  left join employees e on e.user_id = u.id
  left join departments d on d.id = e.department_id
  left join user_role_grants g on g.user_id = u.id`;

export async function listUsers(f = {}) {
  const { params, P, list } = params0();
  const clauses = ['true'];
  if (f.search) { const p = P(`%${f.search}%`); clauses.push(`(u.name ilike ${p} or u.work_email ilike ${p} or e.name ilike ${p} or e.employee_code ilike ${p})`); }
  if (f.role) clauses.push(`(u.role = ${P(f.role)} or exists (select 1 from user_role_grants g2 where g2.user_id = u.id and g2.role = $${params.length}))`);
  if (f.status === 'active') clauses.push(`u.is_active`);
  if (f.status === 'inactive') clauses.push(`not u.is_active`);
  if (f.unlinked) clauses.push(`e.id is null`);
  if (f.ids?.length) clauses.push(`u.id in (${list(f.ids)})`);
  const { rows } = await query(`
    select *, count(*) over () as total from (
      ${USER_SELECT} where ${clauses.join(' and ')} group by u.id, e.id, d.id
    ) x
    order by x.name asc nulls last, x.created_at desc
    limit ${P(f.limit || 200)} offset ${P(f.offset || 0)}`, params);
  return { rows: rows.map((r) => ({ ...r, roles: dedupe([r.role, ...r.roles]) })), total: Number(rows[0]?.total ?? 0) };
}
const dedupe = (a) => [...new Set(a.filter(Boolean))];
export const getUser = (id, q = query) =>
  q(`${USER_SELECT} where u.id = $1 group by u.id, e.id, d.id`, [id]).then((r) => {
    const x = r.rows[0]; if (!x) return null;
    return { ...x, roles: dedupe([x.role, ...x.roles]) };
  });
export const getUserByEmail = (email) =>
  query(`select * from users where lower(work_email) = lower($1)`, [email]).then((r) => r.rows[0] || null);
/** Login path: primary role + grants in one round trip. */
export const getForLogin = (email) =>
  query(`select u.*, coalesce(array_agg(distinct g.role::text) filter (where g.role is not null), '{}') as roles,
                e.id as employee_id
         from users u
         left join user_role_grants g on g.user_id = u.id
         left join employees e on e.user_id = u.id
         where lower(u.work_email) = lower($1) group by u.id, e.id`, [email]).then((r) => {
    const x = r.rows[0]; if (!x) return null;
    return { ...x, roles: dedupe([x.role, ...x.roles]) };
  });
export const rolesOf = (id, q = query) =>
  q(`select distinct role from user_role_grants where user_id = $1 union select role from users where id = $1`, [id]).then((r) => r.rows.map((x) => x.role));
export const createUser = (d, q = query) =>
  q(`insert into users (name, work_email, password_hash, role, is_active, must_change_pw)
         values ($1,$2,$3,$4,coalesce($5,true),coalesce($6,false)) returning id, name, work_email, role, is_active, created_at`,
    [d.name, d.work_email, d.password_hash, d.role, d.is_active, d.must_change_pw]).then((r) => r.rows[0]);
/** Replace the grant set; the primary role is kept as the first one so the list column stays meaningful. */
export async function setRoles(userId, roles, grantedBy, q = query) {
  await q(`delete from user_role_grants where user_id = $1`, [userId]);
  if (!roles?.length) return rolesOf(userId, q);
  await q(`insert into user_role_grants (user_id, role, granted_by) select $1, unnest($2::user_role[]), $3`, [userId, roles, grantedBy || null]);
  await q(`update users set role = $2 where id = $1`, [userId, roles.includes('ADMIN') ? 'ADMIN' : roles[0]]);
  // A role change is the one edit whose consequences must not be able to outlive it: bump token_version (the
  // JWT's `tv` is compared against this column on every request) and drop the outstanding refresh tokens, so
  // the browser that was an HR manager a second ago has to sign in again before it is anything.
  await q(`update users set token_version = token_version + 1 where id = $1`, [userId]);
  await q(`update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
  return rolesOf(userId, q);
}
export const patchUser = (id, p, q = query) => {
  const allowed = ['name', 'is_active', 'must_change_pw', 'password_hash', 'role'];
  const { params, P } = params0();
  const sets = allowed.filter((k) => p[k] !== undefined).map((k) => `${k} = ${P(p[k])}`);
  if (!sets.length) return getUser(id, q);
  params.push(id);
  return q(`update users set ${sets.join(', ')} where id = $${params.length}
                returning id, name, work_email, role, is_active, must_change_pw`, params).then((r) => r.rows[0]);
};
export const setPassword = (id, hash, { mustChange = false } = {}) =>
  query(`update users set password_hash = $2, must_change_pw = $3, token_version = token_version + 1 where id = $1`, [id, hash, mustChange]);
export const touchLogin = (id) => query(`update users set last_login_at = now() where id = $1`, [id]).then(() => true);
export const storeRefresh = ({ userId, tokenHash, familyId, expiresAt, userAgent, ip }, q = query) =>
  q(`insert into refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip) values ($1,$2,$3,$4,$5,$6)`,
    [userId, tokenHash, familyId, expiresAt, userAgent || null, ip || null]);
export const takeRefresh = (tokenHash) =>
  query(`select t.*, u.is_active from refresh_tokens t join users u on u.id = t.user_id
         where t.token_hash = $1 and t.revoked_at is null and t.expires_at > now()`, [tokenHash]).then((r) => r.rows[0] || null);
export const revokeRefreshFamily = (familyId, q = query) => q(`update refresh_tokens set revoked_at = now() where family_id = $1 and revoked_at is null`, [familyId]);
export const revokeAllRefresh = (userId) => query(`update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
/* Invitations: a random token goes in the link, its SHA-256 goes in the row. A leaked table therefore
   leaks nothing usable, and a link can only ever be spent once (accepted_at). */
export const createInvitation = ({ email, userId, tokenHash, invitedBy, ttlMinutes = 10 }, q = query) =>
  q(`insert into invitations (email, user_id, token_hash, invited_by, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(mins => $5::int))
     returning id, token_hash, expires_at`,
    [email, userId || null, tokenHash, invitedBy || null, Math.max(1, Math.round(Number(ttlMinutes) || 10))]).then((r) => r.rows[0]);
export const findInvitation = (tokenHash) =>
  query(`select i.*, u.name, u.work_email, u.is_active, u.must_change_pw, count(*) over () as total
         from invitations i join users u on u.id = i.user_id where i.token_hash = $1`, [tokenHash]).then((r) => r.rows[0] || null);
export const acceptInvitation = (id) =>
  query(`update invitations set accepted_at = now() where id = $1 and accepted_at is null returning id`, [id]).then((r) => r.rows[0] || null);
/** Open invites for one user, newest first — the Users screen shows the link that is still usable. */
/**
 * Active accounts that cannot sign in yet — no password set by their owner (must_change_pw) and no open
 * invitation already out for them. That last part is what keeps a pressed-twice button from mailing a
 * person twice: an unexpired, unused link is enough to leave them alone.
 */
export const accountsAwaitingPassword = (limit = 50) =>
  query(`select u.id, u.name, u.work_email from users u
         where u.is_active and u.must_change_pw
           and not exists (select 1 from invitations i
                           where i.user_id = u.id and i.accepted_at is null and i.expires_at > now())
         order by u.created_at limit $1`, [Number(limit) || 50]).then((r) => r.rows);
export const openInvitations = (userId) =>
  query(`select id, email, expires_at, created_at from invitations
         where user_id = $1 and accepted_at is null and expires_at > now() order by created_at desc`, [userId]).then((r) => r.rows);
export const linkEmployee = (userId, employeeId, q = query) =>
  q(`update employees set user_id = $2 where id = $1`, [employeeId || null, userId || null])
    .then(() => query(`update employees set user_id = null where user_id = $1 and ($2::uuid is null or id <> $2)`, [userId, employeeId || null]));
export const countAdmins = () =>
  query(`select count(distinct u.id) as n from users u where u.is_active and (u.role = 'ADMIN' or exists (select 1 from user_role_grants g where g.user_id = u.id and g.role = 'ADMIN'))`)
    .then((r) => Number(r.rows[0].n));
