CREATE VIEW v_employee_directory AS
SELECT e.id, e.employee_code, e.name, e.work_email, e.phone, e.job_position, e.employee_type, e.status,
       e.date_of_joining, e.date_of_exit, e.work_location, e.basic_salary,
       d.id AS department_id, COALESCE(d.name,'—') AS department,
       m.id AS manager_id, m.name AS manager, m.employee_code AS manager_code,
       s.id AS working_schedule_id, s.name AS working_schedule, s.total_weekly_hours,
       c.id AS active_contract_id, c.wage AS contract_wage, c.start_date AS contract_start,
         c.end_date AS contract_end, c.status AS contract_status,
       st.name AS salary_structure, st.id AS salary_structure_id,
       u.id AS user_id, u.role AS user_role, u.is_active AS user_active,
       (SELECT COUNT(*) FROM contracts x WHERE x.employee_id = e.id) AS contract_count,
       (SELECT COUNT(*) FROM attendance x WHERE x.employee_id = e.id
          AND x.day >= date_trunc('month', CURRENT_DATE)::date) AS attendance_this_month,
       (SELECT COUNT(*) FROM time_off_requests x WHERE x.employee_id = e.id AND x.status = 'TO_APPROVE') AS time_off_pending,
       (SELECT COUNT(*) FROM payslips x WHERE x.employee_id = e.id AND x.status = 'PAID') AS payslip_count,
       (e.bank_account_number IS NULL OR e.bank_account_number = '') AS missing_bank,
       (e.working_schedule_id IS NULL AND c.working_schedule_id IS NULL) AS missing_schedule
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
LEFT JOIN employees m ON m.id = e.manager_id
LEFT JOIN working_schedules s ON s.id = e.working_schedule_id
LEFT JOIN LATERAL (SELECT * FROM contracts c0 WHERE c0.employee_id = e.id AND c0.status='RUNNING'
                     AND c0.start_date <= CURRENT_DATE AND (c0.end_date IS NULL OR c0.end_date >= CURRENT_DATE)
                   ORDER BY c0.is_primary DESC NULLS LAST, c0.start_date DESC LIMIT 1) c ON true
LEFT JOIN salary_structures st ON st.id = c.salary_structure_id
LEFT JOIN users u ON u.id = e.user_id;

CREATE VIEW v_contract_list AS
SELECT c.id, c.contract_number, e.id AS employee_id, e.name AS employee, e.employee_code,
       d.name AS department, c.job_position, c.wage, c.start_date, c.end_date, c.status, c.is_primary,
       s.name AS salary_structure, w.name AS working_schedule, w.total_weekly_hours,
       (c.end_date IS NOT NULL AND c.end_date < CURRENT_DATE) AS is_expired
FROM contracts c
JOIN employees e ON e.id = c.employee_id
LEFT JOIN departments d ON d.id = c.department_id
LEFT JOIN salary_structures s ON s.id = c.salary_structure_id
LEFT JOIN working_schedules w ON w.id = c.working_schedule_id;

CREATE VIEW v_timeoff_balance AS
SELECT a.id, e.id AS employee_id, e.name AS employee, e.employee_code, t.id AS time_off_type_id,
       t.name AS type, t.unit, a.allocated_days, a.taken_days, a.pending_days, a.remaining_days,
       a.valid_from, a.valid_until, a.status, t.requires_allocation
FROM time_off_allocations a
JOIN employees e ON e.id = a.employee_id
JOIN time_off_types t ON t.id = a.time_off_type_id;

CREATE VIEW v_payslip_list AS
SELECT p.id, p.period_key, p.period_start, p.period_end, p.payslip_kind, p.status,
       p.gross_amount, p.total_deductions, p.total_adjustments, p.net_amount, p.ytd_net,
       p.worked_days, p.paid_days, p.absent_days, p.leave_days, p.unpaid_leave_days,
       p.overtime_hours, p.expected_working_days, p.pro_rata_factor,
       p.released_at, p.document_version, p.pdf_hash, p.pdf_generated_at, p.email_status,
       p.download_count, p.last_download_at,
       p.employee_id, e.name AS employee, e.employee_code, e.work_email,
       d.name AS department, r.id AS payrun_id, r.name AS payrun, r.status AS payrun_status,
       st.name AS salary_structure, c.wage AS contract_wage,
       (e.bank_account_number IS NULL OR e.bank_account_number = '') AS missing_bank
