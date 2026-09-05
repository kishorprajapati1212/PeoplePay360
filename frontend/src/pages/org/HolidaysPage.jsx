import { useCallback, useState } from 'react';
import { org } from '../../api/endpoints.js';
import { CrudPage } from '../../components/crud/CrudPage.jsx';
import { useAction } from '../../hooks/useApi.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { date } from '../../utils/format.js';

/** Holiday calendar: the days payroll must NOT expect attendance in, and the leave rules count as "not a working day". */
export function HolidaysPage() {
  const toast = useToast();
  const mayWrite = useCan('holiday:write');
  const [seed, setSeed] = useState(0);
  const { run, busy } = useAction();
  const year = new Date().getFullYear() + 1;

  return (
    <CrudPage
      title="Holidays"
      subtitle="Public, company and optional holidays. Optional ones are only off when the employee applies for them."
      api={org.holidays}
      readPerm="holiday:read" writePerm="holiday:write" deletePerm="holiday:write"
      reloadOn={seed}
      search={false}
      actions={mayWrite && (
        <button className="btn-ghost btn-sm" disabled={!!busy}
                onClick={() => run('gen', () => org.holidays.generate({ year }))
                  .then((out) => { setSeed((n) => n + 1); toast.success('Loaded ' + (out?.created ?? 'the template') + ' holidays for ' + year); })
                  .catch((e) => toast.error(e.message))}>
          {busy === 'gen' ? 'Loading…' : 'Load ' + year + ' template'}
        </button>
      )}
      columns={[
        { key: 'day', label: 'Date', render: (r) => date(r.day) },
        { key: 'name', label: 'Holiday' },
        { key: 'type', label: 'Type' },
        { key: 'year', label: 'Year', align: 'right' },
        { key: 'template', label: 'From template', render: (r) => r.template || '—' },
        { key: 'note', label: 'Note', render: (r) => r.note || '—' },
      ]}
      fields={[
        { key: 'day', label: 'Date', type: 'date', required: true },
        { key: 'name', label: 'Name', required: true, placeholder: 'Gandhi Jayanti' },
        { key: 'type', label: 'Type', type: 'select', options: ['PUBLIC', 'COMPANY', 'OPTIONAL'].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() })) },
        { key: 'note', label: 'Note', type: 'textarea', rows: 2 },
      ]}
    />
  );
}
