import { Field, Input, Select, Textarea, Checkbox } from '../ui/controls.jsx';

/**
 * The formats a payroll record is checked against — kept in one table so the placeholder, the
 * cleaning while you type and the wording of the complaint are the same everywhere they appear.
 * A field declares `pattern: 'ifsc'`; the box then upper-cases itself, and an invalid value is named
 * before the request is sent instead of arriving back as a 400 toast.
 *
 * These mirror the server's own normalisation (backend/src/validators/common.js) and are deliberately
 * only as strict as it is: a blank value is never a problem here, because "unset" is legal in a PATCH.
 */
const digits = (max) => (v) => String(v ?? '').replace(/[^0-9]/g, '').slice(0, max);
const upper = (max) => (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max);
export const PATTERNS = {
  bank_account: { re: /^[0-9]{6,18}$/, clean: digits(18), placeholder: '50100123456789', hint: '6 to 18 digits — no spaces, no hyphens' },
  ifsc: { re: /^[A-Z]{4}0[A-Z0-9]{6}$/, clean: upper(11), placeholder: 'HDFC0001234', hint: '4 letters, then 0, then 6 characters — the code printed on the cheque leaf' },
  pan: { re: /^[A-Z]{5}[0-9]{4}[A-Z]$/, clean: upper(10), placeholder: 'ABCDE1234F', hint: '5 letters, 4 digits, 1 letter — as on the card' },
  uan: { re: /^[0-9]{12}$/, clean: digits(12), placeholder: '100200300405', hint: '12 digits from the PF passbook' },
  esic: { re: /^[0-9]{17}$/, clean: digits(17), placeholder: '99123456780000001', hint: '17-digit ESIC IP number' },
  aadhaar: { re: /^[0-9]{12}$/, clean: digits(12), placeholder: '123412341234', hint: '12 digits, stored without spaces' },
  pincode: { re: /^[1-9][0-9]{5}$/, clean: digits(6), placeholder: '380015', hint: '6 digits, not starting with 0' },
  phone: { re: /^[6-9][0-9]{9}$/, clean: digits(10), placeholder: '9825012345', hint: '10 digits, starting 6-9' },
  hex_color: { re: /^#[0-9a-fA-F]{6}$/, clean: (v) => '#' + String(v ?? '').replace(/[^0-9a-fA-F]/g, '').slice(0, 6), placeholder: '#f59e0b', hint: 'a hex colour, e.g. #f59e0b' },
  code: { re: /^[A-Z][A-Z0-9_]{1,20}$/, clean: upper(21), placeholder: 'SICK', hint: 'UPPERCASE letters, digits or underscore, 2-21 characters' },
  email: { re: /^[^@\s]+@[^@\s.]+\.[A-Za-z]{2,}$/, placeholder: 'name@company.com', hint: 'a full address, e.g. name@company.com' },
  rupees: { re: /^[0-9]{1,9}(\.[0-9]{1,2})?$/, placeholder: '85000', hint: 'rupees, up to 2 decimals' },
};

export function patternProblem(name, value) {
  const p = PATTERNS[name];
  if (!p) return null;
  const v = value === null || value === undefined ? '' : String(value);
  if (!v) return null;                                    // blank means "leave it alone" / "not set yet"
  return p.re.test(v) ? null : (p.hint || 'Wrong format');
}
/** Everything wrong with a form at once, keyed by field — the same checks SchemaForm draws live. */
export function fieldProblems(fields, values) {
  const out = {};
  for (const f of fields || []) {
    if (f.type === 'static' || f.readOnly) continue;
    const v = values?.[f.key];
    const blank = v === '' || v === null || v === undefined;
    if (f.type === 'checkbox') continue;
    if (f.required && blank) { out[f.key] = `${f.label} is required`; continue; }
    if (blank) continue;
    const p = patternProblem(f.pattern, v);
    if (p) { out[f.key] = p; continue; }
    const r = rangeProblem(f, v);
    if (r) { out[f.key] = r; continue; }
    if (typeof f.validate === 'function') { const m = f.validate(v, values); if (m) out[f.key] = m; }
  }
  return out;
}

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
        <Field key={f.key} label={f.label} hint={f.hint || (f.pattern ? PATTERNS[f.pattern]?.hint : null)}
               error={errors[f.key] || rangeProblem(f, values[f.key]) || patternProblem(f.pattern, values[f.key])} required={f.required}
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
      return <Input type="number" inputMode="decimal" suffix={field.unit} step={field.step ?? (field.type === 'money' ? '0.01' : '1')}
                    min={field.min} max={field.max} value={value} onChange={onChange} placeholder={field.placeholder} />;
    case 'date':
      return <Input type="date" value={value} onChange={onChange} />;
    case 'month':
      return <Input type="month" value={value} onChange={onChange} />;
    case 'select':
      return <Select value={value} onChange={onChange} options={field.options || []} placeholder={field.placeholder || 'Choose…'}
                     loading={field.loading} error={field.error} emptyText={field.emptyText} ariaLabel={field.label} />;
    case 'textarea':
      return <Textarea value={value} onChange={onChange} rows={field.rows || 3} placeholder={field.placeholder} />;
    case 'checkbox':
      return <Checkbox checked={value} onChange={onChange} label={field.checkboxLabel || field.label} hint={field.checkboxHint} />;
    case 'static':
      return <div className="text-sm text-slate-300">{display(value)}</div>;
    default: {
      const p = PATTERNS[field.pattern];
      // Cleaning while you type (paste "hdfc-0001234" and the box shows HDFC0001234) is what keeps the
      // value in the field identical to the value the API stores.
      return <Input value={value} onChange={(v) => onChange(p?.clean ? p.clean(v) : v)}
                    placeholder={field.placeholder || p?.placeholder}
                    inputMode={field.pattern === 'rupees' ? 'decimal' : NUMERIC.has(field.pattern) ? 'numeric' : undefined}
                    maxLength={p ? maxLengthFor(field.pattern) : field.maxLength} />;
    }
  }
}

/**
 * A number outside its range is said here, while you type, instead of waiting for the API to refuse the
 * save. `min`/`max` on the field descriptor are the same bounds as the validator on the server — the box
 * only warns, the server still decides.
 */
function rangeProblem(f, value) {
  if (f.type !== 'number' && f.type !== 'money') return null;
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Enter a number';
  if (f.min !== undefined && n < f.min) return `At least ${f.min}${f.unit ? ' ' + f.unit : ''}`;
  if (f.max !== undefined && n > f.max) return `At most ${f.max}${f.unit ? ' ' + f.unit : ''}`;
  return null;
}

/** Keep digits only, and drop a country code someone pasted: 098200 00001 and +91-98200-00001 are one number. */
const mobileDigits = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 12 && d.startsWith('91') ? d.slice(2) : d;
};

const NUMERIC = new Set(['bank_account', 'uan', 'esic', 'aadhaar', 'pincode', 'phone']);
const MAXLEN = { bank_account: 18, ifsc: 11, pan: 10, uan: 12, esic: 17, aadhaar: 12, pincode: 6, phone: 10, hex_color: 7, code: 21, email: 160, rupees: 12 };
const maxLengthFor = (name) => MAXLEN[name];

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
