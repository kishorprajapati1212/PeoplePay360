import { human } from '../../utils/format.js';

const TONES = {
  // green
  ACTIVE: 'good', PAID: 'good', SENT: 'good', APPROVED: 'good', COMPLETED: 'good', VALIDATED: 'good', CURRENT: 'good', LOCKED: 'info',
  // amber
  DRAFT: 'warn', COMPUTED: 'warn', PENDING: 'warn', QUEUED: 'warn', PROCESSING: 'warn', PART_DAY: 'warn', HALF_DAY: 'warn', ON_LEAVE: 'warn', REQUESTED: 'warn',
  // red
  FAILED: 'bad', DEAD: 'bad', REFUSED: 'bad', CANCELLED: 'bad', TERMINATED: 'bad', INACTIVE: 'muted', VOID: 'muted', BOUNCED: 'bad', ABSENT: 'bad', LATE: 'bad', EXPIRED: 'muted',
};
const STYLES = {
  good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  bad: 'border-red-500/30 bg-red-500/10 text-red-300',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  muted: 'border-line bg-ink-800 text-slate-400',
};

export function StatusChip({ value, label, tone }) {
  const key = String(value || '').toUpperCase();
  const style = STYLES[tone || TONES[key] || 'muted'];
  return (
    <span className={'chip ' + style}>
      {/* a dot the same colour as the text: the shape carries the state even in peripheral vision */}
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {label || human(value)}
    </span>
  );
}
