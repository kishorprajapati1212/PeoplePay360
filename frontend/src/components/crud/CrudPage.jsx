import { useCallback, useMemo, useState } from 'react';
import { useApi } from '../../hooks/useApi.js';
import { useTable } from '../../hooks/useTable.js';
import { DataTable } from '../data/DataTable.jsx';
import { SchemaForm, emptyValues, valuesFromRow } from './schemaForm.jsx';
import { Modal } from '../ui/Modal.jsx';
import { Panel } from '../ui/Panel.jsx';
import { EmptyState, NoAccess } from '../ui/Feedback.jsx';
import { SearchInput, Select } from '../ui/controls.jsx';
import { useToast } from '../ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { PageHeader } from '../../layout/PageHeader.jsx';

/**
 * List + create + edit + delete for one resource, driven entirely by props. This is what keeps the
 * dozen configuration screens in this app short enough to read: a page supplies columns, fields and
 * the endpoint object, and gets the whole workflow (search, paging, validation errors, toasts).
 */
export function CrudPage({
  title, subtitle, actions,
  api,                                  // { list(query), create(body), update(id, body), remove?(id) }
  columns, fields,
  readPerm, writePerm, deletePerm,
  filters = [], search = true, searchPlaceholder = 'Search…',
  rowId = 'id',
  toBody,                                // (values, row) => body
  makeExtra = () => ({}),                 // create-time defaults (e.g. the period a run is for)
  canDelete = () => true,
  emptyHint,
  reloadOn,                                // extra dependency that should refresh the list
  paginate = true,
}) {
  const toast = useToast();
  const mayRead = useCan(readPerm);
  const mayWrite = useCan(writePerm);
  const mayDelete = useCan(deletePerm || writePerm);
  const [editing, setEditing] = useState(null);   // null | 'new' | row
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const table = useTable({ search, filters });
  if (readPerm && !mayRead) return <NoAccess permission={readPerm} />;
  const load = useCallback(() => api.list(paginate ? table.params : { q: table.query.q }), [api, table.params, table.query.q, reloadOn]);
  const { data, loading, error, reload } = useApi(load, [load, reloadOn]);
  const rows = useMemo(() => (Array.isArray(data) ? data : data?.rows) || [], [data]);
  const total = data?.total ?? rows.length;

  const startCreate = () => { setErrors({}); setValues(emptyValues(fields, makeExtra())); setEditing('new'); };
  const startEdit = (row) => { setErrors({}); setValues(valuesFromRow(fields, row, makeExtra(row))); setEditing(row); };
  const close = () => { setEditing(null); setConfirmDelete(null); };
  const setValue = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  async function save() {
    setSaving(true); setErrors({});
    const body = toBody ? toBody(values, editing === 'new' ? null : editing) : values;
    try {
      if (editing === 'new') { await api.create(body); toast.success(title + ' created'); }
      else { await api.update(editing[rowId], body); toast.success(title + ' updated'); }
      close();
      reload();
    } catch (e) {
      setErrors(e.fieldErrors || {});
      toast.error(e.message);
    } finally { setSaving(false); }
  }

  async function remove(row) {
    try { await api.remove(row[rowId]); toast.success('Removed'); setConfirmDelete(null); reload(); }
    catch (e) { toast.error(e.message); }
  }

  const toolbar = (
    <>
      {search && <SearchInput className="w-64" value={table.term} onChange={table.onSearch} placeholder={searchPlaceholder} />}
      {filters.map((f) => (
        <Select key={f.key} className="w-44" value={table.query[f.key] ?? ''} onChange={(v) => table.onFilter(f.key, v)}
                options={f.options} placeholder={f.label} />
      ))}
      <div className="ml-auto flex items-center gap-2">
        {actions}
        {mayWrite && <button className="btn-primary btn-sm" onClick={startCreate}>+ New</button>}
      </div>
    </>
  );

  const withDelete = mayDelete && api.remove
    ? [...columns, {
        key: '_actions', label: '', width: 'w-24',
        render: (row) => canDelete(row)
          ? <button className="btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); setConfirmDelete(row); }}>Delete</button>
          : <span className="text-xs text-slate-600">locked</span>,
      }]
    : columns;

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Panel pad={false}>
        <DataTable columns={withDelete} rows={rows} loading={loading} error={error} onRetry={reload} toolbar={toolbar} onSort={(c) => table.toggleSort(c.sort)}
                   empty={<EmptyState title={'No ' + title.toLowerCase() + ' yet'} hint={emptyHint} action={mayWrite ? <button className="btn-primary btn-sm" onClick={startCreate}>Create the first one</button> : null} />}
                   pagination={paginate ? { page: table.page, size: table.size, total, onPage: table.setPage, onSize: table.setSize } : undefined} />
        {!rows.length && !loading && emptyHint && <p className="px-4 pb-4 text-xs text-slate-500">{emptyHint}</p>}
      </Panel>

      <Modal open={editing !== null} onClose={close}
             title={editing === 'new' ? 'Create ' + title.toLowerCase() : 'Edit ' + title.toLowerCase()}
             subtitle="Fields marked with * are required. Everything else can stay as it is."
             footer={<>
               <button className="btn-ghost" onClick={close}>Cancel</button>
               <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : (editing === 'new' ? 'Create' : 'Save changes')}</button>
             </>}>
        <SchemaForm fields={fields} values={values} onChange={setValue} errors={errors} />
      </Modal>

      <Modal open={!!confirmDelete} onClose={close} title="Delete this record?" width="max-w-md"
             footer={<>
               <button className="btn-ghost" onClick={close}>Keep it</button>
               <button className="btn-danger" onClick={() => remove(confirmDelete)}>Delete</button>
             </>}>
        <p className="text-sm text-slate-300">
          {confirmDelete?.name || confirmDelete?.code || 'This row'} will be removed. Records that other screens
          depend on are refused by the API instead of being deleted — that is the backend protecting history.
        </p>
      </Modal>
    </>
  );
}
