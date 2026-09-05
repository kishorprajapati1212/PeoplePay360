/** Application error carrying an HTTP status + a machine code the frontend can switch on. */
export class AppError extends Error {
  constructor(code, message, { status = 400, details, retryable = false, cause } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
  static badRequest(m, o = {}) { return new AppError(o.code || 'VALIDATION_ERROR', m, { status: 400, ...o }); }
  static unauthorized(m = 'Authentication required') { return new AppError('UNAUTHORIZED', m, { status: 401 }); }
  static forbidden(m = 'You do not have access to this action') { return new AppError('FORBIDDEN', m, { status: 403 }); }
  static notFound(m = 'Resource not found') { return new AppError('NOT_FOUND', m, { status: 404 }); }
  static conflict(m, o = {}) { return new AppError(o.code || 'CONFLICT', m, { status: 409, ...o }); }
  static locked(m = 'This record is locked') { return new AppError('LOCKED', m, { status: 409 }); }
  static unprocessable(m, o = {}) { return new AppError(o.code || 'UNPROCESSABLE', m, { status: 422, ...o }); }
}
/** Translate Postgres errors into friendly AppErrors (so the UI never sees raw SQL). */
export function mapDbError(err) {
  const m = String(err?.message || '');
  if (err?.code === '23505') return new AppError('DUPLICATE', friendlyUnique(err.constraint, m), { status: 409 });
  if (err?.code === '23503') {
    const why = friendlyReference(err);
    return new AppError('REFERENCE_MISSING', why.message, { status: 409, details: { referenced_by: why.table, constraint: err.constraint || null, ...why.details } });
  }
  if (err?.code === '23514') return new AppError('CHECK_VIOLATION', friendlyCheck(m), { status: 422 });
  if (m.includes('DUPLICATE_PERIOD')) return new AppError('DUPLICATE_PERIOD', m.replace(/^DUPLICATE_PERIOD:\s*/, ''), { status: 409 });
  if (m.includes('PAID')) return new AppError('LOCKED', m, { status: 409 });
  if (m.includes('Overlapping time off')) return new AppError('OVERLAPPING_REQUEST', m, { status: 400 });
  if (m.includes('Insufficient leave')) return new AppError('INSUFFICIENT_BALANCE', m, { status: 400 });
  return null;
}
/**
 * Postgres tells us exactly which table is holding the row: its 23503 detail reads
 *   Key (id)=(7) is still referenced from table "employees".
 * That is the sentence the user deserves when a Delete button is refused, so it is translated rather than
 * swallowed by a generic "a linked record is in use". `still referenced` is the delete case; the other
 * shape is a write pointing at something that does not exist, and says so.
 */
function friendlyReference(err) {
  const detail = String(err?.detail || '');
  const from = /is still referenced from table "([\w]+)"/.exec(detail);
  const key = /Key \(([^)]+)\)=\(([^)]*)\)/.exec(detail);
  if (from) {
    const who = humanTable(from[1]);
    return {
      table: from[1],
      message: `This row is still used by ${who}, so deleting it would leave ${who} pointing at nothing. Deactivate it instead — it stops being offered everywhere and the history stays intact.`,
      details: { holding_key: key ? key[1] : null, holding_value: key ? key[2] : null, can_deactivate: true },
    };
  }
  const into = /on table "([\w]+)"/.exec(String(err?.message || ''));
  return {
    table: into?.[1] || null,
    message: into
      ? `A ${humanTable(into[1])} record you picked does not exist any more — someone else changed it first. Reload the list and choose again.`
      : 'A linked record does not exist or is still in use',
    details: {},
  };
}
/** employees → "employee records", payruns → "pay run records": enough to read as a person wrote it. */
function humanTable(t = '') {
  const words = String(t).replace(/_logs?$/, ' log').split('_').filter(Boolean);
  const last = words[words.length - 1] || '';
  const singular = last.endsWith('ies') ? last.slice(0, -3) + 'y' : last.endsWith('ses') ? last.slice(0, -2) : last.endsWith('s') ? last.slice(0, -1) : last;
  words[words.length - 1] = singular;
  return words.join(' ').replace(/\b\w/g, (c) => c.toUpperCase()) + ' rows';
}
function friendlyUnique(c = '', m = '') {
  if (c.includes('uq_contract_one_running')) return 'This employee already has a Running contract for the period';
  if (c.includes('uq_payslip_one_per_kind')) return 'A payslip for this employee and period already exists';
  if (c.includes('uq_payruns_')) return 'A Payrun with this name/period already exists for the structure';
  if (c.includes('work_email') || c.includes('users_work_email')) return 'That work email is already in use';
  if (c.includes('attendance_employee_id_day')) return 'Attendance for this employee and date already exists';
  if (c.includes('contract_period') || c.includes('uq_contract')) return 'This employee already has a contract covering those dates — change the period, or edit the existing contract';
  if (c.includes('employee_documents') && c.includes('file_name')) return 'This employee already has a file with that name — pick another name to keep both, or replace the existing one';
  if (c.includes('employee_bank_accounts')) return 'That bank account is already saved for this employee';
  if (c.includes('users_work_email') || c === 'work_email') return 'That work email already has a login';
  if (c.includes('employee_code')) return 'That employee code is already taken — leave it blank and the next free one is used';
  if (c.includes('time_off_type')) return 'A leave type with that code or name already exists';
  if (c.includes('salary_rules')) return 'This structure already has a rule with that code or name';
  if (c.includes('pkey') || c.includes('_id_key')) return 'That record already exists';
  if (c.includes('task_queue_dedupe_key')) return 'This job is already queued';
  if (c.includes('uq_contract_one_primary')) return 'Only one primary contract is allowed per employee';
  // Postgres' own wording is for the developer, not the user: it is kept in `details` (see the mapper
  // below) and the screen gets one plain sentence instead of a DETAIL line.
  return 'That value is already used by another record — check for a duplicate before saving again.';
}
function friendlyCheck(m) {
  if (m.includes('ck_alloc_never_negative')) return 'Leave balance would go negative';
  if (m.includes('ck_alloc_math')) return 'Allocation balance is inconsistent';
  if (m.includes('ck_emp_dates') || m.includes('ck_contract_dates') || m.includes('ck_payslip_period')) return 'End date must be on or after the start date';
  return m.split('\n')[0] || 'Invalid value';
}
