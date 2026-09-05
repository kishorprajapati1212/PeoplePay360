import { query } from '../db/pool.js';
import { logger } from '../logger.js';
const WRITE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL = '00000000-0000-0000-0000-000000000000';
const ENTITY = /\/api\/([a-z-]+)(?:\/([0-9a-f-]{36}))?/i;
/**
 * Writes are audited in the same request (not in a hook that can be forgotten): who did what to which
 * row, from where. Failures are logged but never break the user's action.
 */
export function audit({ read = false } = {}) {
  return (req, res, next) => {
    if (!WRITE.has(req.method) && !read) return next();
    res.on('finish', () => {
      if (res.statusCode >= 400 && res.statusCode < 500) return;   // don't fill the log with permission denials
      const m = ENTITY.exec(req.originalUrl);
      const id = res.locals.auditEntityId
        || (m && m[2] && String(res.locals.entityId ?? '') === m[2] ? m[2] : m?.[2] ?? null);
      const row = {
        summary: `${req.method} ${req.originalUrl} → ${res.statusCode}`,
        actor: req.auth?.userId ?? null,
        action: `${req.method.toLowerCase()}:${(m?.[1] || req.originalUrl.split('/')[2] || 'root')}`,
        entity: res.locals.auditEntity || m?.[1] || 'unknown',
        entityId: id,
        before: res.locals.auditBefore ?? null,
        after: res.locals.auditAfter ?? null,
        ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
        ua: (req.headers['user-agent'] || '').slice(0, 300),
        rid: req.id,
        status: res.statusCode,
      };
      query(`insert into audit_logs (entity_type, entity_id, action, actor_user, actor_type, old_values, new_values, summary, ip, user_agent, request_id)
             values ($1, $2::uuid, $3, $4, 'USER', $5, $6, $7, $8, $9, $10)`,
        [String(row.entity).slice(0, 60), UUID.test(String(row.entityId)) ? row.entityId : NIL, row.action.slice(0, 80),
         row.actor, row.before ? JSON.stringify(row.before) : null, row.after ? JSON.stringify(row.after) : null,
         row.summary || null, row.ip, row.ua, row.rid])
        .catch((e) => logger.warn({ err: e.message }, 'audit write failed'));
    });
    next();
  };
}
/** Call from a service to record a named change with a payload. */
export async function recordAudit({ actorUserId, actorRole, action, entity, entityId, before, after, ip, userAgent, requestId }) {
  await query(`insert into audit_logs (entity_type, entity_id, action, actor_user, actor_type, old_values, new_values, summary, ip, user_agent, request_id)
                values ($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [entity, validId(entityId) || NIL, action, actorUserId || null, actorRole === 'WORKER' || actorRole === 'SYSTEM' ? actorRole : 'USER',
     before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, null, ip || null, userAgent || null, requestId || null]);
}
const validId = (v) => (UUID.test(String(v)) ? v : null);
export const setAudit = (res, patch) => Object.assign(res.locals, patch);
