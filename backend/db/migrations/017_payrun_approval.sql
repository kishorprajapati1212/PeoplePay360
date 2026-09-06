-- Maker-checker for payruns: the person who computes a run may not be the one who approves it.
--
-- The workflow already had the right shape — COMPUTED → VALIDATED ("validate & lock") → PAID — but
-- nothing stopped one account from doing every step, so "approval before anyone has it" was a matter
-- of discipline. This migration records WHO computed each run; payrun.service.validate() then refuses
-- when the approver is the computer (created_by is the fallback for rows computed before this column).
alter table payruns add column if not exists computed_by uuid references users(id) on delete set null;

comment on column payruns.computed_by is 'Who ran the computation (recompute moves it to the latest actor). validate() refuses this account — approval belongs to a different person.';

-- The summary view gains the approver columns (appended at the end: CREATE OR REPLACE allows that
-- without touching readers), so the payrun screen can say WHO computed and WHO approved a run —
-- the sentence next to the Validate button needs both.
create or replace view v_payrun_summary as
select r.id, r.name, r.period_key, r.period_start, r.period_end, r.status, r.pay_frequency, r.compute_mode,
       r.salary_structure_id, st.name as salary_structure, r.month_anchor, r.employee_type_filter, r.department_filter,
       r.computed_at, r.validated_at, r.validated_by, r.locked_at, r.paid_by, r.notes,
       r.employee_count, r.payslip_count, r.total_gross, r.total_deductions, r.total_net, r.employer_cost,
       r.warning_count, r.error_count, r.created_at, r.paid_at, r.sent_at,
       u.name as created_by,
       (select count(*) from payslips p where p.payrun_id = r.id) as payslips,
       (select count(*) from email_deliveries m where m.payrun_id = r.id and m.status = 'SENT') as emails_sent,
       (select count(*) from email_deliveries m where m.payrun_id = r.id and m.status in ('FAILED','BOUNCED')) as emails_failed,
       r.created_by as created_by_id,
       r.computed_by,
       cu.name as computed_by_name,
       vu.name as validated_by_name,
       pw.name as paid_by_name
from payruns r
join salary_structures st on st.id = r.salary_structure_id
left join users u on u.id = r.created_by
left join users cu on cu.id = r.computed_by
left join users vu on vu.id = r.validated_by
left join users pw on pw.id = r.paid_by;
