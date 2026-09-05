/**
 * Hand-written recursive-descent parser for the tiny expression language payroll rules use.
 *
 * Grammar:   expr := add ;  add := mul (('+'|'-') mul)* ;  mul := unary (('*'|'/') unary)* ;
 *            unary := ('-'|'+')? primary ;  primary := number | ref | call | '(' expr ')'
 *            ref   := IDENT [ '.' IDENT ]      e.g.  worksheet['BASIC']  or  attendance.days
 *            call  := IDENT '(' args ')'       e.g.  min(x, y)  round(x)
 *
 * Deliberately NOT eval() and not expr-eval: the reference CVE-2025-12735 (RCE in expr-eval ≤2.x)
 * and the fact that authors are non-developers who must get clear, one-line errors back.
 */
const FUNCS = new Set(['min', 'max', 'round', 'floor', 'ceil', 'abs', 'days_in_month', 'if']);
const KEYWORDS = new Set(['true', 'false', 'null', 'and', 'or', 'not', 'in', 'undefined']);
/** Words that would turn a payroll formula into a host escape hatch. Rejected by name, with a reason. */
const FORBIDDEN = new Set(['new', 'function', 'this', 'global', 'globalthis', 'process', 'require', 'import',
                           'eval', 'constructor', 'prototype', '__proto__', 'window', 'document', 'child_process',
                           'async', 'await', 'yield', 'delete', 'typeof', 'instanceof', 'void', 'throw', 'try', 'catch', 'return']);

export class FormulaError extends Error {
  constructor(message, { index = 0, snippet = '' } = {}) {
    super(`${message}${index ? ` (at ${index + 1})` : ''}${snippet ? ` — near “${snippet}”` : ''}`);
    this.name = 'FormulaError';
    this.index = index;
    this.status = 422;
  }
}

function lex(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j])) j += 1;
      const raw = src.slice(i, j).replace(/_/g, '');
      if (!/^(\d+(\.\d+)?|\.\d+)$/.test(raw)) throw new FormulaError('Numbers may only contain digits and one dot', { index: i, snippet: raw });
      out.push({ t: 'num', v: Number(raw), i });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      const lw = word.toLowerCase();
      if (FORBIDDEN.has(lw) || lw.includes('__') || lw === 'proto') throw new FormulaError(`“${word}” is not allowed in a salary formula — formulas only do arithmetic on payroll fields`, { index: i });
      if (KEYWORDS.has(lw)) { out.push({ t: 'kw', v: lw, i }); i = j; continue; }
      out.push({ t: 'ident', v: word, i });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c; let j = i + 1; let s = '';
      while (j < src.length && src[j] !== q) { s += src[j]; j += 1; }
      if (j >= src.length) throw new FormulaError('Unterminated string', { index: i, snippet: src.slice(i) });
      out.push({ t: 'str', v: s, i });
      i = j + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['>=', '<=', '==', '!='].includes(two)) { out.push({ t: 'op', v: two, i }); i += 2; continue; }
    if ('+-*/()[],<>?:=%!.'.includes(c)) { out.push({ t: 'op', v: c, i }); i += 1; continue; }
    throw new FormulaError(`“${c}” is not allowed here`, { index: i });
  }
  out.push({ t: 'eof', i: src.length });
  return out;
}

