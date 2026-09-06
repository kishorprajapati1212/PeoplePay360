import { useCallback, useState } from 'react';
import { portal } from '../../api/endpoints.js';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { inr, num, periodLabel, date } from '../../utils/format.js';
import { downloadSlip } from '../../utils/download.js';
import { toRows } from '../../utils/query.js';

/** The employee's own payslip archive: every month, with a real download button. */
export function MyPayslipsPage() {
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const list = useApi(useCallback(() => portal.payslips({ year, page: 1, page_size: 60 }), [year]), [year]);

  return (
    <>
      <PageHeader title="My payslips" subtitle="Downloads are recorded, so payroll can see that you received the right file."
                  actions={
                    <select className="input w-32 py-1.5 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                      {[0, 1, 2, 3].map((back) => { const y = new Date().getFullYear() - back; return <option key={y} value={y}>{y}</option>; })}
                    </select>
                  } />
      <Panel pad={false}>
        <DataTable rows={toRows(list.data)} loading={list.loading} error={list.error} onRetry={list.reload}
          columns={[
            { key: 'period_key', label: 'Period', render: (r) => periodLabel(r.period_key) },
            { key: 'payslip_kind', label: 'Type', render: (r) => String(r.payslip_kind || 'MONTHLY').replace('_', ' ').toLowerCase() },
            { key: 'gross_amount', label: 'Gross', align: 'right', render: (r) => inr(r.gross_amount) },
            { key: 'total_deductions', label: 'Deductions', align: 'right', render: (r) => inr(r.total_deductions) },
            { key: 'net_amount', label: 'Net', align: 'right', render: (r) => <span className="font-medium text-emerald-300">{inr(r.net_amount)}</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
            { key: 'worked_days', label: 'Days', align: 'right', render: (r) => `${num(r.worked_days)}/${num(r.expected_working_days)}` },
            { key: '_a', label: '', render: (r) => (
              <button className="btn-primary btn-sm" onClick={() => downloadSlip(r.id, r.employee_code, r.period_key).catch((e) => toast.error(e.message))}>Download PDF</button>) },
          ]}
          empty={<EmptyState title={`No payslips for ${year}`} hint="Try another year — the archive keeps every slip that was ever released." />} />
      </Panel>
    </>
  );
}
