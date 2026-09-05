import { query } from '../db/pool.js';
import { params0 } from './_helpers.js';
import { mapKeys } from './sql.js';

export const listAudit = async (f = {}) => {
  const { params, P } = params0();
  const clauses = ['true'];
  if (f.entityType) clauses.push(`a.entity_type = ${P(f.entityType)}`);
  if (f.entityId) clauses.push(`a.entity_id = ${P(f.entityId)}`);
  if (f.actor) clauses.push(`a.actor_user = ${P(f.actor)}`);
  if (f.action) clauses.push(`a.action ilike ${P(`%${f.action}%`)}`);
  if (f.from) clauses.push(`a.created_at >= ${P(f.from)}`);
  if (f.to) clauses.push(`a.created_at <= (${P(f.to)})::timestamptz + interval '1 day'`);
  const { rows } = await query(`select a.*, u.name as actor_name, u.role as actor_role, count(*) over () as total
    from audit_logs a left join users u on u.id = a.actor_user
    where ${clauses.join(' and ')} order by a.created_at desc limit ${P(f.limit || 100)} offset ${P(f.offset || 0)}`, params);
  return { rows, total: Number(rows[0]?.total ?? 0) };
};
export const auditForEntity = (entityType, entityId) =>
  query(`select a.*, u.name as actor_name from audit_logs a left join users u on u.id = a.actor_user
         where a.entity_type = $1 and a.entity_id = $2::uuid order by a.created_at desc limit 50`, [entityType, entityId]).then((r) => r.rows);
