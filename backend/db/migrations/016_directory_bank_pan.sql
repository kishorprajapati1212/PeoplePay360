-- The payroll validator reads the employee through v_employee_directory, which never selected
-- bank_account_number or pan_number — so every computed payslip warned "No bank account on file" and
-- "PAN is missing" for people who had both. The new columns sit where the readers expect them.
-- CREATE OR REPLACE refuses because the column list changes mid-view, so this is DROP + CREATE —
-- safe here: the only dependency in the database is the view's own rewrite rule (checked), and
-- permissions are granted by role DDL in an earlier migration, not on this view.
DROP VIEW IF EXISTS v_employee_directory;
CREATE VIEW v_employee_directory AS
SELECT e.id, e.employee_code, e.name, e.work_email, e.phone, e.job_position, e.employee_type, e.status,
       e.date_of_joining, e.date_of_exit, e.work_location, e.basic_salary,
       e.bank_account_number, e.bank_ifsc, e.bank_name, e.pan_number, e.uan_number, e.esi_number,
       e.city, e.state, e.gender,
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
