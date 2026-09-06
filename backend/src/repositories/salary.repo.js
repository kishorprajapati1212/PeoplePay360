import { query } from '../db/pool.js';
import { mapKeys, like } from './sql.js';
import { params0 } from './_helpers.js';

// ── structures ────────────────────────────────────────────────────────────────
export const listStructures = async ({ search, includeInactive } = {}) => {
  const { params, P } = params0();
  const clauses = ['true'];
  // Same rule as every other list in the app: inactive rows are hidden until the screen explicitly
  // asks for them (include_inactive). This one repo forgot, so a deactivated structure stayed in the
  // list right after the "deactivated" toast — looking exactly like the button did nothing.
  if (!includeInactive) clauses.push(`s.is_active = 'ACTIVE'`);
  if (search) clauses.push(`(s.name ilike ${P(`%${search}%`)} or s.code ilike $${params.length})`);
  const { rows } = await query(`
    select s.id, s.name, s.code, s.description, s.is_active, s.created_at,
           (select count(*) from salary_rules r where r.salary_structure_id = s.id) as rules,
           (select count(distinct c.employee_id) from contracts c where c.salary_structure_id = s.id) as employees,
           (select count(*) from payruns p where p.salary_structure_id = s.id) as payruns,
           (select coalesce(sum(c.wage),0) from contracts c join employees e on e.id = c.employee_id
              where c.salary_structure_id = s.id and e.status = 'ACTIVE') as monthly_wage
    from salary_structures s where ${clauses.join(' and ')} order by s.name`, params);
  return rows.map((r) => mapKeys(r, ['rules', 'employees', 'payruns', 'monthly_wage']));
};
export const getStructure = (id) =>
  query(`select s.*, (select count(*) from salary_rules r where r.salary_structure_id = s.id) as rules,
                (select count(distinct c.employee_id) from contracts c where c.salary_structure_id = s.id) as employees
         from salary_structures s where s.id = $1`, [id]).then((r) => mapKeys(r.rows[0], ['rules', 'employees']));
export const getStructureByName = (name) => query(`select * from salary_structures where lower(name) = lower($1)`, [name]).then((r) => r.rows[0] || null);
export const createStructure = (d) =>
  query(`insert into salary_structures (name, code, description, is_active) values ($1,$2,$3,coalesce($4,'ACTIVE')::record_status) returning *`,
    [d.name, d.code || null, d.description || null, d.is_active]).then((r) => r.rows[0]);
export const updateStructure = (id, p) => {
  const keys = ['name', 'code', 'description', 'is_active'].filter((k) => p[k] !== undefined);
  if (!keys.length) return getStructure(id);
  return query(`update salary_structures set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning *`, [id, ...keys.map((k) => p[k])]).then((r) => r.rows[0]);
};
export const deleteStructure = (id) =>
  // A real delete, not a quiet deactivation: the row disappears from the list, which is what the person
  // pressing Delete expects. Only reached when nothing references the structure (the service checked
  // contracts and payruns first); its rules go with it, because a rule cannot exist without a structure
  // and no payslip line can point at them — the same guard that protects a rule's own delete.
  query(`delete from salary_structures s
         where s.id = $1
           and not exists (select 1 from contracts c where c.salary_structure_id = $1)
           and not exists (select 1 from payruns r where r.salary_structure_id = $1)
           and not exists (select 1 from salary_rules r join payslip_lines l on l.salary_rule_id = r.id
                           where r.salary_structure_id = $1)
         returning s.id`, [id]).then((r) => r.rows[0] || null);

// ── rules ─────────────────────────────────────────────────────────────────────
const RULE_COLS = ['salary_structure_id', 'name', 'code', 'category', 'line_kind', 'sequence', 'computation_type', 'amount',
                   'percentage', 'base_code', 'formula', 'condition_expr', 'quantity_expr', 'pro_rata', 'evaluation_period',
                   'cap_amount', 'annual_cap', 'rounding_mode', 'is_taxable', 'is_report_only', 'appears_on_payslip',
                   'appears_in_report', 'statutory', 'active_from', 'active_to', 'notes'];
const RULE_SELECT = `select r.*, s.name as structure, s.is_active as structure_status
                      from salary_rules r join salary_structures s on s.id = r.salary_structure_id`;
