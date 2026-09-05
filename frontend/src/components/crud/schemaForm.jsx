import { Field, Input, Select, Textarea, Checkbox } from '../ui/controls.jsx';

/**
 * A field descriptor is all a CRUD form needs:
 *   { key, label, type, required, hint, options, min, max, step, colSpan, readOnly, maxLength }
 * type ∈ text | phone | number | money | date | month | select | textarea | checkbox | static
 *
 * `errors` is the map the API sent back ({ 'work_email': 'That work email is already in use' }), so a
 * refused save tells you which box to fix instead of only flashing a toast.
 */
export function SchemaForm({ fields, values, onChange, errors = {}, layout = 'grid' }) {
  const cls = layout === 'grid' ? 'grid gap-4 sm:grid-cols-2' : 'flex flex-col gap-4';
  return (
    <div className={cls}>
      {fields.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint} error={errors[f.key]} required={f.required}
               className={f.colSpan === 2 || f.type === 'textarea' ? 'sm:col-span-2' : ''}>
          <FieldControl field={f} value={values[f.key]} onChange={(v) => onChange(f.key, v)} errors={errors} />
        </Field>
      ))}
    </div>
  );
}

function FieldControl({ field, value, onChange }) {
  if (field.readOnly) return <div className="rounded-lg border border-line bg-ink-850 px-3 py-2 text-sm text-slate-300">{display(value)}</div>;
  switch (field.type) {
    case 'phone':
      // Ten digits, nothing else — the same cleaning the API applies (see mobile/tenDigits in
      // backend/src/validators/common.js), so what you see in the box is what gets stored.
      return <Input inputMode="numeric" placeholder="10-digit mobile number"
                    value={mobileDigits(value)} onChange={(v) => onChange(mobileDigits(v))} />;
    case 'number':
    case 'money':
      return <Input type="number" step={field.step ?? (field.type === 'money' ? '0.01' : '1')} min={field.min} max={field.max}
                    value={value} onChange={onChange} placeholder={field.placeholder} />;
    case 'date':
      return <Input type="date" value={value} onChange={onChange} />;
    case 'month':
      return <Input type="month" value={value} onChange={onChange} />;
    case 'select':
      return <Select value={value} onChange={onChange} options={field.options || []} placeholder={field.placeholder || 'Choose…'} />;
    case 'textarea':
      return <Textarea value={value} onChange={onChange} rows={field.rows || 3} placeholder={field.placeholder} />;
    case 'checkbox':
      return <Checkbox checked={value} onChange={onChange} label={field.checkboxLabel || field.label} hint={field.checkboxHint} />;
    case 'static':
      return <div className="text-sm text-slate-300">{display(value)}</div>;
    default:
      return <Input value={value} onChange={onChange} placeholder={field.placeholder} />;
  }
}

/** Keep digits only, and drop a country code someone pasted: 098200 00001 and +91-98200-00001 are one number. */
const mobileDigits = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 12 && d.startsWith('91') ? d.slice(2) : d;
};

function display(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

/** Blank form values from a schema, so a create dialog never has to list defaults by hand. */
export function emptyValues(fields, extra = {}) {
  const out = { ...extra };
  for (const f of fields) out[f.key] = f.default ?? (f.type === 'checkbox' ? false : '');
  return out;
}
export function valuesFromRow(fields, row, extra = {}) {
  const out = { ...extra };
  for (const f of fields) {
    const raw = row?.[f.key];
    out[f.key] = raw === null || raw === undefined ? (f.default ?? (f.type === 'checkbox' ? false : ''))
      : f.type === 'date' ? String(raw).slice(0, 10)
      : f.type === 'checkbox' ? !!raw
      : raw;
  }
  return out;
}
