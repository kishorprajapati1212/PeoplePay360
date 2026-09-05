CREATE TABLE payruns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  period_key          text NOT NULL,                       -- '2026-02' | '2026-02-H1' | '2026-02-C10-09'
  salary_structure_id uuid NOT NULL REFERENCES salary_structures(id) ON DELETE RESTRICT,
  period_start        date NOT NULL,
  period_end          date NOT NULL,
  month_anchor        date NOT NULL,                       -- first day of the calendar month this run belongs to
  pay_frequency       pay_frequency NOT NULL DEFAULT 'MONTHLY',
  compute_mode        compute_mode NOT NULL DEFAULT 'PRO_RATA',
  employee_type_filter employee_type,
  department_filter   uuid REFERENCES departments(id) ON DELETE SET NULL,
  status              payrun_status NOT NULL DEFAULT 'DRAFT',
  total_gross         numeric(16,2) NOT NULL DEFAULT 0,
  total_deductions    numeric(16,2) NOT NULL DEFAULT 0,
  total_net           numeric(16,2) NOT NULL DEFAULT 0,
  employer_cost       numeric(16,2) NOT NULL DEFAULT 0,
  employee_count      integer NOT NULL DEFAULT 0,
  payslip_count       integer NOT NULL DEFAULT 0,
  warning_count       integer NOT NULL DEFAULT 0,
  error_count         integer NOT NULL DEFAULT 0,
  computed_at         timestamptz,
  validated_at        timestamptz,
  validated_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  paid_at             timestamptz,
  paid_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  locked_at           timestamptz,
  sent_at             timestamptz,
  sent_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key     text,
  notes               text,
  created_by          uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (salary_structure_id, period_key),
  CONSTRAINT ck_payrun_period CHECK (period_end >= period_start)
);
CREATE INDEX idx_payrun_period ON payruns(month_anchor DESC, status);

CREATE TABLE payrun_employees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payrun_id     uuid NOT NULL REFERENCES payruns(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  is_selected   boolean NOT NULL DEFAULT true,
  compute_status compute_status NOT NULL DEFAULT 'PENDING',
  error_code    text,
  error_message text,
  payslip_id    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payrun_id, employee_id)
);

CREATE TABLE payslips (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payrun_id           uuid NOT NULL REFERENCES payruns(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  contract_id         uuid REFERENCES contracts(id) ON DELETE RESTRICT,
  salary_structure_id uuid REFERENCES salary_structures(id) ON DELETE RESTRICT,
  period_start        date NOT NULL,
  period_end          date NOT NULL,
  period_key          text NOT NULL,
  payslip_kind        payslip_kind NOT NULL DEFAULT 'MONTHLY',
  month_anchor        date NOT NULL,
  -- period facts (what the payslip was computed from; kept for auditability)
  expected_working_days integer NOT NULL DEFAULT 0,
  paid_days           integer NOT NULL DEFAULT 0,
  worked_days         integer NOT NULL DEFAULT 0,
  half_days           integer NOT NULL DEFAULT 0,
  leave_days          integer NOT NULL DEFAULT 0,
  unpaid_leave_days   integer NOT NULL DEFAULT 0,
  absent_days         integer NOT NULL DEFAULT 0,
  holiday_days        integer NOT NULL DEFAULT 0,
  worked_hours        numeric(8,2) NOT NULL DEFAULT 0,
  overtime_hours      numeric(8,2) NOT NULL DEFAULT 0,
  pro_rata_factor     numeric(8,6) NOT NULL DEFAULT 1,
  -- money
  gross_amount        numeric(16,2) NOT NULL DEFAULT 0,
  total_deductions    numeric(16,2) NOT NULL DEFAULT 0,
  total_adjustments   numeric(16,2) NOT NULL DEFAULT 0,
  net_amount          numeric(16,2) NOT NULL DEFAULT 0,
  employer_cost       numeric(16,2) NOT NULL DEFAULT 0,
  ytd_gross           numeric(16,2) NOT NULL DEFAULT 0,
  ytd_deductions      numeric(16,2) NOT NULL DEFAULT 0,
  ytd_net             numeric(16,2) NOT NULL DEFAULT 0,
  status              payslip_status NOT NULL DEFAULT 'DRAFT',
  document_version    integer NOT NULL DEFAULT 1,
  released_at         timestamptz,
  paid_at             timestamptz,
  pdf_path            text,
  pdf_hash            text,
  pdf_generated_at    timestamptz,
  email_status        delivery_status NOT NULL DEFAULT 'QUEUED',
  last_download_at    timestamptz,
  download_count      integer NOT NULL DEFAULT 0,
  reconciled_from     uuid REFERENCES payslips(id) ON DELETE SET NULL,
  computation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payrun_id, employee_id),
  CONSTRAINT ck_payslip_period CHECK (period_end >= period_start)
);
CREATE INDEX idx_payslip_emp_period ON payslips(employee_id, month_anchor DESC);
CREATE UNIQUE INDEX uq_payslip_one_per_kind ON payslips(employee_id, period_key) WHERE status <> 'VOID';
CREATE INDEX idx_payslip_status ON payslips(status);