export function parse(src) {
  const text = String(src ?? '');
  if (!text.trim()) throw new FormulaError('Formula is empty');
  const t = lex(text);
  let p = 0;
  const peek = () => t[p];
  const eat = (v) => {
    const tok = t[p];
    if (tok.t === 'op' && tok.v === v) { p += 1; return tok; }
    return null;
  };
  const expectOp = (v, what) => {
    const tok = eat(v);
    if (!tok) throw new FormulaError(`Expected ${what || `“${v}”`}`, { index: t[p].i, snippet: text.slice(t[p].i, t[p].i + 12) });
    return tok;
  };

  function assignment() {
    // `result := expr` / `result = expr` / bare expr  — all mean "the rule's amount"
    if (t[p].t === 'ident' && t[p].v.toLowerCase() === 'result' && (t[p + 1]?.v === '=' || (t[p + 1]?.v === ':' && t[p + 2]?.v === '='))) {
      p += t[p + 1].v === '=' ? 2 : 3;
      const node = ternary();
      return { type: 'assign', name: 'result', value: node };
    }
    return ternary();
  }
  function ternary() {
    const cond = orExpr();
    if (eat('?')) {
      const a = ternary();
      expectOp(':', '“:” in the ternary');
      const b = ternary();
      return { type: 'ternary', cond, then: a, else: b };
    }
    return cond;
  }
  function orExpr() {
    let left = andExpr();
    while (peek().t === 'kw' && (peek().v === 'or' || peek().v === '||')) { p += 1; left = { type: 'or', left, right: andExpr() }; }
    return left;
  }
  function andExpr() {
    let left = comparison();
    while (peek().t === 'kw' && (peek().v === 'and' || peek().v === '&&')) { p += 1; left = { type: 'and', left, right: comparison() }; }
    return left;
  }
  function comparison() {
    let left = add();
    while (peek().t === 'op' && ['>', '<', '>=', '<=', '==', '!='].includes(peek().v)) {
      const op = t[p].v; p += 1;
      left = { type: 'compare', op, left, right: add() };
    }
    return left;
  }
  function add() {
    let left = mul();
    while (peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = t[p].v; p += 1;
      left = { type: 'binary', op, left, right: mul() };
    }
    return left;
  }
  function mul() {
    let left = unary();
    while (peek().t === 'op' && (peek().v === '*' || peek().v === '/' || peek().v === '%')) {
      const op = t[p].v; p += 1;
      left = { type: 'binary', op, left, right: unary() };
    }
    return left;
  }
  function unary() {
    if (peek().t === 'op' && (peek().v === '-' || peek().v === '+')) {
      const op = t[p].v; p += 1;
      return { type: 'unary', op, arg: unary() };
    }
    if (peek().t === 'kw' && peek().v === 'not') { p += 1; return { type: 'not', arg: unary() }; }
    return postfix();
  }
  function postfix() {
    let node = primary();
    for (;;) {
      if (eat('[')) {
        const idx = ternary();
        expectOp(']', '“]”');
        node = { type: 'index', obj: node, index: idx };
        continue;
      }
      if (peek().t === 'op' && peek().v === '.') {
        p += 1;
        const name = t[p];
        if (name.t !== 'ident') throw new FormulaError('Field name expected after “.”', { index: name.i });
        p += 1;
        node = { type: 'index', obj: node, index: { type: 'lit', value: name.v } };
        continue;
      }
      return node;
    }
  }
  function primary() {
    const tok = peek();
    if (tok.t === 'num') { p += 1; return { type: 'lit', value: tok.v }; }
    if (tok.t === 'str') { p += 1; return { type: 'lit', value: tok.v }; }
    if (tok.t === 'kw' && (tok.v === 'true' || tok.v === 'false')) { p += 1; return { type: 'lit', value: tok.v === 'true' }; }
    if (tok.t === 'op' && tok.v === '(') {
      p += 1;
      const e = ternary();
      expectOp(')', 'a closing “)”');
      return { type: 'group', expr: e };
    }
    if (tok.t === 'ident') {
      p += 1;
      if (peek().t === 'op' && peek().v === '(') {
        p += 1;
        if (!FUNCS.has(tok.v)) throw new FormulaError(`Unknown function “${tok.v}()”. Allowed: ${[...FUNCS].join(', ')}`, { index: tok.i });
        const args = [];
        if (!(peek().t === 'op' && peek().v === ')')) {
          for (;;) {
            args.push(ternary());
            if (!eat(',')) break;
          }
        }
        expectOp(')', 'a closing “)”');
        const arity = { min: [2, 40], max: [2, 40], round: [1, 2], floor: [1, 1], ceil: [1, 1], abs: [1, 1], days_in_month: [1, 1], if: [3, 3] }[tok.v];
        if (args.length < arity[0] || args.length > arity[1]) {
          throw new FormulaError(`${tok.v}() takes ${arity[0] === arity[1] ? arity[0] : `${arity[0]}–${arity[1]}`} argument(s), got ${args.length}`, { index: tok.i });
        }
        return { type: 'call', name: tok.v, args };
      }
      return { type: 'ref', name: tok.v };
    }
    throw new FormulaError('Unexpected end of formula', { index: tok.i, snippet: text.slice(Math.max(0, tok.i - 8), tok.i + 8) });
  }

  const ast = assignment();
  if (peek().t !== 'eof') throw new FormulaError(`Nothing expected after “${text.slice(peek().i, peek().i + 10)}”`, { index: peek().i });
  return ast;
}

/** All identifiers referenced — the API uses this to whitelist fields before evaluating. */
export function refs(ast, acc = new Set()) {
  if (!ast || typeof ast !== 'object') return acc;
  if (ast.type === 'ref') acc.add(ast.name);
  if (ast.type === 'index' && ast.index.type === 'lit' && typeof ast.index.value === 'string') acc.add(`${ast.obj.name ?? ''}.${ast.index.value}`.replace(/^\./, ''));
  for (const k of ['value', 'arg', 'args', 'left', 'right', 'cond', 'then', 'else', 'expr', 'obj', 'index']) {
    const v = ast[k];
    if (Array.isArray(v)) v.forEach((x) => refs(x, acc));
    else if (v && typeof v === 'object') refs(v, acc);
  }
  return acc;
}
