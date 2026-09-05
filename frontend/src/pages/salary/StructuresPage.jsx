import { useCallback, useMemo, useState } from 'react';
import { salary } from '../../api/endpoints.js';
import { CrudPage } from '../../components/crud/CrudPage.jsx';
import { useApi } from '../../hooks/useApi.js';
import { Modal } from '../../components/ui/Modal.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { Field, Input } from '../../components/ui/controls.jsx';
import { Notice } from '../../components/ui/Feedback.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { inr, num } from '../../utils/format.js';
import { explainRule } from '../../utils/salary.js';
import { toRows } from '../../utils/query.js';

/**
 * Salary structures — the list, and one dialog that reads like a payslip.
 *
 * The list is an ordinary CRUD table (a structure is a name, a code and a status). The dialog is the part that
 * used to be useless: it printed `Category`, `Line`, `How`, `Pro-rata` — field names, not answers — and a
 * formula hidden in a tooltip. So the dialog now asks the engine itself. `POST /salary/preview` runs the same
 * computation a payslip uses for a wage you type, and each rule is shown with the rupees it produced and the
 * sentence the engine wrote while producing it. Nothing here is a second calculation: if the preview and a real
 * slip ever disagree, that is a bug in the engine, and it will show up on this screen first.
 */
export function StructuresPage() {
  const mayWrite = useCan('salary:structure_write');
  const [open, setOpen] = useState(null);
  const detail = useApi(useCallback(() => (open ? salary.structures.one(open.id) : Promise.resolve(null)), [open]), [open]);
  const impact = useApi(useCallback(() => (open ? salary.structures.impact(open.id).catch(() => null) : Promise.resolve(null)), [open]), [open]);
  const rows = toRows(detail.data?.rules || detail.data?.structure?.rules);

  return (
    <>
      <CrudPage
        title="Salary structures"
        subtitle="Rules grouped into a template you can assign to a contract. GROSS and NET lines are totals, not inputs."
        api={salary.structures}
        readPerm="salary:structure_read" writePerm="salary:structure_write" deletePerm="salary:structure_write"
        // Structures store ACTIVE/INACTIVE (structureBody in backend/src/validators/payroll.schema.js),
        // so the same button writes the enum instead of a boolean.
        active={{ field: 'is_active', on: 'ACTIVE', off: 'INACTIVE' }}
        search={false}
        actions={<span className="text-xs text-slate-500">click a row to see its rules and what they pay</span>}
        columns={[
          { key: 'name', label: 'Structure', render: (r) => (<div className="min-w-0"><p className="truncate text-slate-100">{r.name}</p><p className="truncate text-xs text-slate-500">{r.description || 'no description'}</p></div>) },
          { key: 'code', label: 'Code', render: (r) => <span className="font-mono text-xs text-slate-300">{r.code || '—'}</span> },
          { key: 'rules', label: 'Lines', align: 'right', title: 'How many rules this structure runs, in the order they are evaluated.',
            render: (r) => num(r.rules ?? r.rule_count) },
          { key: 'employees', label: 'Assigned to', align: 'right', title: 'Contracts using this structure right now.',
            render: (r) => num(r.employees ?? r.employee_count) },
          { key: 'payruns', label: 'Used in runs', align: 'right', title: 'Payruns computed with it — a structure with lines in a paid run cannot simply be deleted.',
            render: (r) => num(r.payruns ?? r.payrun_count) },
          { key: 'monthly_wage', label: 'Wage on those contracts', align: 'right',
            title: 'The monthly basic the contracts on this structure carry. The dialog previews a slip at this number.',
            render: (r) => (r.monthly_wage ? inr(r.monthly_wage) : '—') },
          { key: 'is_active', label: 'Status', render: (r) => <StatusChip value={String(r.is_active) === 'false' || r.is_active === false ? 'INACTIVE' : 'ACTIVE'} /> },
        ]}
        fields={[
          { key: 'name', label: 'Name', required: true, placeholder: 'Regular Salary' },
          { key: 'code', label: 'Code', placeholder: 'REG', hint: 'Optional — for your own reference and for imports.' },
          { key: 'is_active', label: 'Status', type: 'select', options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }] },
          { key: 'description', label: 'Description', type: 'textarea', rows: 2 },
        ]}
        toBody={(v) => ({ name: v.name, code: v.code || undefined, description: v.description || undefined, is_active: v.is_active || 'ACTIVE' })}
        onRow={(row) => setOpen(row)}
      />

      <StructureDialog open={open} onClose={() => setOpen(null)} detail={detail} impact={impact} rows={rows} mayWrite={mayWrite} />
    </>
  );
}

