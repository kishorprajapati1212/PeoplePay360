import { useEffect, useMemo, useState } from 'react';
import { attendance } from '../../api/endpoints.js';
import { useAction } from '../../hooks/useApi.js';
import { useToast } from '../ui/Toast.jsx';
import { time as fmtTime, date as fmtDate } from '../../utils/format.js';

/**
 * The check-in / check-out card — the employee's day at a glance.
 *
 * The button always names the NEXT punch ("Check in" when you are out, "Check out" when you are in),
 * the dot breathes while a session is open, and the hours line counts what today has earned so far:
 * closed sessions plus the open one, live. That number is the sum of the sessions, not the span from
 * the first punch, so lunch between two punches is not quietly paid as work (the API keeps the same
 * rule: attendance.worked_hours is the session sum).
 */

/** Rows from before the session list still behave: check_in/check_out read as one session. */
const sessionsOf = (row) => {
  if (!row) return [];
  const punches = Array.isArray(row.punches) && row.punches.length
    ? row.punches.filter((s) => s && s.in)
    : (row.check_in ? [{ in: row.check_in, out: row.check_out || null }] : []);
  return punches;
};
const minutesOf = (sessions, now) => {
  let mins = 0;
  for (const s of sessions) {
    const from = new Date(s.in).getTime();
    const to = s.out ? new Date(s.out).getTime() : now;
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) mins += (to - from) / 60000;
  }
  return mins;
};
const hm = (minutes) => {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

export function PunchCard({ today, onDone, dense = false }) {
  const toast = useToast();
  const { run, busy } = useAction();
  const [now, setNow] = useState(() => Date.now());

  // The clock on the wall moves even when the page does not: refresh the elapsed line every 20s.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(id);
  }, []);

  const sessions = useMemo(() => sessionsOf(today), [today]);
  const open = sessions.some((s) => !s.out);
  const workedMinutes = minutesOf(sessions, now);
  const lastIn = sessions.length ? sessions[sessions.length - 1].in : null;
  const firstIn = sessions.length ? sessions[0].in : null;
  const lastOut = [...sessions].reverse().find((s) => s.out)?.out ?? null;

  async function punch() {
    await run('clock', () => attendance.clock({}))
      .then((out) => {
        onDone?.();
        toast.success(out.action === 'IN'
          ? `Clocked in at ${fmtTime(out.at)}${sessions.length ? ' — welcome back' : ''}`
          : `Clocked out at ${fmtTime(out.at)} · ${hm(workedMinutes)} worked today`);
      })
      .catch((e) => toast.error(e.message));
  }

  return (
    <section className="panel relative overflow-hidden">
      {/* the accent field: quiet while out, a breathing gradient while a session is open */}
      <div aria-hidden className="pointer-events-none absolute inset-0 transition-opacity duration-500"
           style={{ opacity: open ? 1 : 0.35, background: 'radial-gradient(420px 180px at 88% -30%, rgb(var(--brand-500) / 0.22), transparent 70%)' }} />
      <div className={'relative flex flex-wrap items-center gap-x-6 gap-y-4 ' + (dense ? 'px-4 py-4' : 'px-5 py-5 sm:px-6')}>
        {/* state */}
        <div className="flex items-center gap-3">
          <span className={'relative grid h-2.5 w-2.5 place-items-center rounded-full ' + (open ? 'bg-good pulse-dot' : sessions.length ? 'bg-slate-500' : 'bg-slate-600')} />
          <div>
            <p className="text-sm font-semibold text-slate-100">
              {open ? 'Clocked in' : sessions.length ? 'Clocked out' : 'Not started today'}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {open
                ? <>since <span className="num text-slate-200">{fmtTime(lastIn)}</span>{sessions.length > 1 && <> · session {sessions.length}</>}</>
                : firstIn
                  ? <><span className="num text-slate-200">{fmtTime(firstIn)}</span> → <span className="num text-slate-200">{fmtTime(lastOut)}</span> · {fmtDate(today?.day)}</>
                  : 'Your first punch opens the day'}
            </p>
          </div>
        </div>

        {/* hours */}
        <div className="min-w-28">
          <p className="label">Worked today</p>
          <p className="num mt-0.5 text-2xl font-semibold tracking-tight text-slate-50">{hm(workedMinutes)}</p>
          {open && <p className="text-[11px] text-slate-500">counting — breaks between punches are not</p>}
        </div>

        {/* sessions */}
        {sessions.length > 0 && (
          <div className="hidden min-w-0 flex-1 md:block">
            <p className="label mb-1.5">Today's punches</p>
            <div className="flex flex-wrap gap-1.5">
              {sessions.map((s, i) => (
                <span key={i} className="chip border-line bg-ink-850/80 text-slate-300">
                  <span className="num">{fmtTime(s.in)}</span>
                  <span className="text-slate-600">→</span>
                  {s.out ? <span className="num">{fmtTime(s.out)}</span> : <span className="text-good">now</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* the button names the next punch, never a mystery "clock" */}
        <div className="ml-auto flex items-center gap-3">
          {(today?.net_worked_hours > 0 || today?.break_minutes > 0) && !open && (
            <span className="hidden text-xs text-slate-500 sm:inline">
              net <span className="num text-slate-300">{Number(today.net_worked_hours ?? today.worked_hours ?? 0).toFixed(2)} h</span>
              {today.break_minutes ? ` · break ${today.break_minutes}m` : ''}
            </span>
          )}
          <button className={open ? 'btn-danger btn-sm h-9 px-4' : 'btn-primary btn-sm h-9 px-4'} disabled={busy === 'clock'} onClick={punch}>
            {busy === 'clock' ? 'Saving…' : open ? 'Check out' : 'Check in'}
          </button>
        </div>
      </div>
    </section>
  );
}
