CREATE SEQUENCE employee_code_seq START 1;

CREATE TABLE employees (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  employee_code       text NOT NULL UNIQUE DEFAULT ('EMP' || lpad(nextval('employee_code_seq')::text, 4, '0')),
  name                text NOT NULL,
  work_email          text NOT NULL,
  phone               text,
  gender              text,
  date_of_birth       date,
  address             text,
  city                text,
  state               text,
  pincode             text,
  work_location       text NOT NULL DEFAULT 'Ahmedabad',
  department_id       uuid REFERENCES departments(id) ON DELETE SET NULL,
  manager_id          uuid REFERENCES employees(id) ON DELETE SET NULL,
  job_position        text,
  employee_type       employee_type NOT NULL DEFAULT 'FULL_TIME',
  working_schedule_id uuid REFERENCES working_schedules(id) ON DELETE SET NULL,
  date_of_joining     date NOT NULL,
  date_of_exit        date,
  status              employee_status NOT NULL DEFAULT 'ACTIVE',
  employment_tag      text,
  -- payroll identity
  basic_salary        numeric(14,2),
  bank_account_number text,
  bank_ifsc           text,
  bank_name           text,
  pan_number          text,
  uan_number          text,
  esi_number          text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_emp_dates CHECK (date_of_exit IS NULL OR date_of_exit >= date_of_joining),
  CONSTRAINT ck_emp_salary CHECK (basic_salary IS NULL OR basic_salary >= 0)
);
CREATE UNIQUE INDEX uq_emp_email ON employees (lower(work_email)) WHERE status <> 'TERMINATED';
CREATE INDEX idx_emp_dept ON employees(department_id);
CREATE INDEX idx_emp_manager ON employees(manager_id);
CREATE INDEX idx_emp_status ON employees(status);
CREATE INDEX idx_emp_search ON employees USING gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(work_email,'') || ' ' || employee_code));

-- Contracts: history is preserved; payroll selects by DATE RANGE, never by status (design finding 06#5).
CREATE TABLE contracts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  contract_number     text NOT NULL UNIQUE DEFAULT ('CT' || lpad(nextval('employee_code_seq')::text, 4, '0')),
  start_date          date NOT NULL,
  end_date            date,
  department_id       uuid REFERENCES departments(id) ON DELETE SET NULL,
  job_position        text,
  wage                numeric(14,2) NOT NULL,                -- monthly basic wage
  salary_structure_id uuid NOT NULL,                         -- FK added after 006
  working_schedule_id uuid REFERENCES working_schedules(id) ON DELETE SET NULL,
  status              contract_status NOT NULL DEFAULT 'DRAFT',
  is_primary          boolean NOT NULL DEFAULT false,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_contract_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT ck_contract_wage  CHECK (wage >= 0)
);
CREATE INDEX idx_contract_emp ON contracts(employee_id, start_date DESC);
-- "An employee should not have multiple Running contracts for the same period."
CREATE UNIQUE INDEX uq_contract_one_running ON contracts(employee_id) WHERE status = 'RUNNING';
CREATE UNIQUE INDEX uq_contract_one_primary ON contracts(employee_id) WHERE is_primary;

ALTER TABLE departments ADD CONSTRAINT fk_dept_manager FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL;
