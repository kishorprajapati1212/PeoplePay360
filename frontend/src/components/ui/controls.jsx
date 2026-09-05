import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Every form control in the app is one of these six, so spacing and error text never have to be repeated
 * in a page. `Field` owns the label + hint + error line; the rest are the inputs themselves.
 */
export function Field({ label, hint, error, required, children, className = '' }) {
  return (
    <label className={'block ' + className}>
      <span className="label">
        {label}
        {required && <span className="ml-1 text-brand-300">*</span>}
      </span>
      <div className="mt-1.5">{children}</div>
      {error && <span className="mt-1 block text-xs text-red-300">{error}</span>}
      {!error && hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/**
 * A controlled text/number box. Everything else (`placeholder`, `min`, `max`, `step`, `maxLength`,
 * `inputMode`) goes straight to the element, so the browser's own limits apply while you type — the server
 * checks again and remains the one that decides.
 * `suffix` paints the unit inside the box (₹, %, hours) so a bare number is never a mystery.
 */
export function Input({ type = 'text', value, onChange, className = '', suffix, ...rest }) {
  const box = <input className={'input ' + className} type={type} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...rest} />;
  if (!suffix) return box;
  return (
    <span className="relative block">
      {box}
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">{suffix}</span>
    </span>
  );
}

export function Textarea({ value, onChange, rows = 3, ...rest }) {
  return <textarea className="input" rows={rows} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...rest} />;
}

/**
 * A dropdown that behaves like the rest of the app instead of the operating system: a filter box plus a
 * scrollable list, so a 200-employee picker can actually be searched. The list is painted into
 * document.body and flipped upwards when it would fall off the bottom of the screen, which is what keeps a
 * long list inside a scrolling dialog from being cut off.
 *
 * `options` accepts ['A','B'] or [{ value, label, hint }] — pages should not have to normalise.
 */
/**
 * A picker that can say why it has nothing to offer. options/loading/emptyText/error are worth passing:
 * a bare empty box reads as a broken control (it was, for the leave-type picker), while "No leave types
 * are switched on yet" reads as a task.
 */
export function Select({ value, onChange, options = [], placeholder, className = '', disabled, loading, emptyText, error, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [box, setBox] = useState({});
  const [hi, setHi] = useState(-1);
  const button = useRef(null);

  const items = useMemo(() => options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) })), [options]);
  const chosen = items.find((o) => String(o.value) === String(value ?? ''));
  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? items.filter((o) => (o.label || '').toLowerCase().includes(t)) : items;
  }, [items, term]);

  // Nine rows maximum, and at least two so an empty/error panel is not a 34px sliver.
  const listHeight = Math.max(2, Math.min(items.length + (placeholder ? 1 : 0), 9)) * 34 + 8;
  function place() {
    const r = button.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    // keep the box inside the window: a picker near the right edge would otherwise hang off-screen
    const width = Math.min(Math.max(r.width, 240), window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setBox({ left, width,
             ...(below < listHeight + 60 && r.top > below ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
  }
  useEffect(() => {
    if (!open) return;
    place();
    const close = (e) => { if (!e.target.closest('[data-pop]')) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    // Keep the list attached while the dialog body scrolls. Closing on scroll used to make the picker
    // vanish under a cursor that was only trying to reach the fifth option.
    const move = () => place();
    const nav = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = shown.length;
        if (!n) return;
        setHi((i) => (e.key === 'ArrowDown' ? (i + 1 + n) % n : (i - 1 + n) % n));
      } else if (e.key === 'Enter' && hi >= 0 && shown[hi]) {
        e.preventDefault();
        onChange?.(shown[hi].value); setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    document.addEventListener('keydown', nav);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', move, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
      document.removeEventListener('keydown', nav);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', move, true);
    };
  }, [open, items.length, hi, shown]);

  return (
    <>
      <button type="button" data-pop ref={button} disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
              title={error ? 'Could not load the choices: ' + error : undefined}
              className={'input flex items-center justify-between gap-2 text-left ' + (error ? 'border-red-500/50 ' : '') + className}
              onClick={() => { setOpen((v) => !v); setTerm(''); setHi(-1); }}>
        <span className={chosen ? 'text-slate-100' : error ? 'text-red-300' : !items.length && !loading ? 'text-amber-300' : 'text-slate-500'}>
          {error ? 'Choices failed to load'
           : loading ? 'Loading choices…'
           : chosen ? chosen.label
           : items.length ? (placeholder || 'Choose…')
           : (emptyText || 'Nothing to choose yet')}
        </span>
        {/* A triangle drawn here, not a  glyph from the font: text characters of that shape differ in
           size and baseline between fonts, and swapping ▲ for ▼ moved the label by a pixel every time the
           picker opened — the artifact. Same box, same height, currentColor either way. */}
        <span className="grid h-3.5 w-3.5 shrink-0 place-items-center text-slate-500" aria-hidden="true">
          {loading
            ? <span className="text-[10px] leading-none">…</span>
            : <svg viewBox="0 0 12 7" className="h-[7px] w-3" fill="none" stroke="currentColor" strokeWidth="1.6"
                   strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}>
                <path d="M1 1.5L6 6L11 1.5" />
              </svg>}
        </span>
      </button>
      {open && createPortal(
        <div data-pop className="fixed z-[100] rounded-lg border border-line bg-ink-900 shadow-panel" style={box}>
          {items.length > 7 && (
            <input autoFocus className="m-2 w-[calc(100%-1rem)] rounded-md border border-line bg-ink-850 px-2 py-1 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                   placeholder="Type to filter…" value={term} onChange={(e) => setTerm(e.target.value)} />
          )}
          <div className="overflow-y-auto py-1" style={{ maxHeight: listHeight }} >
            {placeholder && (
              <button type="button" className="block w-full px-3 py-1.5 text-left text-sm text-slate-400 hover:bg-ink-800"
                      onClick={() => { onChange?.(''); setOpen(false); }}>{placeholder}</button>
            )}
            {shown.map((o, oi) => (
              <button key={String(o.value)} type="button" role="option" aria-selected={String(o.value) === String(value ?? '')}
                      className={'block w-full px-3 py-1.5 text-left text-sm hover:bg-ink-800 '
                                 + (oi === hi ? 'bg-ink-800 ' : '')
                                 + (String(o.value) === String(value ?? '') ? 'text-brand-300' : 'text-slate-200')}
                      onClick={() => { onChange?.(o.value); setOpen(false); }}>
                {o.label}
                {o.hint && <span className="ml-2 text-xs text-slate-500">{o.hint}</span>}
              </button>
            ))}
            {!shown.length && (
              <p className="px-3 py-2 text-sm text-slate-500">
                {items.length ? `Nothing matches “${term}”.`
                 : error ? <span className="text-red-300">{String(error).slice(0, 160)}</span>
                 : (emptyText || 'Nothing to choose yet.')}
              </p>
            )}
          </div>
        </div>, document.body)}
    </>
  );
}

export function Checkbox({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={!!checked} onChange={(e) => onChange?.(e.target.checked)} />
      <span>
        <span className="text-slate-200">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * The search box in a table toolbar. It sizes itself (full width on a phone, 14rem from `sm` upwards) so no
 * page has to pass a width and a long placeholder cannot push a filter out of the row.
 */
export function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }) {
  return (
    <div className={'relative w-full min-w-0 sm:w-56 ' + className}>
      <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">⌕</span>
      <input className="input w-full pl-8" type="search" value={value ?? ''} placeholder={placeholder}
             aria-label={placeholder.replace('…', '')} onChange={(e) => onChange?.(e.target.value)} />
    </div>
  );
}