CREATE TABLE payslip_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payslip_id      uuid NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
  salary_rule_id  uuid REFERENCES salary_rules(id) ON DELETE SET NULL,
  rule_code       text NOT NULL,
  rule_name       text NOT NULL,
  category        rule_category NOT NULL,
  line_kind       line_kind NOT NULL DEFAULT 'EARNING',
  sequence        integer NOT NULL,
  amount          numeric(16,2) NOT NULL DEFAULT 0,   -- magnitude for EARNING/DEDUCTION, signed for ADJUSTMENT
  quantity        numeric(10,4),
  base_amount     numeric(16,2),
  is_hidden       boolean NOT NULL DEFAULT false,
  computation_log text,                               -- "50000 / 20 × 19 = 47500.00" (Odoo-style trace)
  ref_payslip_id  uuid REFERENCES payslips(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payslip_id, sequence)
);
ALTER TABLE payslip_lines ADD COLUMN amount_signed numeric(16,2) GENERATED ALWAYS AS (
  CASE WHEN line_kind = 'DEDUCTION' THEN -amount ELSE amount END
) STORED;
CREATE INDEX idx_psl_lines_payslip ON payslip_lines(payslip_id, sequence);

CREATE TABLE payslip_inputs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payslip_id  uuid NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  amount      numeric(16,2) NOT NULL,
  reason      text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payslip_id, code)
);

-- Negative-net / late-data reconciliation: carried into the next run as an ARREAR payslip line.
CREATE TABLE payslip_arrears (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month_anchor  date NOT NULL,
  rule_code     text NOT NULL DEFAULT 'ARREAR',
  amount        numeric(16,2) NOT NULL,                 -- signed: + pays more, - recovers
  reason        text NOT NULL,
  from_payslip  uuid REFERENCES payslips(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'CARRIED' CHECK (status IN ('CARRIED','APPLIED','WAIVED')),
  applied_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payslip_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payslip_id    uuid NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
  kind          document_kind NOT NULL DEFAULT 'PAYSLIP',
  version       integer NOT NULL DEFAULT 1,
  storage_path  text NOT NULL,
  bytes         integer NOT NULL DEFAULT 0,
  sha256        text NOT NULL,
  renderer      text NOT NULL DEFAULT 'pdfkit',
  generated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payslip_id, kind, version)
);
CREATE TABLE payslip_downloads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payslip_id  uuid NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
  actor_user  uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role  user_role,
  via         download_channel NOT NULL DEFAULT 'PORTAL',
  ip          text,
  user_agent  text,
  version     integer NOT NULL DEFAULT 1,
  sha256      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dl_payslip ON payslip_downloads(payslip_id, created_at DESC);
