import { rupeesInWords } from '../../lib/shared/index.js';
import { one, rows, numbers } from '../db.js';

/**
 * Everything the renderer and the mailer need about one payslip, in one round trip.
 * The API assembles the same shape from its own repositories; this is the worker-side copy so the two
 * processes never share a connection or a module-level cache.
 */
export async function payslipPackage(payslipId) {
  // The payslips table (not the list view) is authoritative here: the PDF needs computation_summary,
  // worked_hours and the contract/structure links, and payslips are immutable once PAID.
  const slip = numbers(await one(`select p.*, e.employee_code, r.name as payrun, r.status as payrun_status
                                  from payslips p
                                  join payruns r on r.id = p.payrun_id
                                  left join employees e on e.id = p.employee_id
                                  where p.id = $1::uuid`, [payslipId]));
  if (!slip) return null;
  const [employee, company, lineRows] = await Promise.all([
    one(`select e.id, e.employee_code, e.name, e.job_position, e.work_location, e.date_of_joining, e.employee_type, e.status,
                e.bank_account_number, e.bank_ifsc, e.bank_name, e.pan_number, e.uan_number, e.esi_number, e.basic_salary,
                d.name as department, c.wage as contract_wage, c.start_date as contract_start, c.end_date as contract_end,
                s.name as structure
         from employees e
         left join departments d on d.id = e.department_id
         left join contracts c on c.id = $2::uuid
         left join salary_structures s on s.id = $3::uuid
         where e.id = $1::uuid`, [slip.employee_id, slip.contract_id ?? null, slip.salary_structure_id ?? null]),
    one(`select * from company_settings where id`),
    rows(`select l.* from payslip_lines l where l.payslip_id = $1::uuid order by l.sequence, l.rule_code`, [payslipId]),
  ]);
  return {
    slip,
    employee: { ...(employee ?? {}), ...slip },
    company: company ?? {},
    lines: lineRows.map((l) => numbers(l, ['amount', 'quantity', 'base_amount'])),
  };
}
/** The renderer wants a display label per line, in gross → net order, excluding report-only rows. */
export function pdfInput({ slip, employee, company, lines }) {
  return {
    payslip: { ...slip, period_label: `${String(slip.period_start).slice(0, 10)} to ${String(slip.period_end).slice(0, 10)}`,
               kind_label: String(slip.payslip_kind ?? 'MONTHLY').replace(/_/g, ' ') },
    employee,
    company,
    lines: lines.map((l) => ({ ...l, amount: Number(l.amount) })),
    totals: { gross: Number(slip.gross_amount), deductions: Number(slip.total_deductions),
              adjustments: Number(slip.total_adjustments), net: Number(slip.net_amount) },
    meta: { ...(slip.computation_summary ? { computation_summary: slip.computation_summary } : {}),
            expected_working_days: slip.expected_working_days, paid_days: slip.paid_days,
            unpaid_leave_days: slip.unpaid_leave_days, overtime_hours: Number(slip.overtime_hours || 0),
            worked_hours: Number(slip.worked_hours || 0), pro_rata_factor: Number(slip.pro_rata_factor || 1) },
    amountInWords: rupeesInWords(slip.net_amount),
  };
}