export const listRules = async (f = {}) => {
  const { params, P } = params0();
  const clauses = ['true'];
  if (f.structureId) clauses.push(`r.salary_structure_id = ${P(f.structureId)}`);
  if (f.category) clauses.push(`r.category = ${P(f.category)}`);
  if (f.search) { const p = P(`%${f.search}%`); clauses.push(`(r.name ilike ${p} or r.code ilike $${params.length})`); }
  const { rows } = await query(`select *, count(*) over () as total from (${RULE_SELECT} where ${clauses.join(' and ')}
    order by s.name, r.sequence) x limit ${P(f.limit || 300)} offset ${P(f.offset || 0)}`, params);
  return { rows: rows.map((r) => mapKeys(r, ['amount', 'percentage', 'cap_amount', 'annual_cap'])), total: Number(rows[0]?.total ?? 0) };
};
export const rulesOfStructure = (structureId, { at } = {}) =>
  query(`${RULE_SELECT} where r.salary_structure_id = $1 ${at ? `and r.active_from <= $2 and (r.active_to is null or r.active_to >= $2)` : ''}
         order by r.sequence`, at ? [structureId, at] : [structureId]).then((r) => r.rows.map((x) => mapKeys(x, ['amount', 'percentage', 'cap_amount', 'annual_cap'])));
export const getRule = (id) => query(`${RULE_SELECT} where r.id = $1`, [id]).then((r) => mapKeys(r.rows[0], ['amount', 'percentage', 'cap_amount', 'annual_cap']));
export const createRule = (d, q = query) =>
  q(`insert into salary_rules (${RULE_COLS.filter((c) => d[c] !== undefined).join(', ')})
     values (${RULE_COLS.filter((c) => d[c] !== undefined).map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    RULE_COLS.filter((c) => d[c] !== undefined).map((c) => d[c])).then((r) => mapKeys(r.rows[0], ['amount', 'percentage', 'cap_amount', 'annual_cap']));
export const updateRule = (id, p, q = query) => {
  const keys = RULE_COLS.filter((k) => k !== 'salary_structure_id' && p[k] !== undefined);
  if (!keys.length) return getRule(id);
  return q(`update salary_rules set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning *`,
    [id, ...keys.map((k) => p[k])]).then((r) => mapKeys(r.rows[0], ['amount', 'percentage', 'cap_amount', 'annual_cap']));
};
export const deleteRule = (id, q = query) =>
  q(`delete from salary_rules r where r.id = $1
     and not exists (select 1 from payslip_lines l where l.salary_rule_id = $1) returning id`, [id]).then((r) => r.rows[0] || null);
/** Sequence uniqueness is enforced per structure; this shifts everything above an inserted rule. */
export const makeRoom = (structureId, sequence, exceptId, q = query) =>
  q(`update salary_rules set sequence = sequence + 1
     where salary_structure_id = $1 and sequence >= $2 and id is distinct from $3::uuid`, [structureId, sequence, exceptId || null]);
export const ruleUsage = (id) => query(`select count(*) as lines from payslip_lines where salary_rule_id = $1`, [id]).then((r) => Number(r.rows[0].lines));
export const ptSlabs = (state) =>
  query(`select * from pt_slabs ${state ? 'where lower(state) = lower($1)' : 'where true'}
         and (effective_to is null or effective_to >= current_date) order by wage_from`, state ? [state] : []).then((r) => r.rows.map((x) => mapKeys(x, ['wage_from', 'wage_to', 'monthly_amount'])));
export const createPtSlab = (d) =>
  query(`insert into pt_slabs (state, wage_from, wage_to, monthly_amount, effective_from, effective_to)
         values ($1::text,$2::numeric,$3::numeric,$4::numeric,coalesce($5::date,'2026-04-01'),$6::date) returning *`,
    [d.state || 'Gujarat', d.wage_from ?? 0, d.wage_to ?? null, d.monthly_amount, d.effective_from, d.effective_to || null]).then((r) => r.rows[0]);
export const deletePtSlab = (id) => query(`delete from pt_slabs where id = $1 returning id`, [id]).then((r) => r.rows[0] || null);
/** Which employees would be affected by a structure change — shown before you save. */
export const structureImpact = (structureId) =>
  query(`select count(distinct c.employee_id) as employees, coalesce(sum(c.wage),0) as monthly_wage,
                count(distinct p.id) as payruns
         from contracts c
         left join payruns p on p.salary_structure_id = c.salary_structure_id and p.status <> 'PAID'
         where c.salary_structure_id = $1 and c.status = 'RUNNING'`, [structureId]).then((r) => mapKeys(r.rows[0], ['employees', 'monthly_wage', 'payruns']));
