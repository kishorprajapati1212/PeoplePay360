-- Worked hours are derived by the service layer (testable, explainable), not by a BEFORE trigger
-- that would overwrite HR corrections. See docs/06 finding #2/#3.
CREATE TABLE attendance (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  day               date NOT NULL,
  check_in          timestamptz,
  check_out         timestamptz,
  worked_hours      numeric(6,2),                  -- raw clock time (matches mockup: 09:05→18:10 = 9.08)
  net_worked_hours  numeric(6,2),                  -- worked_hours - break_minutes
  break_minutes     integer NOT NULL DEFAULT 0,
  expected_hours    numeric(6,2) NOT NULL DEFAULT 0,
  overtime_hours    numeric(6,2) NOT NULL DEFAULT 0,
  status            attendance_status NOT NULL DEFAULT 'PRESENT',
  is_manual         boolean NOT NULL DEFAULT false,
  manual_reason     text,
  edited_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  edited_at         timestamptz,
  overtime_approved boolean NOT NULL DEFAULT false,
  overtime_approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  overtime_approved_at timestamptz,
  source            text NOT NULL DEFAULT 'self',   -- self | hr | device | seed
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, day),
  CONSTRAINT ck_att_hours CHECK (worked_hours IS NULL OR (worked_hours >= 0 AND worked_hours <= 24))
);
CREATE INDEX idx_att_day ON attendance(day);
CREATE INDEX idx_att_emp_day ON attendance(employee_id, day DESC);
CREATE INDEX idx_att_status ON attendance(status);

CREATE VIEW v_attendance_exceptions AS
SELECT a.*, e.name AS employee_name, e.employee_code,
  (a.check_in IS NOT NULL AND a.check_out IS NULL)                          AS missing_checkout,
  (a.check_in IS NULL AND a.check_out IS NOT NULL)                          AS missing_checkin,
  (a.expected_hours > 0 AND a.net_worked_hours < a.expected_hours)          AS short_day,
  (a.overtime_hours > 0 AND NOT a.overtime_approved)                        AS ot_pending,
  (a.status = 'ABSENT' AND a.check_in IS NULL AND a.check_out IS NULL)      AS absent
FROM attendance a JOIN employees e ON e.id = a.employee_id;
