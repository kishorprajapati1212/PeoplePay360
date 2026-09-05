/** Display metadata for every status pill in the app (the mockup's red/green/grey badges). */
export const STATUS_TONE = {
  ACTIVE: 'ok', PRESENT: 'ok', APPROVED: 'ok', PAID: 'ok', RUNNING: 'ok', VALIDATED: 'ok', SENT: 'ok', COMPLETED: 'ok', SUCCESS: 'ok', OPEN: 'muted',
  ON_LEAVE: 'info', TO_APPROVE: 'warn', COMPUTED: 'info', PENDING: 'warn', QUEUED: 'warn', DRAFT: 'muted', INVITED: 'info',
  ABSENT: 'bad', REFUSED: 'bad', FAILED: 'bad', TERMINATED: 'bad', SUSPENDED: 'bad', VOID: 'bad', CANCELLED: 'muted', LOCKED: 'muted',
  HALF_DAY: 'warn', LATE: 'warn', OVERTIME: 'info', HOLIDAY: 'info', EXPIRED: 'muted', BOUNCED: 'bad', PARTIAL: 'warn',
};
export const tone = (s) => STATUS_TONE[s] || 'muted';
export const label = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
/** Payrun workflow steps, in order — the UI renders these as clickable actions, never a dropdown. */
export const PAYRUN_FLOW = [
  { status: 'DRAFT', next: 'COMPUTED', action: 'COMPUTE', hint: 'Run every rule for every payslip' },
  { status: 'COMPUTED', next: 'VALIDATED', action: 'VALIDATE', hint: 'Locks the numbers for approval' },
  { status: 'VALIDATED', next: 'PAID', action: 'MARK PAID', hint: 'Freezes payslips, releases PDFs' },
];
