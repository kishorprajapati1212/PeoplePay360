CREATE TABLE salary_structures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  code        text UNIQUE,
  description text,
  is_active   record_status NOT NULL DEFAULT 'ACTIVE',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE contracts ADD CONSTRAINT fk_contract_structure
  FOREIGN KEY (salary_structure_id) REFERENCES salary_structures(id) ON DELETE RESTRICT;

CREATE TABLE salary_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salary_structure_id uuid NOT NULL REFERENCES salary_structures(id) ON DELETE CASCADE,
  name                text NOT NULL,
  code                text NOT NULL,
  category            rule_category NOT NULL,
  line_kind           line_kind NOT NULL DEFAULT 'EARNING',
  sequence            integer NOT NULL,
  computation_type    computation_type NOT NULL DEFAULT 'FIXED',
  amount              numeric(14,4),          -- FIXED amount, or percentage value when PERCENTAGE
  percentage          numeric(7,4),           -- explicit % (PERCENTAGE)
  base_code           text,                   -- what the % applies to: BASIC | GROSS | CONTRACT_WAGE | <rule code>
  formula             text,                   -- FORMULA expression (parsed, never eval'd)
  condition_expr      text,                   -- e.g. "overtime_hours > 0"
  quantity_expr       text,                   -- e.g. "paid_days" (per-day allowances)
  pro_rata            boolean NOT NULL DEFAULT true,
  evaluation_period   evaluation_period NOT NULL DEFAULT 'PERIOD',
  cap_amount          numeric(14,2),
  annual_cap          numeric(14,2),
  rounding_mode       text NOT NULL DEFAULT 'half_up' CHECK (rounding_mode IN ('half_up','down','up')),
  is_taxable          boolean NOT NULL DEFAULT true,
  is_report_only      boolean NOT NULL DEFAULT false,   -- GROSS/NET echo lines: printed, never summed
  appears_on_payslip  boolean NOT NULL DEFAULT true,
  appears_in_report   boolean NOT NULL DEFAULT true,
  statutory           boolean NOT NULL DEFAULT false,
  depends_on          text[] NOT NULL DEFAULT '{}',
  active_from         date NOT NULL DEFAULT '1900-01-01',
  active_to           date,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (salary_structure_id, code),
  UNIQUE (salary_structure_id, sequence)
);
CREATE INDEX idx_rule_struct ON salary_rules(salary_structure_id, sequence);

-- State-slab table for Professional Tax (data, not code).
CREATE TABLE pt_slabs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state          text NOT NULL DEFAULT 'Gujarat',
  wage_from      numeric(14,2) NOT NULL DEFAULT 0,
  wage_to        numeric(14,2),
  monthly_amount numeric(14,2) NOT NULL,
  effective_from date NOT NULL DEFAULT '2026-04-01',
  effective_to   date,
  UNIQUE (state, wage_from, effective_from)
);
