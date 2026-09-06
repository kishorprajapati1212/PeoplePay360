/** Display metadata for every status pill in the app (the mockup's red/green/grey badges). */
export const STATUS_TONE = {
  ACTIVE: 'ok', PRESENT: 'ok', APPROVED: 'ok', PAID: 'ok', RUNNING: 'ok', VALIDATED: 'ok', SENT: 'ok', COMPLETED: 'ok', SUCCESS: 'ok', OPEN: 'muted',
  ON_LEAVE: 'info', TO_APPROVE: 'warn', COMPUTED: 'info', PENDING: 'warn', QUEUED: 'warn', DRAFT: 'muted', INVITED: 'info',
  ABSENT: 'bad', REFUSED: 'bad', FAILED: 'bad', TERMINATED: 'bad', SUSPENDED: 'bad', VOID: 'bad', CANCELLED: 'muted', LOCKED: 'muted',
  HALF_DAY: 'warn', LATE: 'warn', OVERTIME: 'info', HOLIDAY: 'info', EXPIRED: 'muted', BOUNCED: 'bad', PARTIAL: 'warn',
};
export const label = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
