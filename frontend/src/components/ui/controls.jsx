/** Every form control in the app is one of these five, so spacing never has to be repeated in pages. */
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

/** `options` accepts ['A','B'] or [{ value, label }] — pages should not have to normalise. */
export function Select({ value, onChange, options = [], placeholder, className = '', ...rest }) {
  const items = options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
  return (
    <select className={'input ' + className} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...rest}>
      {placeholder && <option value="">{placeholder}</option>}
      {items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
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
