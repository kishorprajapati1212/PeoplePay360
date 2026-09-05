import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { payroll } from '../../api/endpoints.js';
import { useApi } from '../../hooks/useApi.js';
import { useTable } from '../../hooks/useTable.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { SearchInput, Select } from '../../components/ui/controls.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { inr, num, date, periodLabel } from '../../utils/format.js';
import { useCan } from '../../rbac/Can.jsx';
import { toRows, totalOf } from '../../utils/query.js';

/** Payslip register: one row per person per period, with the state of its PDF and its email. */
export function PayslipsPage() {
  const navigate = useNavigate();
  const mayReadAll = useCan('payslip:read_all');
  const table = useTable({});
  const list = useApi(useCallback(() => payroll.payslips.list(table.params), [table.params]), [table.params]);

  return (
    <>
      <PageHeader title="Payslips" subtitle={mayReadAll ? 'Every slip in the system. Click one to see the rule-by-rule working.' : 'Only your own slips are listed here — the portal download is the employee path.'} />
      <Panel pad={false}>
        <DataTable rows={toRows(list.data)} loading={list.loading} error={list.error} onRetry={list.reload} onRowClick={(r) => navigate('/payslips/' + r.id)}
          toolbar={<>
            <SearchInput className="w-56" value={table.term} onChange={table.onSearch} placeholder="Employee or code…" />
            <Select className="w-40" value={table.query.status || ''} onChange={(v) => table.onFilter('status', v)}
                    options={['DRAFT', 'COMPUTED', 'VALIDATED', 'PAID', 'VOID'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))} placeholder="Any status" />
            <Select className="w-40" value={table.query.payrun_id || ''} onChange={(v) => table.onFilter('payrun_id', v)} options={[]} placeholder="Any payrun" />
            <span className="ml-auto text-xs text-slate-500">{num(list.data?.total || 0)} slips</span>
          </>}
          columns={[
            { key: 'employee', label: 'Employee', render: (r) => (<div><p className="text-slate-100">{r.employee}</p><p className="text-xs text-slate-500">{r.employee_code} · {r.department}</p></div>) },
            { key: 'period_key', label: 'Period', render: (r) => (<div><p>{periodLabel(r.period_key)}</p><p className="text-xs text-slate-500">{r.payslip_kind ? r.payslip_kind.replace('_', ' ').toLowerCase() : 'monthly'}</p></div>) },
            { key: 'gross_amount', label: 'Gross', align: 'right', render: (r) => inr(r.gross_amount) },
            { key: 'total_deductions', label: 'Deductions', align: 'right', render: (r) => inr(r.total_deductions) },
            { key: 'net_amount', label: 'Net', align: 'right', render: (r) => <span className="font-medium text-emerald-300">{inr(r.net_amount)}</span> },
            { key: 'worked_days', label: 'Days', align: 'right', render: (r) => `${num(r.worked_days)} / ${num(r.expected_working_days)}` },
            { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
            { key: 'document_version', label: 'Ver', align: 'right', render: (r) => 'v' + num(r.document_version || 1) },
            { key: 'pdf_generated_at', label: 'PDF', render: (r) => (r.pdf_hash ? <span className="text-xs text-emerald-300">{date(r.pdf_generated_at)}</span> : <span className="text-xs text-slate-600">—</span>) },
            { key: 'email_status', label: 'Email', render: (r) => (r.email_status ? <StatusChip value={r.email_status} /> : <span className="text-xs text-slate-600">—</span>) },
          ]}
          pagination={{ page: table.page, size: table.size, total: totalOf(list.data, toRows(list.data).length), onPage: table.setPage, onSize: table.setSize }}
          empty={<EmptyState title="No payslips" hint="They appear as soon as a payrun is computed." />} />
      </Panel>
    </>
  );
}
