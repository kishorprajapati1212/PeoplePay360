CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Single-row config table: every payroll policy lives here, never hardcoded in code.
CREATE TABLE company_settings (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
  company_name          text NOT NULL DEFAULT 'OXP Pvt Ltd',
  legal_name            text NOT NULL DEFAULT 'OXP Private Limited',
  address               text  NOT NULL DEFAULT 'GIFT City, Gandhinagar',
  city                  text  NOT NULL DEFAULT 'Ahmedabad',
  state                 text  NOT NULL DEFAULT 'Gujarat',
  postal_code           text  NOT NULL DEFAULT '382310',
  country               text  NOT NULL DEFAULT 'India',
  timezone              text  NOT NULL DEFAULT 'Asia/Kolkata',
  currency              text  NOT NULL DEFAULT 'INR',
  currency_symbol       text  NOT NULL DEFAULT '₹',
  fiscal_year_start_month smallint NOT NULL DEFAULT 4 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  payroll_day_basis     day_basis NOT NULL DEFAULT 'ACTUAL_WORKING_DAYS',
  default_hours_per_day numeric(4,2) NOT NULL DEFAULT 8,
  overtime_multiplier   numeric(4,2) NOT NULL DEFAULT 1.5,
  round_net_to_rupee    boolean NOT NULL DEFAULT false,
  sandwich_rule         boolean NOT NULL DEFAULT false,
  pf_enabled            boolean NOT NULL DEFAULT true,
  pf_employee_pct       numeric(5,2) NOT NULL DEFAULT 12,
  pf_employer_pct       numeric(5,2) NOT NULL DEFAULT 12,
  pf_wage_ceiling       numeric(14,2) NOT NULL DEFAULT 15000,
  esi_enabled           boolean NOT NULL DEFAULT true,
  esi_employee_pct      numeric(5,2) NOT NULL DEFAULT 0.75,
  esi_employer_pct      numeric(5,2) NOT NULL DEFAULT 3.25,
  esi_wage_limit        numeric(14,2) NOT NULL DEFAULT 21000,
  pt_enabled            boolean NOT NULL DEFAULT true,
  pt_monthly            numeric(14,2) NOT NULL DEFAULT 200,
  pt_annual_cap         numeric(14,2) NOT NULL DEFAULT 2500,
  pt_charge_slice       text NOT NULL DEFAULT 'HALF_SECOND',   -- MONTH_ONCE rules land here
  pt_state              text,                                -- PT slab state; defaults to `state`
  advance_percentage    numeric(5,2) NOT NULL DEFAULT 50 CHECK (advance_percentage > 0 AND advance_percentage <= 100),
  overtime_round_to     numeric(4,2) NOT NULL DEFAULT 0.25,
  overtime_min_hours    numeric(4,2) NOT NULL DEFAULT 0.5,
  allow_negative_net    boolean NOT NULL DEFAULT false,        -- else carry as arrear
  payslip_footer        text  NOT NULL DEFAULT 'System generated payslip. No signature required.',
  mail_from             text  NOT NULL DEFAULT 'OXP Payroll <payroll@oxp.com>',
  mail_daily_limit      integer NOT NULL DEFAULT 200,
  document_retention_years integer NOT NULL DEFAULT 8,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO company_settings(id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  code        text UNIQUE,
  manager_id  uuid,                                  -- FK to employees added in 003
  parent_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE working_schedules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  type                schedule_type NOT NULL DEFAULT 'FIXED',
  company_name        text NOT NULL DEFAULT 'OXP Pvt Ltd',
  timezone            text NOT NULL DEFAULT 'Company Timezone',
  total_weekly_hours  numeric(6,2) NOT NULL DEFAULT 0,   -- derived from days (trigger in 010)
  days_per_week       smallint NOT NULL DEFAULT 0,        -- derived
  is_active           record_status NOT NULL DEFAULT 'ACTIVE',
  description         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- Mockup Form view is a repeating "Weekly Schedule" grid with + Add Day / x per row.
CREATE TABLE working_schedule_days (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   uuid NOT NULL REFERENCES working_schedules(id) ON DELETE CASCADE,
  day_of_week   smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),   -- ISO: 1=Mon .. 7=Sun
  start_time    time,
  end_time      time,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes >= 0 AND break_minutes < 1440),
  is_rest_day   boolean NOT NULL DEFAULT false,
  note          text,
  UNIQUE (schedule_id, day_of_week, start_time)
);

CREATE TABLE holiday_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  month        smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  day          smallint NOT NULL CHECK (day BETWEEN 1 AND 31),
  type         text NOT NULL DEFAULT 'PUBLIC' CHECK (type IN ('PUBLIC','COMPANY','OPTIONAL')),
  is_recurring boolean NOT NULL DEFAULT true,
  UNIQUE (name, month, day)
);
CREATE TABLE holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day         date NOT NULL UNIQUE,
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'PUBLIC' CHECK (type IN ('PUBLIC','COMPANY','OPTIONAL')),
  year        int  NOT NULL,
  template_id uuid REFERENCES holiday_templates(id) ON DELETE SET NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- users: one login per person; role is the *primary* role, extra roles live in user_role_grants.
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  work_email     text NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  role           user_role NOT NULL DEFAULT 'EMPLOYEE',
  is_active      boolean NOT NULL DEFAULT true,
  must_change_pw boolean NOT NULL DEFAULT false,
  token_version  integer NOT NULL DEFAULT 1,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_role_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        user_role NOT NULL,
  granted_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  family_id   uuid NOT NULL,
  user_agent  text,
  ip          text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
