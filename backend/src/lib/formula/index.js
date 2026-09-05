import { parse, refs, FormulaError } from './parse.js';
import { evaluate, DEFAULT_ALLOW } from './eval.js';

export { FormulaError, DEFAULT_ALLOW, refs };

/** Parse + static checks only (no evaluation). Used by the rule validator on save. */
export function compile(text, { allow = DEFAULT_ALLOW } = {}) {
  const ast = parse(text);
  const nodes = count(ast);
  if (nodes > 400) throw new FormulaError(`Formula is too long (${nodes} nodes, max 400)`);
  const used = [...refs(ast)];
  const bad = used.filter((r) => !allow.includes(r.split('.')[0]) && !allow.includes(r));
  if (bad.length) throw new FormulaError(`Unknown field(s): ${bad.join(', ')}. Allowed: ${allow.join(', ')}`, { index: 0 });
  return { ast, used, nodes };
}
/** Evaluate a compiled (or raw) formula in paise-safe numbers, rounded to whole paise. */
export function run(textOrCompiled, ctx, { allow = DEFAULT_ALLOW, roundTo = 2 } = {}) {
  const c = typeof textOrCompiled === 'string' ? compile(textOrCompiled, { allow }) : textOrCompiled;
  const v = evaluate(c.ast, ctx, allow);
  const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
  if (!Number.isFinite(n)) throw new FormulaError('Result is not a finite number');
  const f = 10 ** roundTo;
  return Math.sign(n) * Math.round(Math.abs(n) * f) / f;
}
function count(node) {
  if (!node || typeof node !== 'object') return 0;
  let n = 1;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) n += v.reduce((a, x) => a + count(x), 0);
    else if (v && typeof v === 'object' && k !== 'i') n += count(v);
  }
  return n;
}
/** Human-readable explanation of what a formula does (shown next to the rule). */
export function explain(text) {
  try {
    const c = compile(text);
    const fields = c.used.filter((u) => !['result'].includes(u));
    return { ok: true, nodes: c.nodes, fields, summary: `Uses ${fields.length ? fields.join(', ') : 'constants only'}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
