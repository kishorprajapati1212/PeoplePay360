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

export function Input({ type = 'text', value, onChange, className = '', ...rest }) {
  return <input className={'input ' + className} type={type} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...rest} />;
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
export function Select({ value, onChange, options = [], placeholder, className = '', disabled }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [box, setBox] = useState({});
  const button = useRef(null);

  const items = useMemo(() => options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) })), [options]);
  const chosen = items.find((o) => String(o.value) === String(value ?? ''));
  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? items.filter((o) => (o.label || '').toLowerCase().includes(t)) : items;
  }, [items, term]);

  /** Height of the list itself: nine rows, or fewer when there are fewer options. */
  const listHeight = Math.min(items.length + (placeholder ? 1 : 0), 9) * 34 + 8;
  function place() {
    const r = button.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    setBox({ left: r.left, width: Math.max(r.width, 240),
             ...(below < listHeight + 60 && r.top > below ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
  }
  useEffect(() => {
    if (!open) return;
    place();
    const close = (e) => { if (!e.target.closest('[data-pop]')) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    const shrink = () => setOpen(false);   // scrolling anything (the dialog body, the page) would leave it behind
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', shrink);
    window.addEventListener('scroll', shrink, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', shrink);
      window.removeEventListener('scroll', shrink, true);
    };
  }, [open, items.length]);

  return (
    <>
      <button type="button" data-pop ref={button} disabled={disabled}
              className={'input flex items-center justify-between gap-2 text-left ' + className}
              onClick={() => { setOpen((v) => !v); setTerm(''); }}>
        <span className={chosen ? 'text-slate-100' : 'text-slate-500'}>{chosen ? chosen.label : (placeholder || 'Choose…')}</span>
        <span className="text-xs text-slate-500">{open ? '▲' : '▼'}</span>
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
            {shown.map((o) => (
              <button key={String(o.value)} type="button"
                      className={'block w-full px-3 py-1.5 text-left text-sm hover:bg-ink-800 '
                                 + (String(o.value) === String(value ?? '') ? 'text-brand-300' : 'text-slate-200')}
                      onClick={() => { onChange?.(o.value); setOpen(false); }}>
                {o.label}
                {o.hint && <span className="ml-2 text-xs text-slate-500">{o.hint}</span>}
              </button>
            ))}
            {!shown.length && <p className="px-3 py-2 text-sm text-slate-500">Nothing matches “{term}”.</p>}
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

export function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }) {
  return (
    <div className={'relative ' + className}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">⌕</span>
      <input className="input pl-8" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange?.(e.target.value)} />
    </div>
  );
}
