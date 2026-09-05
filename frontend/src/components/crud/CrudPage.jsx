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
import { toRows, totalOf } from '../../utils/query.js';

/**
 * List + create + edit + delete for one resource, driven by props. This is what keeps the dozen
 * configuration screens in this app short enough to read: a page passes its columns, its fields and the
 * endpoint object from api/endpoints.js, and gets search, paging, server-side validation errors and toasts.
 *
 *   api     { list(query), create(body), update(id, body), remove?(id) }
 *   fields  what the dialog shows — see schemaForm.jsx for the shape of one field
 *   perms   the permission each action needs, so a role that cannot write never sees a button
 */
export function CrudPage({
  title, subtitle, actions,
  api, columns, fields,
  readPerm, writePerm, deletePerm,
  filters = [], search = true, searchPlaceholder = 'Search…',
  toBody,                                  // (values, row) => the JSON body the API wants
  makeExtra = () => ({}),                  // create-time defaults a page cannot know from its fields
  canDelete = () => true,                  // some rows are history, not records (allocations, payslips)
  emptyHint,
  reloadOn,                                // something else that should refresh the list
}) {
  const toast = useToast();
  const mayRead = useCan(readPerm);
  const mayWrite = useCan(writePerm);
  const mayDelete = useCan(deletePerm || writePerm);
  const [editing, setEditing] = useState(null);        // null | 'new' | the row being edited
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});            // per-field, from the API
  const [serverError, setServerError] = useState('');  // anything the API refused, kept visible in the dialog
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const table = useTable({ search, filters });
  if (readPerm && !mayRead) return <NoAccess permission={readPerm} />;

  const load = useCallback(() => api.list(table.params), [api, table.params]);
  const { data, loading, error, reload } = useApi(load, [load, reloadOn]);
  const rows = useMemo(() => toRows(data), [data]);

  function startCreate() { setErrors({}); setServerError(''); setValues(emptyValues(fields, makeExtra())); setEditing('new'); }
  function startEdit(row) { setErrors({}); setServerError(''); setValues(valuesFromRow(fields, row, makeExtra(row))); setEditing(row); }
  function close() { setEditing(null); setConfirmDelete(null); }
  const setValue = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  async function save() {
    setSaving(true); setErrors({}); setServerError('');
    const body = toBody ? toBody(values, editing === 'new' ? null : editing) : values;
    try {
      if (editing === 'new') { await api.create(body); toast.success(title + ' created'); }
      else { await api.update(editing.id, body); toast.success(title + ' updated'); }
      close();
      reload();
    } catch (e) {
      // A rejected save stays open with the reason written under the field it belongs to — a toast alone
      // disappears while you are still reading the dialog.
      setErrors(e.fieldErrors || {});
      setServerError(e.message);
    } finally { setSaving(false); }
  }

  async function remove(row) {
    try { await api.remove(row.id); toast.success('Removed'); setConfirmDelete(null); reload(); }
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
          : <span className="text-xs text-slate-500">locked</span>,
      }]
    : columns;

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Panel pad={false}>
        <DataTable columns={withDelete} rows={rows} loading={loading} error={error} onRetry={reload} toolbar={toolbar}
                   onSort={(c) => table.toggleSort(c.sort)}
                   empty={<EmptyState title={'No ' + title.toLowerCase() + ' yet'} hint={emptyHint}
                                       action={mayWrite ? <button className="btn-primary btn-sm" onClick={startCreate}>Create the first one</button> : null} />}
                   pagination={{ page: table.page, size: table.size, total: totalOf(data, rows.length), onPage: table.setPage, onSize: table.setSize }} />
      </Panel>

      <Modal open={editing !== null} onClose={close}
             title={editing === 'new' ? 'Create ' + title.toLowerCase() : 'Edit ' + title.toLowerCase()}
             subtitle="Fields marked with * are required. Everything else can stay as it is."
             footer={<>
               <button className="btn-ghost" onClick={close}>Cancel</button>
               <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : (editing === 'new' ? 'Create' : 'Save changes')}</button>
             </>}>
        <SchemaForm fields={fields} values={values} onChange={setValue} errors={errors} />
        {serverError && (
          <p className="mt-4 rounded-lg border border-bad/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">{serverError}</p>
        )}
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
