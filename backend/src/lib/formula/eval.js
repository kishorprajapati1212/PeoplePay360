import { FormulaError } from './parse.js';

/** Fields a rule author may read. Anything else is refused at validation *and* at runtime. */
export const DEFAULT_ALLOW = [
  'worksheet', 'result',
  'gross', 'net', 'total_deductions',
  'wage', 'basic',
  'days', 'expected_days', 'paid_days', 'present_days', 'absent_days', 'leave_days', 'unpaid_days', 'lop_days', 'half_days',
  'period_days', 'month_days', 'worked_hours', 'scheduled_hours',
  'overtime_hours', 'overtime_earnings',
  'pf_employee', 'pf_employer', 'esi_employee', 'esi_employer',
  'pt', 'tds', 'loan_deduction', 'professional_tax',
  'allowance', 'bonus', 'arrear', 'bonus_rate',
  'attendance', 'employee', 'contract', 'timeoff', 'inputs', 'run',
];
const MAX_NODES = 400;
const MAX_DEPTH = 24;

const num = (v, what) => {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new FormulaError(`${what} is not a finite number`);
    return v;
  }
  if (v === null || v === undefined) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new FormulaError(`${what} is not numeric (“${String(v).slice(0, 24)}”)`);
  return n;
};

function lookup(node, ctx, allow, depth) {
  const base = node.obj.type === 'ref' ? node.obj.name : null;
  if (base && !allow.includes(base)) throw new FormulaError(`“${base}” cannot be read in a salary rule`, { index: node.obj.i ?? 0 });
  const keyNode = node.index;
  const key = keyNode.type === 'lit' ? keyNode.value : evaluate(keyNode, ctx, allow, depth + 1);
  if (typeof key === 'string' && key.includes('..')) throw new FormulaError('Suspicious field name');
  const src = base ? ctx[base] : evaluate(node.obj, ctx, allow, depth + 1);
  if (src === null || src === undefined) return 0;
  const value = typeof key === 'number' ? src[key] : src[String(key)];
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'object') {
    throw new FormulaError(`“${base}.${String(key)}” is not a number a formula may use`, { index: node.index.i ?? 0 });
  }
  if (value === undefined) {
    if (base === 'worksheet') return 0; // a rule not present yet evaluates to 0 (Odoo-ish behaviour)
    throw new FormulaError(`“${base}.${String(key)}” is not available while computing this rule`, { index: node.index.i ?? 0 });
  }
  return value;
}

export function evaluate(ast, ctx = {}, allow = DEFAULT_ALLOW, depth = 0) {
  if (depth > MAX_DEPTH) throw new FormulaError('Formula is nested too deeply');
  switch (ast.type) {
    case 'assign': return evaluate(ast.value, ctx, allow, depth);
    case 'lit': return ast.value;
    case 'group': return evaluate(ast.expr, ctx, allow, depth + 1);
    case 'ref': {
      if (!allow.includes(ast.name)) throw new FormulaError(`“${ast.name}” cannot be read in a salary rule`, { index: ast.i ?? 0 });
      if (ast.name === 'result') return ctx.result ?? 0;
      const v = ctx[ast.name];
      if (v === undefined) throw new FormulaError(`“${ast.name}” is not available while computing this rule`, { index: ast.i ?? 0 });
      return typeof v === 'number' ? v : num(v, ast.name);
    }
    case 'index': return lookup(ast, ctx, allow, depth);
    case 'unary': {
      const v = num(evaluate(ast.arg, ctx, allow, depth + 1), 'value');
      return ast.op === '-' ? -v : v;
    }
    case 'not': return !truthy(evaluate(ast.arg, ctx, allow, depth + 1)) ? 1 : 0;
    case 'binary': {
      const a = num(evaluate(ast.left, ctx, allow, depth + 1), 'left side');
      const b = num(evaluate(ast.right, ctx, allow, depth + 1), 'right side');
      switch (ast.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': if (b === 0) throw new FormulaError('Division by zero — guard it, e.g. (days > 0 ? x / days : 0)'); return a / b;
        case '%': if (b === 0) throw new FormulaError('Remainder by zero'); return a % b;
        default: throw new FormulaError(`Unsupported operator “${ast.op}”`);
      }
    }
    case 'compare': {
      const a = evaluate(ast.left, ctx, allow, depth + 1);
      const b = evaluate(ast.right, ctx, allow, depth + 1);
      const an = typeof a === 'string' || typeof b === 'string' ? null : [num(a, 'left side'), num(b, 'right side')];
      const [x, y] = an || [a, b];
      switch (ast.op) {
        case '>': return x > y ? 1 : 0;
        case '<': return x < y ? 1 : 0;
        case '>=': return x >= y ? 1 : 0;
        case '<=': return x <= y ? 1 : 0;
        case '==': return x === y ? 1 : 0;
        case '!=': return x !== y ? 1 : 0;
        default: throw new FormulaError(`Unsupported operator “${ast.op}”`);
      }
    }
    case 'and': return truthy(evaluate(ast.left, ctx, allow, depth + 1)) && truthy(evaluate(ast.right, ctx, allow, depth + 1)) ? 1 : 0;
    case 'or': return truthy(evaluate(ast.left, ctx, allow, depth + 1)) || truthy(evaluate(ast.right, ctx, allow, depth + 1)) ? 1 : 0;
    case 'ternary': return truthy(evaluate(ast.cond, ctx, allow, depth + 1)) ? evaluate(ast.then, ctx, allow, depth + 1) : evaluate(ast.else, ctx, allow, depth + 1);
    case 'call': {
      const a = ast.args.map((x) => evaluate(x, ctx, allow, depth + 1));
      switch (ast.name) {
        case 'min': return Math.min(...a.map((v) => num(v, 'min()')));
        case 'max': return Math.max(...a.map((v) => num(v, 'max()')));
        case 'abs': return Math.abs(num(a[0], 'abs()'));
        case 'floor': return Math.floor(num(a[0], 'floor()'));
        case 'ceil': return Math.ceil(num(a[0], 'ceil()'));
        case 'round': return round(num(a[0], 'round()'), a[1] === undefined ? 0 : num(a[1], 'round()'));
        case 'days_in_month': {
          const [y, m] = [num(a[0], 'days_in_month()'), a[1] === undefined ? null : num(a[1], 'days_in_month()')];
          const month = m === null ? new Date().getUTCMonth() + 1 : m;
          return new Date(Date.UTC(y, month, 0)).getUTCDate();
        }
        case 'if': return truthy(a[0]) ? a[1] : a[2];
        default: throw new FormulaError(`Unknown function “${ast.name}()”`);
      }
    }
    default: throw new FormulaError(`Unsupported node “${ast.type}”`);
  }
}
const truthy = (v) => (typeof v === 'number' ? v !== 0 : Array.isArray(v) ? v.length > 0 : !!v);
const round = (v, digits) => { const f = 10 ** digits; return Math.sign(v) * Math.round(Math.abs(v) * f) / f; };
