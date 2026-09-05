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
  if (err?.code === '23503') return new AppError('REFERENCE_MISSING', 'A linked record does not exist or is in use', { status: 409 });
  if (err?.code === '23514') return new AppError('CHECK_VIOLATION', friendlyCheck(m), { status: 422 });
  if (m.includes('DUPLICATE_PERIOD')) return new AppError('DUPLICATE_PERIOD', m.replace(/^DUPLICATE_PERIOD:\s*/, ''), { status: 409 });
  if (m.includes('PAID')) return new AppError('LOCKED', m, { status: 409 });
  if (m.includes('Overlapping time off')) return new AppError('OVERLAPPING_REQUEST', m, { status: 400 });
  if (m.includes('Insufficient leave')) return new AppError('INSUFFICIENT_BALANCE', m, { status: 400 });
  return null;
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