FROM payslips p
JOIN employees e ON e.id = p.employee_id
LEFT JOIN departments d ON d.id = e.department_id
JOIN payruns r ON r.id = p.payrun_id
LEFT JOIN salary_structures st ON st.id = p.salary_structure_id
LEFT JOIN contracts c ON c.id = p.contract_id;

CREATE VIEW v_payrun_summary AS
SELECT r.id, r.name, r.period_key, r.period_start, r.period_end, r.status, r.pay_frequency, r.compute_mode,
       r.salary_structure_id, st.name AS salary_structure, r.month_anchor, r.employee_type_filter, r.department_filter,
       r.computed_at, r.validated_at, r.validated_by, r.locked_at, r.paid_by, r.notes,
       r.employee_count, r.payslip_count,
       r.total_gross, r.total_deductions, r.total_net, r.employer_cost, r.warning_count, r.error_count,
       r.created_at, r.paid_at, r.sent_at, u.name AS created_by,
       (SELECT COUNT(*) FROM payslips p WHERE p.payrun_id = r.id) AS payslips,
       (SELECT COUNT(*) FROM email_deliveries m WHERE m.payrun_id = r.id AND m.status='SENT') AS emails_sent,
       (SELECT COUNT(*) FROM email_deliveries m WHERE m.payrun_id = r.id AND m.status IN ('FAILED','BOUNCED')) AS emails_failed
FROM payruns r
JOIN salary_structures st ON st.id = r.salary_structure_id
LEFT JOIN users u ON u.id = r.created_by;

CREATE VIEW v_department_overview AS
SELECT d.id AS department_id, d.name AS department,
       COUNT(e.id) FILTER (WHERE e.status = 'ACTIVE') AS headcount,
       COALESCE(SUM(c.wage) FILTER (WHERE e.status='ACTIVE'), 0) AS monthly_wage_cost
FROM departments d
LEFT JOIN employees e ON e.department_id = d.id
LEFT JOIN LATERAL (SELECT wage FROM contracts cc WHERE cc.employee_id = e.id AND cc.status='RUNNING'
                     AND cc.start_date <= CURRENT_DATE AND (cc.end_date IS NULL OR cc.end_date >= CURRENT_DATE)
                   ORDER BY cc.is_primary DESC NULLS LAST LIMIT 1) c ON true
GROUP BY d.id, d.name;

CREATE VIEW v_salary_trend AS
SELECT date_trunc('month', p.month_anchor)::date AS month,
       SUM(p.net_amount) AS net_salary, SUM(p.gross_amount) AS gross_salary, COUNT(*) AS payslips
FROM payslips p WHERE p.status = 'PAID'
GROUP BY 1 ORDER BY 1;

CREATE VIEW v_attendance_monthly AS
SELECT e.id AS employee_id, e.name AS employee, date_trunc('month', a.day)::date AS month,
       COUNT(*) FILTER (WHERE a.status IN ('PRESENT','LATE','OVERTIME','HALF_DAY')) AS present,
       COUNT(*) FILTER (WHERE a.status = 'ABSENT') AS absent,
       COUNT(*) FILTER (WHERE a.status = 'LATE') AS late,
       COUNT(*) FILTER (WHERE a.status = 'ON_LEAVE') AS on_leave,
       COUNT(*) FILTER (WHERE a.status = 'OVERTIME') AS overtime,
       COALESCE(SUM(a.overtime_hours) FILTER (WHERE a.overtime_approved), 0) AS overtime_hours,
       COUNT(*) FILTER (WHERE a.check_in IS NOT NULL AND a.check_out IS NULL) AS missing_checkout,
       COUNT(*) FILTER (WHERE a.is_manual) AS manual_edits,
       COALESCE(SUM(a.worked_hours), 0) AS worked_hours
FROM attendance a JOIN employees e ON e.id = a.employee_id
GROUP BY 1,2,3;
