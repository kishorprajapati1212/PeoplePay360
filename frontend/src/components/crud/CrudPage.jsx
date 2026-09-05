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
import { useAuth } from '../../auth/useAuth.js';
import { can as canUser } from '../../rbac/permissions.js';
import { fieldProblems } from './schemaForm.jsx';
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
  // rows that carry a switch-off flag get an Activate/Deactivate button, so "ACTIVE" in a table is never
  // a dead end. field is the column, and the value written back is true/false for a boolean column or
  // on/off for a text one (leave types and structures store ACTIVE/INACTIVE).
  active,                                  // { field='is_active', on='ACTIVE', off='INACTIVE', includeInactive=false }
  rowActions = [],                         // [{ key, label, perm?, show?(row), onClick(row, { reload, toast }) }]
}) {
  const toast = useToast();
  const mayRead = useCan(readPerm);
  const mayWrite = useCan(writePerm);
  const mayDelete = useCan(deletePerm || writePerm);
  const { user } = useAuth();
  const activeCfg = active ? { field: 'is_active', on: 'ACTIVE', off: 'INACTIVE', includeInactive: false, ...active } : null;
  // A row action's permission is known page-wide; whether it applies is not, so that half is decided per row.
  const permittedActions = rowActions.filter((a) => !a.perm || canUser(user, a.perm));
  const actionsFor = (row) => permittedActions.filter((a) => !a.show || (row && a.show(row)));
  const canToggleActive = !!activeCfg && mayWrite && !!api.update;
  const [editing, setEditing] = useState(null);        // null | 'new' | the row being edited
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});            // per-field, from the API
  const [serverError, setServerError] = useState('');  // anything the API refused, kept visible in the dialog
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmActive, setConfirmActive] = useState(null);   // row waiting for a deactivate answer
  const [showInactive, setShowInactive] = useState(false);

  const table = useTable({ search, filters });

  const load = useCallback(() => api.list(activeCfg?.includeInactive && showInactive
    ? { ...table.params, include_inactive: 'true' }
    : table.params), [api, table.params, showInactive, activeCfg]);
  const { data, loading, error, reload } = useApi(load, [load, reloadOn]);
  const rows = useMemo(() => toRows(data), [data]);

  function startCreate() { setErrors({}); setServerError(''); setValues(emptyValues(fields, makeExtra())); setEditing('new'); }
  function startEdit(row) { setErrors({}); setServerError(''); setValues(valuesFromRow(fields, row, makeExtra(row))); setEditing(row); }
  function close() { setEditing(null); setConfirmDelete(null); }
  const setValue = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  /** Same rules the API enforces, checked before the request, so a bad IFSC is red here rather than in a toast. */
  function submit() {
    const found = fieldProblems(fields, values);
    if (Object.keys(found).length) { setErrors(found); setServerError('Fix the highlighted fields first.'); return; }
    save();
  }

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

  const activeOn = (row) => {
    const v = row?.[activeCfg.field];
    if (typeof v === 'boolean') return v;
    if (v === undefined || v === null || v === '') return true;
    return String(v).toUpperCase() === String(activeCfg.on).toUpperCase();
  };
  async function setActive(row, on) {
    const value = typeof row?.[activeCfg.field] === 'boolean' ? on : (on ? activeCfg.on : activeCfg.off);
    try {
      await api.update(row.id, { [activeCfg.field]: value });
      toast.success(`${title} ${on ? 'activated' : 'deactivated'}`);
      setConfirmActive(null);
      reload();
    } catch (e) { toast.error(e.message); setConfirmActive(null); }
  }

  const toolbar = (
    <>
      {search && <SearchInput className="w-64" value={table.term} onChange={table.onSearch} placeholder={searchPlaceholder} />}
      {filters.map((f) => (
        <Select key={f.key} className="w-44" value={table.query[f.key] ?? ''} onChange={(v) => table.onFilter(f.key, v)}
                options={f.options} placeholder={f.label} />
      ))}
      {activeCfg?.includeInactive && (
        <label className="flex items-center gap-1.5 text-xs text-slate-400" title="Inactive rows stay in the list so they can be switched back on">
          <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      )}
      <div className="ml-auto flex items-center gap-2">
        {actions}
        {mayWrite && <button className="btn-primary btn-sm" onClick={startCreate}>+ New</button>}
      </div>
    </>
  );

  /* One actions column, two buttons: Edit opens the same form filled in, Delete asks first. A row that is
     history (a paid slip, a used allocation) says "locked" instead of offering a delete the API would refuse,
     and a resource whose API has no update gets no Edit button — never a button that can only fail. */
  const hasRowActions = permittedActions.length > 0 || canToggleActive || (mayWrite && api.update) || (mayDelete && api.remove);
  const withActions = hasRowActions
    ? [...columns, {
        key: '_actions', label: '', width: 'w-56', align: 'right',
        render: (row) => (
          <span className="flex flex-wrap justify-end gap-1.5">
            {actionsFor(row).map((a) => (
              <button key={a.key} className="btn-ghost btn-sm" title={a.title}
                      onClick={(e) => { e.stopPropagation(); a.onClick(row, { reload, toast }); }}>{a.label}</button>
            ))}
            {canToggleActive && (
              <button className="btn-ghost btn-sm"
                      title={activeOn(row)
                        ? 'Stops it appearing in new picks; anything already recorded stays.'
                        : 'Put it back on the list'}
                      onClick={(e) => { e.stopPropagation(); activeOn(row) ? setConfirmActive(row) : setActive(row, true); }}>
                {activeOn(row) ? 'Deactivate' : 'Activate'}
              </button>
            )}
            {mayWrite && api.update && <button className="btn-ghost btn-sm" onClick={() => startEdit(row)}>Edit</button>}
            {mayDelete && api.remove && (canDelete(row)
              ? <button className="btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); setConfirmDelete(row); }}>Delete</button>
              : <span className="self-center text-xs text-slate-500" title="Other screens depend on this row">locked</span>)}
          </span>
        ),
      }]
    : columns;

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Panel pad={false}>
        <DataTable columns={withActions} rows={rows} loading={loading} error={error} onRetry={reload} toolbar={toolbar}
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
               <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : (editing === 'new' ? 'Create' : 'Save changes')}</button>
             </>}>
        <SchemaForm fields={fields} values={values} onChange={setValue} errors={errors} />
        {serverError && (
          <p className="mt-4 rounded-lg border border-bad/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">{serverError}</p>
        )}
      </Modal>

      <Modal open={!!confirmActive && !confirmDelete} onClose={close} title="Deactivate this record?" width="max-w-md"
             footer={<>
               <button className="btn-ghost" onClick={close}>Keep it active</button>
               <button className="btn-danger" onClick={() => setActive(confirmActive, false)}>Deactivate</button>
             </>}>
        <p className="text-sm text-slate-300">
          {confirmActive?.name || confirmActive?.code || 'This row'} stops being offered — new payruns, new requests and new
          picks will not see it. History that already refers to it (allocations, payslips, attendance) is untouched,
          and Activate puts it back. Deleting instead would be refused: those records still point here.
        </p>
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
