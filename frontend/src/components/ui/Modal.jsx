import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/** Dialog used by every create/edit form and every confirm step in the app. */
export function Modal({ open, title, subtitle, onClose, children, footer, width = 'max-w-2xl' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  // A portal, not a nested div: dialogs are opened from inside the sticky top bar and from table rows,
  // and any of those ancestors has its own stacking context (z-20) — which is exactly why the dialog
  // used to render underneath the page. Body-level children cannot be trapped like that.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-4 py-10 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={'panel my-4 w-full ' + width} style={{ animation: 'rise-in .18s ease-out' }}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-100">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          <button className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-ink-800 hover:text-slate-200" onClick={() => onClose?.()} aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
