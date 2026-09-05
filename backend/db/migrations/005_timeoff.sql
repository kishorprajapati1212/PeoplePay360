CREATE TABLE time_off_types (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL UNIQUE,
  code                  text NOT NULL UNIQUE,
  unit                  time_off_unit NOT NULL DEFAULT 'DAYS',
  requires_allocation   boolean NOT NULL DEFAULT true,
  max_days_per_year     integer,
  approval_route        approval_route NOT NULL DEFAULT 'MANAGER',
  -- payroll link: this is what turns an approved leave into Loss of Pay (mockup "Payroll / Work Entry")
  work_entry_type       text NOT NULL DEFAULT 'Leave Work Entry',
  is_unpaid             boolean NOT NULL DEFAULT false,
  payslip_code          text,
  is_encashable         boolean NOT NULL DEFAULT false,
  carry_forward         boolean NOT NULL DEFAULT false,
  sandwich_rule         boolean NOT NULL DEFAULT false,
  min_notice_days       smallint NOT NULL DEFAULT 0,
  display_color         text NOT NULL DEFAULT 'Blue',
  is_active             record_status NOT NULL DEFAULT 'ACTIVE',
  description           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE time_off_allocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  time_off_type_id  uuid NOT NULL REFERENCES time_off_types(id) ON DELETE CASCADE,
  allocated_days    numeric(7,2) NOT NULL DEFAULT 0,
  taken_days        numeric(7,2) NOT NULL DEFAULT 0,
  pending_days      numeric(7,2) NOT NULL DEFAULT 0,
  remaining_days    numeric(7,2) NOT NULL DEFAULT 0,
  valid_from        date NOT NULL,
  valid_until       date NOT NULL,
  status            request_status NOT NULL DEFAULT 'TO_APPROVE',
  requested_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  description       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, time_off_type_id, valid_from),
  CONSTRAINT ck_alloc_window CHECK (valid_until >= valid_from),
  CONSTRAINT ck_alloc_math   CHECK (remaining_days = allocated_days - taken_days),
  CONSTRAINT ck_alloc_never_negative CHECK (remaining_days >= 0 AND taken_days >= 0 AND pending_days >= 0)
);
CREATE INDEX idx_alloc_emp ON time_off_allocations(employee_id, time_off_type_id);

CREATE TABLE time_off_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  time_off_type_id  uuid NOT NULL REFERENCES time_off_types(id) ON DELETE CASCADE,
  allocation_id     uuid REFERENCES time_off_allocations(id) ON DELETE SET NULL,
  start_date        date NOT NULL,
  end_date          date NOT NULL,
  duration          numeric(7,2) NOT NULL,              -- in the type's unit
  duration_unit     time_off_unit NOT NULL DEFAULT 'DAYS',
  work_days         numeric(7,2) NOT NULL DEFAULT 0,    -- expected days inside the range (excl. weekends/holidays)
  half_day_period   text CHECK (half_day_period IN ('MORNING','AFTERNOON') OR half_day_period IS NULL),
  approved_days     numeric(7,2),
  reason            text,
  status            request_status NOT NULL DEFAULT 'TO_APPROVE',
  requested_by      uuid NOT NULL REFERENCES users(id),
  approved_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  refuse_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_to_dates CHECK (end_date >= start_date)
);
CREATE INDEX idx_to_req_emp ON time_off_requests(employee_id, start_date DESC);
CREATE INDEX idx_to_req_status ON time_off_requests(status);
-- Balance math lives in services/leave-balance.service.js (single transaction, reversible, partial-approval aware).
