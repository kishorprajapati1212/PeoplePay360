import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { payroll, salary } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { useTable } from '../../hooks/useTable.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Select, Input, Textarea } from '../../components/ui/controls.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { SearchInput } from '../../components/ui/controls.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { inr, inrCompact, num, date, periodLabel, firstOfMonth } from '../../utils/format.js';

/**
 * Payruns list + the two-step creation the mockup insists on:
 *   step 1 pick structure + period (+ frequency and compute mode) → preview eligible people
 *   step 2 tick exactly who is in → Create Payrun
 * Nothing is written until step 2, so an accidental click never makes payslips.
 */
export function PayrunsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const mayCreate = useCan('payroll:payrun_create');
  const table = useTable({});
  const [wizard, setWizard] = useState(null);
  const list = useApi(useCallback(() => payroll.payruns.list(table.params), [table.params]), [table.params]);
  const structures = useApi(useCallback(() => salary.structures.list({}), []), []);
  const structureOptions = useMemo(() => (structures.data || []).map((s) => ({ value: s.id, label: `${s.name} (${num(s.employees)} assigned)` })), [structures.data]);

  async function remove(row) {
    await payroll.payruns.remove(row.id).then(() => { list.reload(); toast.success('Payrun voided'); }).catch((e) => toast.error(e.message));
  }

  const rows = list.data?.rows || [];
  return (
    <>
      <PageHeader title="Payruns" subtitle="One run per structure per period. Draft → Compute → Validate → PDFs → Paid → Emailed."
                  actions={mayCreate && <button className="btn-primary btn-sm" onClick={() => setWizard({ step: 1, salary_structure_id: structureOptions[0]?.value || '', period_start: firstOfMonth(), period_end: '', pay_frequency: 'MONTHLY', compute_mode: 'PRO_RATA', name: '', notes: '', selected: new Set(), candidates: [] })}>+ New payrun</button>} />

      <Panel pad={false}>
        <DataTable rows={rows} loading={list.loading} error={list.error} onRetry={list.reload} onRowClick={(r) => navigate('/payruns/' + r.id)}
          toolbar={<>
            <SearchInput className="w-56" value={table.term} onChange={table.onSearch} placeholder="Payrun name…" />
            <Select className="w-40" value={table.query.status || ''} onChange={(v) => table.onFilter('status', v)}
                    options={['DRAFT', 'COMPUTED', 'VALIDATED', 'PAID', 'VOID'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))} placeholder="Any status" />
            <Input className="w-40" type="month" value={table.query.month || ''} onChange={(v) => table.onFilter('month', v)} />
            <span className="ml-auto text-xs text-slate-500">{inrCompact(rows.reduce((a, r) => a + Number(r.total_net || 0), 0))} net in view</span>
          </>}
          columns={[
            { key: 'name', label: 'Payrun', render: (r) => (<div><p className="text-slate-100">{r.name}</p><p className="text-xs text-slate-500">{r.salary_structure || '—'}</p></div>) },
            { key: 'period_key', label: 'Period', render: (r) => (<div><p>{periodLabel(r.period_key)}</p><p className="text-xs text-slate-500">{date(r.period_start)} – {date(r.period_end)}</p></div>) },
            { key: 'pay_frequency', label: 'Type', render: (r) => <span className="text-xs text-slate-400">{String(r.pay_frequency || '').replace('_', ' ').toLowerCase()}</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
            { key: 'employee_count', label: 'People', align: 'right', render: (r) => num(r.employee_count ?? r.payslip_count) },
            { key: 'total_gross', label: 'Gross', align: 'right', render: (r) => inr(r.total_gross) },
            { key: 'total_deductions', label: 'Deductions', align: 'right', render: (r) => inr(r.total_deductions) },
            { key: 'total_net', label: 'Net', align: 'right', render: (r) => <span className="font-medium text-slate-100">{inr(r.total_net)}</span> },
            { key: 'flags', label: '', render: (r) => (Number(r.warning_count) > 0 || Number(r.error_count) > 0
                ? <span className="chip border-amber-500/30 bg-amber-500/10 text-amber-300">{num(r.warning_count)} warn{Number(r.error_count) ? ` · ${num(r.error_count)} err` : ''}</span> : null) },
            { key: '_a', label: '', render: (r) => (r.status === 'DRAFT' && mayCreate
                ? <button className="btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); remove(r); }}>Void</button> : null) },
          ]}
          pagination={{ page: table.page, size: table.size, total: list.data?.total || 0, onPage: table.setPage, onSize: table.setSize }}
          empty={<EmptyState title="No payruns yet" hint="Create one for this month: pick a structure, tick the people, then compute." />} />
      </Panel>

      {wizard && <PayrunWizard wizard={wizard} setWizard={setWizard} structures={structureOptions} onDone={() => { setWizard(null); list.reload(); navigate(0); }} />}
    </>
  );
}

function PayrunWizard({ wizard, setWizard, structures, onDone }) {
  const toast = useToast();
  const { run, busy } = useAction();
  const step1 = wizard.step === 1;
  const candidates = useApi(useCallback(() => (step1 ? Promise.resolve([]) : payroll.payruns.candidates({
    salary_structure_id: wizard.salary_structure_id, period_start: wizard.period_start, period_end: wizard.period_end || undefined,
    pay_frequency: wizard.pay_frequency, compute_mode: wizard.compute_mode, page: 1, page_size: 200,
  })), [wizard.step, wizard.salary_structure_id, wizard.period_start, wizard.period_end, wizard.pay_frequency, wizard.compute_mode]), [wizard.step]);
  const preview = useApi(useCallback(() => (step1 ? Promise.resolve(null) : payroll.payruns.preview({
    salary_structure_id: wizard.salary_structure_id, period_start: wizard.period_start, period_end: wizard.period_end || undefined,
    pay_frequency: wizard.pay_frequency, compute_mode: wizard.compute_mode, employee_ids: [...wizard.selected],
  })), [wizard.step, wizard.selected.size]), [wizard.step, wizard.selected.size]);

  const rows = candidates.data?.rows || candidates.data || [];
  const toggle = (id) => { const next = new Set(wizard.selected); next.has(id) ? next.delete(id) : next.add(id); setWizard({ ...wizard, selected: next }); };
  const goStep2 = () => setWizard({ ...wizard, step: 2, selected: new Set(rows.map((r) => r.id)) });

  async function create() {
    const body = { salary_structure_id: wizard.salary_structure_id, period_start: wizard.period_start, period_end: wizard.period_end || undefined,
                   pay_frequency: wizard.pay_frequency, compute_mode: wizard.compute_mode, employee_ids: [...wizard.selected],
                   name: wizard.name || undefined, notes: wizard.notes || undefined, idempotency_key: 'web-' + Date.now() };
    await run('create', () => payroll.payruns.create(body)).then(() => { toast.success('Payrun created as draft'); onDone(); }).catch((e) => toast.error(e.message));
  }

  return (
    <Modal open onClose={() => setWizard(null)} width="max-w-3xl"
           title={step1 ? 'New payrun · step 1 of 2' : 'New payrun · step 2 of 2'}
           subtitle={step1 ? 'What is being paid, and for which dates.' : 'Who is in it. Nothing is saved until you press Create.'}
           footer={<>
             {!step1 && <button className="btn-ghost" onClick={() => setWizard({ ...wizard, step: 1 })}>← Back</button>}
             <button className="btn-ghost" onClick={() => setWizard(null)}>Cancel</button>
             {step1
               ? <button className="btn-primary" onClick={goStep2} disabled={!wizard.salary_structure_id || !wizard.period_start}>Next: select employees</button>
               : <button className="btn-primary" onClick={create} disabled={!!busy || !wizard.selected.size}>{busy === 'create' ? 'Creating…' : `Create payrun (${wizard.selected.size})`}</button>}
           </>}>
      {step1 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Salary structure" required>
            <Select value={wizard.salary_structure_id} onChange={(v) => setWizard({ ...wizard, salary_structure_id: v })} options={structures} placeholder="Choose…" />
          </Field>
          <Field label="Pay frequency" required hint="Half-month runs reconcile to the same monthly net.">
            <Select value={wizard.pay_frequency} onChange={(v) => setWizard({ ...wizard, pay_frequency: v })} options={[
              { value: 'MONTHLY', label: 'Monthly' }, { value: 'HALF_MONTH_FIRST', label: '1st half (1–15)' }, { value: 'HALF_MONTH_SECOND', label: '2nd half (16–end)' },
              { value: 'BI_MONTHLY', label: 'Bi-monthly' }, { value: 'WEEKLY', label: 'Weekly' }, { value: 'CUSTOM', label: 'Custom dates' }]} />
          </Field>
          <Field label="Period starts" required><Input type="date" value={wizard.period_start} onChange={(v) => setWizard({ ...wizard, period_start: v })} /></Field>
          <Field label="Period ends" hint="Blank = end of the month of the start date."><Input type="date" value={wizard.period_end} onChange={(v) => setWizard({ ...wizard, period_end: v })} /></Field>
          <Field label="Compute mode" required hint="Advance 50% pays half the monthly net up-front and trues it up in the second half.">
            <Select value={wizard.compute_mode} onChange={(v) => setWizard({ ...wizard, compute_mode: v })}
                    options={[{ value: 'PRO_RATA', label: 'Pro-rata on days worked' }, { value: 'ADVANCE_50', label: 'Advance 50% + true-up' }]} />
          </Field>
          <Field label="Name" hint="Optional; defaults to structure + period."><Input value={wizard.name} onChange={(v) => setWizard({ ...wizard, name: v })} placeholder="October 2026 — Salaried" /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={wizard.notes} onChange={(v) => setWizard({ ...wizard, notes: v })} /></Field>
        </div>
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-ink-850/60 px-3 py-2 text-xs text-slate-400">
            <span>{num(rows.length)} eligible in this period</span>
            <span>·</span>
            <span>{wizard.selected.size} selected</span>
            {preview.data?.total_net !== undefined && <span className="ml-auto text-slate-300">estimated net {inr(preview.data.total_net)}</span>}
            <button className="btn-ghost btn-sm" onClick={() => setWizard({ ...wizard, selected: new Set(rows.map((r) => r.id)) })}>All</button>
            <button className="btn-ghost btn-sm" onClick={() => setWizard({ ...wizard, selected: new Set() })}>None</button>
          </div>
          {candidates.loading ? <p className="py-6 text-sm text-slate-400">Checking who is on the payroll for these dates…</p> : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-ink-850"><tr><th className="th w-10"></th><th className="th">Employee</th><th className="th">Contract</th><th className="th text-right">Wage</th><th className="th text-right">Days</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={'row ' + (wizard.selected.has(r.id) ? '' : 'opacity-60')} onClick={() => toggle(r.id)}>
                      <td className="td"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={wizard.selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                      <td className="td"><p className="text-slate-100">{r.name || r.employee}</p><p className="text-xs text-slate-500">{r.employee_code} · {r.department || r.job_position}</p></td>
                      <td className="td text-xs text-slate-400">{date(r.contract_start || r.start_date)}{r.contract_end ? ' → ' + date(r.contract_end) : ''}</td>
                      <td className="td text-right">{inr(r.wage ?? r.contract_wage)}</td>
                      <td className="td text-right">{num(r.working_days ?? r.expected_days ?? '—')}</td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td className="td text-slate-500" colSpan={5}>Nobody is on this structure with a contract covering these dates.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