/** The rules of one structure, priced by the engine for a wage you choose. */
function StructureDialog({ open, onClose, detail, impact, rows, mayWrite }) {
  // The preview wage defaults to what the contracts on this structure actually pay, because that is the number
  // a person is usually checking; typing another one and pressing Recalculate is how a boundary gets tested.
  const [wage, setWage] = useState(null);
  const [days, setDays] = useState(null);
  const [run, setRun] = useState(0);
  const previewWage = wage ?? open?.monthly_wage ?? 85000;
  const previewDays = days ?? 22;
  const preview = useApi(useCallback(() => (open && run > 0 ? salary.preview({ structure_id: open.id, wage: Number(previewWage), days: Number(previewDays) }) : Promise.resolve(null)),
                                       [open, run]), [open, run]);
  const byCode = useMemo(() => Object.fromEntries((preview.data?.lines || []).map((l) => [l.code, l])), [preview.data]);

  if (!open) return null;
  const totals = preview.data?.totals || null;

  return (
    <Modal open onClose={onClose} width="max-w-4xl"
           title={open.name} subtitle={impact.data ? `${num(impact.data.employees ?? impact.data.assigned ?? 0)} employees use this structure today` : 'Every line, in the order the engine runs them'}
           footer={<button className="btn-ghost" onClick={onClose}>Close</button>}>
      {detail.loading ? <p className="text-sm text-slate-400">Loading rules…</p> : (
        <>
          <div className="mb-3 grid items-end gap-3 sm:grid-cols-[1fr_auto_auto]">
            <Field label="Monthly wage to preview" hint="Basic before any rule runs — the same number the contract stores.">
              <Input type="number" min="0" step="1000" value={previewWage} onChange={(v) => setWage(v)} suffix="₹ / month" />
            </Field>
            <Field label="Days worked"><Input type="number" min="1" max="31" step="1" value={previewDays} onChange={(v) => setDays(v)} /></Field>
            <button className="btn-ghost btn-sm mb-6" disabled={!!preview.loading} onClick={() => setRun((n) => n + 1)}>
              {preview.loading ? 'Running…' : run === 0 ? 'Show the amounts' : 'Recalculate'}</button>
          </div>

          {preview.error && (
            <Notice tone="warn" title="The preview could not run">
              <p>{preview.error.message} — the rules and their settings are listed below either way.</p>
            </Notice>
          )}

          <DataTable rows={rows} columns={[
            { key: 'sequence', label: '#', width: 'w-10', title: 'The order the engine evaluates them in. A rule may only read the lines above it.',
              render: (r) => <span className="font-mono text-xs text-slate-500">{num(r.sequence)}</span> },
            { key: 'name', label: 'Line on the payslip', render: (r) => (
              <div className="min-w-0"><p className="truncate text-slate-100">{r.name}</p>
                   <p className="truncate font-mono text-xs text-slate-500">{r.code}</p></div>) },
            { key: 'explain', label: 'What it is, and what it pays',
              render: (r) => (
                <div className="min-w-0">
                  <p className="text-slate-300">{explainRule(r, { amount: byCode[r.code]?.amount })}</p>
                  {/* the engine's own sentence, not a paraphrase of it */}
                  {byCode[r.code]?.log && <p className="mt-0.5 text-xs text-slate-500">{byCode[r.code].log}</p>}
                </div>) },
            { key: 'amount', label: 'Amount', align: 'right', title: run === 0 ? 'Press “Show the amounts” to have the engine price these lines.' : 'From the same computation a payslip uses.',
              render: (r) => (byCode[r.code] ? <span className="text-slate-100">{inr(byCode[r.code].amount)}</span> : <span className="text-slate-600">—</span>) },
            { key: 'appears_on_payslip', label: 'On the slip', align: 'center', title: 'Some lines (a reimbursement tracked for cost only) are kept off the printed payslip.',
              render: (r) => (r.appears_on_payslip ? <span className="text-emerald-300">yes</span> : <span className="text-slate-500">no</span>) },
            { key: 'statutory', label: 'Fixed by law', align: 'center', title: 'PF, ESI and professional tax: the number comes from the rules in Company settings, so changing it here would make the slip wrong.',
              render: (r) => (r.statutory ? <span className="chip border-amber-500/30 bg-amber-500/10 text-amber-300">yes</span> : <span className="text-slate-600">—</span>) },
          ]} empty={<p className="py-6 text-sm text-slate-500">No rules yet — add them on the Rules screen and point them at this structure.</p>} />

          {totals && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {[['Gross', totals.gross, 'Earnings, before anything is taken out.'],
                ['Deductions', totals.deductions, 'What leaves the pay: PF, ESI, professional tax, recoveries.'],
                ['Net paid', totals.net, 'The number on the payslip and in the bank.']].map(([label, value, hint]) => (
                <Panel key={label} pad>
                  <p className="label">{label}</p>
                  <p className="mt-1 text-lg text-slate-50">{inr(value)}</p>
                  <p className="text-xs text-slate-500">{hint}</p>
                </Panel>))}
            </div>
          )}
          {preview.data?.warnings?.length > 0 && (
            <Notice tone="warn" title={`${num(preview.data.warnings.length)} thing(s) the engine flagged at this wage`}>
              <ul className="mt-1 space-y-1 text-xs">{preview.data.warnings.slice(0, 6).map((w, i) => <li key={i}>· {typeof w === 'string' ? w : w.message || w.code}</li>)}</ul>
            </Notice>
          )}

          <p className="mt-3 text-xs text-slate-500">
            {mayWrite ? 'Rule order, amounts and formulas are edited on ' : 'You can view but not change the rules; they are edited on '}
            <span className="text-slate-300">Payroll › Rules</span>. A rule with no structure attached is not read by any payslip.
          </p>
        </>
      )}
    </Modal>
  );
}
