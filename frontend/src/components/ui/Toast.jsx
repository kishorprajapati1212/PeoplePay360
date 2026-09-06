import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/** Minimal toast system: `const toast = useToast(); toast.success('Payslip queued'); */
const ToastContext = createContext(null);
let counter = 0;

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((kind, message, ms = 4200) => {
    const id = ++counter;
    setItems((list) => [...list, { id, kind, message }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), ms);
  }, []);
  const value = useMemo(() => ({
    success: (m) => push('success', m),
    error: (m) => push('error', m, 7000),
    info: (m) => push('info', m),
    dismiss: (id) => setItems((list) => list.filter((t) => t.id !== id)),
  }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div key={t.id}
               className={'pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-panel backdrop-blur ' + (t.kind === 'error' ? 'border-bad/40 bg-red-950/80 text-red-200'
                   : t.kind === 'success' ? 'border-good/40 bg-emerald-950/80 text-emerald-200'
                   : 'border-line bg-ink-850/90 text-slate-200')}
               style={{ animation: 'toast-in .18s ease-out' }}>
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  useEffect(() => { if (!ctx) throw new Error('useToast needs <ToastProvider>'); }, [ctx]);
  return ctx;
}
