# 06 — Review of `uploads/schema.md`: 24 concrete defects + required additions

Every finding is checked against the file as written. Severity: **🔴 blocks the payroll math / demo**,
**🟠 will bite**, **🟡 polish**. "Evidence" quotes your doc so you can find it.

---

## 🔴 1. Night-shift hours go negative (two places)

**Evidence** `calc_weekly_hours()` does `EXTRACT(EPOCH FROM (mon_end - mon_start))/3600 - break/60`;
`api.md` §4 creates a Night Shift with `mon_start 22:00, mon_end 06:00` and expects `40.00`.

`06:00 - 22:00 = -16 h`, so that schedule yields **-16 h/day ≈ -106 h/week**, not 8 h/day.

```sql
-- helper used by both triggers
CREATE OR REPLACE FUNCTION day_hours(p_start time, p_end time, p_break int)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_start IS NULL OR p_end IS NULL THEN 0
         ELSE GREATEST(0,
              (EXTRACT(EPOCH FROM (p_end - p_start))
               + CASE WHEN p_end <= p_start THEN 86400 ELSE 0 END   -- wrap past midnight
              )/3600.0 - COALESCE(p_break,0)/60.0)
  END;
$$;
```
Then `total_weekly_hours := day_hours(NEW.mon_start, NEW.mon_end, NEW.mon_break_minutes) + …`.

## 🔴 2. `calc_attendance` corrupts worked hours for the same reason

`worked_hours := EXTRACT(EPOCH FROM (check_out - check_in))/3600` → a 22:00→06:00 shift gives
**-16**. Also breaks aren't subtracted, so a 09:00→18:30 day with a 1 h break is recorded as 9.5 h
worked against 8 h expected → 1.5 h of phantom **overtime pay**. Your `api.md` §5 literally shows this
(`check_in 08:45`, `check_out 18:30`, `worked_hours 9.75`, `overtime 1.75`).

```sql
v_worked := (EXTRACT(EPOCH FROM (NEW.check_out - NEW.check_in))/3600.0)
            - COALESCE(v_break_minutes,0)/60.0;
IF v_worked < 0 THEN v_worked := v_worked + 24;      -- crossed midnight
IF v_worked < 0 THEN RAISE EXCEPTION 'check_out before check_in';  -- or clamp+flag
NEW.worked_hours := round(GREATEST(0, LEAST(v_worked, 24)), 2);
```
Also decide and document: does `worked_hours` include the break? (Pick **excluded**, and store
`break_minutes` on the row so the number is explainable on the payslip.)

## 🔴 3. The attendance trigger overwrites statuses nobody asked it to

It's `BEFORE INSERT OR UPDATE` and unconditional whenever both timestamps exist, so:
- an `ON_LEAVE`/`HOLIDAY` row that happens to have hours (employee worked during leave) is flipped to
  `PRESENT`;
- an HR manual correction (`PUT /attendance/:id`) has its status silently recomputed, and `is_manual`
  becomes a lie;
- a row with **only** a check-in falls through the `IF` and keeps `DEFAULT 'ABSENT'` — so "forgot to
  check out" is recorded as absent, and the dashboard's "missing check-outs" metric (required by
  B9 in the PDF) can't be distinguished from genuine absence.

Fix: compute derived fields in the trigger, but **only set `status` when it wasn't explicitly
provided or when `is_manual = false`**, and add the missing-checkout signal:

```sql
-- status only when not a manual row
IF COALESCE(NEW.is_manual,false) = false THEN
   NEW.status := CASE
     WHEN NEW.check_in IS NOT NULL AND NEW.check_out IS NULL THEN 'PRESENT'  -- see below
     WHEN v_worked >= v_expected THEN (CASE WHEN NEW.overtime_hours>0 AND NEW.overtime_approved
                                            THEN 'OVERTIME' ELSE 'PRESENT' END)
     WHEN v_worked >= v_expected*0.5 THEN 'HALF_DAY'
     WHEN v_worked > 0 THEN 'LATE'
     ELSE 'ABSENT' END;
END IF;
```
plus a **view** instead of a fake status (cleaner, and it's what the dashboard aggregates):

```sql
CREATE VIEW vw_attendance_exceptions AS
SELECT a.*, (a.check_in IS NOT NULL AND a.check_out IS NULL)               AS missing_checkout,
       a.expected_hours > 0 AND COALESCE(a.worked_hours,0) < a.expected_hours
         AND a.status IN ('PRESENT','LATE')                                 AS short_day
FROM attendance a;
```

## 🔴 4. Overtime explodes for employees with no schedule

`v_expected` is derived from `employees.working_schedule_id`; if it's NULL the `CASE` yields NULL →
`COALESCE(v_expected,0)` → `expected_hours = 0` → **every worked hour becomes overtime**, and any OT
rule then pays it. Also it ignores `contracts.working_schedule_id`, which the spec says can be set at
contract level ("Assign working schedules to employees **or** contracts").

Fix: `v_expected := COALESCE(contract_schedule_hours, employee_schedule_hours, 8)` and add
`CHECK (expected_hours > 0)`-style *validation in the service layer* that returns
`NO_SCHEDULE_FOR_PERIOD` — a warning-worthy condition, not silent OT money.

## 🔴 5. Contract selection by `status='ACTIVE'` breaks retroactive/period payroll

`schema.md` §5 "Why": *"Payroll picks the contract where `start_date <= payrun_period <= end_date` and
`status='ACTIVE'`."* Those two conditions contradict each other for any **past** period: after the new
contract is created the old one is flipped to `EXPIRED` (your own `api.md` §3 side effect), so a
correct-on-today query **cannot** compute last month's payslip, and half-month/arrear runs are impossible.

Fix — the only rule payroll should use is date-based:

```sql
CREATE OR REPLACE FUNCTION contract_for_period(p_emp uuid, p_from date, p_to date)
RETURNS contracts LANGUAGE sql STABLE AS $$
  SELECT c.* FROM contracts c
  WHERE c.employee_id = p_emp
    AND c.status <> 'DRAFT'
    AND c.start_date <= p_to
    AND (c.end_date IS NULL OR c.end_date >= p_from)
  ORDER BY c.is_primary DESC NULLS LAST, c.start_date DESC
  LIMIT 1;
$$;
```
And expose overlap detection separately (`AMBIGUOUS_CONTRACT`). Keep `status` for *UI*, never for
*selection*. **This is the single highest-value schema change in this document.**

## 🔴 6. `contracts.salary_structure_id` has no foreign key — and the DDL can't even run

```sql
salary_structure_id UUID NOT NULL,        -- ← no REFERENCES
```
Two problems: (a) no referential integrity, so a typo'd structure id silently breaks payroll;
(b) `contracts` is defined in §5 but `salary_structures` in §9 → running the doc as a script fails.
Add `REFERENCES salary_structures(id) ON DELETE RESTRICT` and **order migrations as: enums →
users → departments → working_schedules → salary_structures → employees → contracts → …**

## 🔴 7. The one-active-contract rule is documented but not implemented

§14 promises `UNIQUE(employee_id) WHERE status='ACTIVE'`; the DDL has no such index, and `is_primary`
is unconstrained. Also `status` defaults to `'DRAFT'` while the API claims the created contract is
`ACTIVE` — contradiction. Implement:

```sql
CREATE UNIQUE INDEX uq_contract_one_active ON contracts(employee_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_contract_one_primary ON contracts(employee_id) WHERE is_primary;
ALTER TABLE contracts ADD CONSTRAINT ck_contract_dates CHECK (end_date IS NULL OR end_date >= start_date);
```
and make `POST /contracts` a single transaction: expire others → insert active → log audit.
Consider whether `ACTIVE` should even be stored (it's derivable from dates); if you store it, add a
scheduled recompute (`pg_cron` or a boot-time `UPDATE … WHERE end_date < CURRENT_DATE`) or the badge
goes stale. I recommend: **derive in a view, keep `status` for lifecycle (DRAFT/TERMINATED) only.**

## 🔴 8. Leave-balance trigger can double-deduct and never reverses

`deduct_leave_balance()`:
```sql
UPDATE time_off_allocations SET taken_days = taken_days + NEW.duration, …
 WHERE employee_id=… AND time_off_type_id=… AND valid_from <= NEW.start_date
   AND valid_until >= NEW.end_date AND remaining_days >= NEW.duration;
```
- If **two** allocation rows match (e.g. a carry-over allocation and a new-year one overlapping),
  the UPDATE hits **both** → balance deducted twice. Needs `ORDER BY … LIMIT 1 FOR UPDATE` semantics
  (i.e. a plpgsql loop that splits across allocations), or a CHECK preventing overlaps.
- `unit = 'HOURS'` types: `duration` is hours being added to `taken_days`. Add
  `duration_unit` on the request (see 🟠 12) and convert, or reject hours-types in this code path.
- **No reversal**: reject→re-approve, cancel after approval, or `PUT …/approve` then `DELETE` leaves
  the balance permanently consumed. Add the inverse branch (`OLD.status='APPROVED' AND
  NEW.status <> 'APPROVED'` → give it back).
- A leave spanning two allocations (valid_until < end_date) raises "Insufficient balance" — wrong
  error, real scenario.
- `remaining_days` has no `CHECK (remaining_days >= 0)`; the guard lives only inside that one trigger,
  so any direct INSERT/UPDATE can go negative.

Recommendation: **do balance math in the service layer inside the approval transaction** (testable,
explicit, supports partial approval like Odoo's "validate 3 of 5 days"), and keep only
`CHECK (remaining_days BETWEEN 0 AND allocated_days)` in the DB. Triggers are fine for
`updated_at`/derived hours, not for money-adjacent business rules — and a judge asking "where is the
balance logic?" gets a better answer from a service function.

## 🟠 9. Deduction sign convention is ambiguous, and totals are computed two ways

`api.md` §9 shows `{ "name": "Provident Fund", "category": "DEDUCTION", "amount": -6000.00 }`
(negative), while `payslips.total_deductions = 8700.00` (positive). Two conventions in one API means
someone writes `total_deductions = SUM(amount)` → **-8700** and net becomes gross+deductions.

Fix: store magnitudes positive + `category` decides sign (or add a `sign smallint`), and
derive `gross/total_deductions/net` in the DB so they can't drift:

```sql
CREATE OR REPLACE FUNCTION recalc_payslip_totals(p_payslip uuid) RETURNS void AS $$
  UPDATE payslips p SET
    gross_amount     = COALESCE((SELECT SUM(amount) FROM payslip_lines
                                 WHERE payslip_id=p.id AND category IN ('BASIC','ALLOWANCE','REIMBURSEMENT')),0),
    total_deductions = COALESCE((SELECT SUM(amount) FROM payslip_lines
                                 WHERE payslip_id=p.id AND category='DEDUCTION'),0),
    net_amount       = COALESCE((SELECT SUM(amount) FROM payslip_lines
                                 WHERE payslip_id=p.id AND category IN ('BASIC','ALLOWANCE','REIMBURSEMENT')),0)
                     - COALESCE((SELECT SUM(amount) FROM payslip_lines
                                 WHERE payslip_id=p.id AND category='DEDUCTION'),0)
  WHERE p.id = p_payslip;
$$ LANGUAGE sql;
```
Now manual line edits (a Payroll Manager feature in your flows doc) can never desync the totals.

## 🟠 10. `pay_frequency` / half-month support is not expressible

`payslips` has `UNIQUE(payrun_id, employee_id)` — which allows **the same employee twice in the same
month with two payruns** and gives no way to say "this is 1–15 Feb". Needed for your extra feature
(and for the duplicate-payslip warning the PDF explicitly asks for):

```sql
ALTER TABLE payslips ADD COLUMN period_key text NOT NULL;      -- '2026-02' | '2026-02-H1' | '2026-02-C10-09'
ALTER TABLE payslips ADD COLUMN payslip_kind text NOT NULL DEFAULT 'MONTHLY';
   -- MONTHLY | HALF_FIRST | HALF_SECOND | CUSTOM | ADVANCE | ARREAR | BONUS | FULL_FINAL
ALTER TABLE payslips ADD CONSTRAINT ck_payslip_kind CHECK (payslip_kind IN
   ('MONTHLY','HALF_FIRST','HALF_SECOND','CUSTOM','ADVANCE','ARREAR','BONUS','FULL_FINAL'));
CREATE UNIQUE INDEX uq_payslip_one_per_kind ON payslips(employee_id, period_key) WHERE status <> 'VOID';
```
`period_key` is computed by the engine from `(period_start, period_end, pay_frequency)` and gives you
duplicate detection with **no extra extension** (I would have suggested
`EXCLUDE USING gist (employee_id WITH =, daterange(...) WITH &&)`, but that needs `btree_gist`, which
is **not** in the Project IDX/Firebase Studio supported-extension list — see `05` §2). Add the plpgsql
overlap check for arbitrary/custom ranges anyway:

```sql
PERFORM 1 FROM payslips WHERE employee_id=NEW.employee_id AND id<>NEW.id AND status<>'VOID'
  AND daterange(period_start,period_end,'[]') && daterange(NEW.period_start,NEW.period_end,'[]')
  AND id IS NOT NULL;   -- then: RAISE 'Payslip period overlaps an existing payslip'
```
(simple `NOT EXISTS (… period_start <= NEW.period_end AND period_end >= NEW.period_start)` version if
you want zero range-operator dependencies).

## 🟠 11. `mark-paid` returns a field that doesn't exist

`api.md` §8 responds `{ status: "PAID", paid_at: … , total_net: …}` but `payruns` has no `paid_at`
(and `payslips` has no `paid_at` either). Add:

```sql
ALTER TABLE payruns  ADD COLUMN paid_at timestamptz, ADD COLUMN paid_by uuid REFERENCES users(id),
  ADD COLUMN locked_at timestamptz, ADD COLUMN locked_by uuid REFERENCES users(id),
  ADD COLUMN failure_reason text;
ALTER TABLE payslips ADD COLUMN paid_at timestamptz;
```
Also add the missing statuses the workflow needs: `payrun_status` has `DRAFT|COMPUTED|VALIDATED|PAID`
but no way to express `COMPUTE_FAILED`, `VOID`/`CANCELLED` (needed: "delete a computed payrun" is
Manager-only, so the alternative is voiding), and `PARTIALLY_SENT`.

## 🟠 12. Time off can't express what the module must do

```sql
CREATE TABLE time_off_types ( unit time_off_unit NOT NULL DEFAULT 'DAYS', … )
```
Missing:
- `is_unpaid boolean` / `payroll_code text` — **without this, "approved leave" and "LOP" are
  indistinguishable to the payroll engine**, and the PDF's "leave → payslip deduction" link
  (`unpaid_work_entry_type_id` in Odoo) doesn't exist. Your own `salary_rules` doc *mentions*
  "`code` is used in salary rules (e.g. `UNPAID_LEAVE` triggers deduction)" but there's no join path.
- `requires_attachment`, `max_continuous_days`, `min_notice_days`, `encashable`,
  `accrual_frequency` (nice, cheap, and Odoo-like).
- `sandwich_rule boolean` (Indian HR reality: weekly offs between LOPs become LOP) — one flag + one
  function; strong "real business logic" talking point.
- `time_off_requests` needs `duration_unit`, `half_day_period` ('MORNING'|'AFTERNOON'),
  `partially_approved_days numeric`, `work_hours numeric`.
- `time_off_allocations` needs approval columns (PDF: "allocations … requiring approval before
  availability") → `status` exists but no `requested_by/approved_by/approved_at`; and add
  `CHECK (absorbed+allocated - taken - pending = remaining)`-style integrity, plus
  `pending_days` (so two in-flight requests can't both spend the same balance — currently possible:
  the balance is only consumed at *approval*).

## 🟠 13. Attendance/leave for payroll needs generated-day rows or an explicit decision

Nothing ever writes `status IN ('ON_LEAVE','HOLIDAY','ABSENT')` rows for non-worked days, so
"expected 20, present 18, absent 1, leave 1" can only be reconstructed at compute time by
cross-joining the schedule with `attendance` and `time_off_requests`. Decide now (recommended:
**do not store synthetic rows**; compute a day-by-day "payroll calendar" in the engine and expose it
as a read-only view):

```sql
CREATE OR REPLACE FUNCTION payroll_calendar(p_emp uuid, p_from date, p_to date)
RETURNS TABLE(day date, day_type text, expected_hours numeric, worked_hours numeric,
              overtime_hours numeric, leave_type text, is_holiday bool, source text) …
```
This function is the *one* place attendance + leave + holidays + schedule meet, so testing it
isolates 80% of payroll risk. Also answers the dashboard's "attendance coverage %" requirement.

## 🟠 14. `TIMESTAMP` (no timezone) everywhere, while the API speaks `…T09:00:00Z`

`created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, `check_in TIMESTAMP` + ISO-Z in `api.md`.
Inserting `2026-02-03T08:45:00Z` into `timestamp` silently re-interprets it in the **server's**
TimeZone; in a cloud sandbox that's usually UTC while your users are `Asia/Kolkata` → check-ins land
3.5 h off, worked hours shift, and "today" for check-in can be yesterday. Fixes, pick one:
- **Preferred:** make every timestamp column `timestamptz`, keep `date` columns as `date`, and derive
  local dates with `(check_in AT TIME ZONE 'Asia/Kolkata')::date`; set `TZ`/`ALTER DATABASE … SET
  timezone`.
- Or declare "all times are IST naive" in writing and validate at the API boundary (reject a `Z`
  suffix that you can't honour). Either way, **do not leave it implicit** — and mention the decision in
  the README; it reads as senior-level.

Also: night shift means `date` must be defined as **shift start date** (document it in a column comment).

## 🟠 15. Audit trail can't record system actions

`audit_logs.performed_by UUID NOT NULL REFERENCES users(id)` — but the DB triggers
(leave deduction, weekly-hours recompute) and a future scheduler also change data. Make it nullable
with a `actor_type text CHECK (actor_type IN ('USER','SYSTEM','WORKER'))`, and add
`diff jsonb` convenience. Also `ip_address INET` requires `req.ip` to be correct **behind a proxy** →
set `app.set('trust proxy', 1)` in Express or every audit row says the proxy's IP (guaranteed
surprise in a cloud IDE).

## 🟠 16. YTD semantics undefined

`ytd_gross/ytd_deductions/ytd_net DECIMAL(14,2)` — YTD from **which anchor**? Indian payroll uses
fiscal year **1 April–31 March**; `api.md` shows 6 payslips summing to `425,062.50` (calendar?). Fix:
```sql
ALTER TABLE company_settings ADD COLUMN fiscal_year_start_month int NOT NULL DEFAULT 4;  -- April
```
compute YTD as the sum of PAID+COMPUTED payslips in that fiscal year **including half-months**
(else your extra feature silently understates YTD), and add
`ytd_as_of date` + a `stale` flag: editing an earlier payslip must invalidate later ones
(`UPDATE payslips SET status='STALE' WHERE employee_id=… AND period_end > …`).

## 🟠 17. Employee identity/soft-delete gaps

- `employees.email NOT NULL` but **not unique** → `POST /employees` promises `409 EMAIL_EXISTS`.
  `CREATE UNIQUE INDEX uq_emp_email ON employees(lower(email)) WHERE status <> 'TERMINATED';`
- `user_id UUID REFERENCES users(id) ON DELETE CASCADE` — deleting a user **deletes the employee**
  (and cascades to payslips!). Should be `ON DELETE SET NULL` (or RESTRICT). This one can eat your
  demo data via Admin "delete user". 🔥 Check `payslips.contract_id` too: plain `REFERENCES` =
  `NO ACTION`, so deleting a contract with payslips throws — fine, but you must surface a friendly 409.
- No `deleted_at` while the API claims "soft-deletes (sets status to TERMINATED)" — that's a *status*
  change, not a delete; name it `terminate` in the API to match the DB, and keep `status IN (…)`.
- `employee_code UNIQUE NOT NULL` but not accepted by `POST /employees` and no generation rule:
  ```sql
  CREATE SEQUENCE employee_code_seq START 1;
  ALTER TABLE employees ALTER COLUMN employee_code SET DEFAULT 'EMP' || lpad(nextval('employee_code_seq')::text,3,'0');
  ```
  (a `SELECT max()+1` query races once two requests overlap; a sequence doesn't).

## 🟠 18. `salary_rules` missing everything the engine needs to be honest

Current: `computation_type, amount, formula, condition, is_taxable, appears_on_payslip, sequence`.
Add (all cheap, all needed by `03-payroll-domain-research.md`):

```sql
ALTER TABLE salary_rules ADD COLUMN
  base_code            text,            -- what PERCENTAGE is a percentage OF (not free-text guessing)
  quantity_expression  text,            -- per-day/per-hour multipliers (meal voucher × worked days)
  pro_rata             boolean NOT NULL DEFAULT true,   -- scale by paid_days/expected_days
  cap_amount           numeric(12,2),   -- per-period cap (PT, allowances)
  annual_cap           numeric(12,2),   -- per-fiscal-year cap (PT ₹2,500/yr)
  floor_amount         numeric(12,2),
  is_report_only       boolean NOT NULL DEFAULT false,  -- GROSS/NET echo lines: printed, never summed
  statutory            boolean NOT NULL DEFAULT false,  -- cannot be deleted by a Payroll User
  depends_on           text[],          -- extracted at save → cycle/forward-ref detection
  effective_from       date NOT NULL DEFAULT '1900-01-01',
  effective_to         date,
  formula_lang_version int  NOT NULL DEFAULT 1,         -- so old payslips stay interpretable
  rounding_mode        text NOT NULL DEFAULT 'half_up'; -- per-line, documented
CREATE UNIQUE INDEX uq_rule_seq ON salary_rules(salary_structure_id, sequence) WHERE true;
CREATE UNIQUE INDEX uq_rule_active_name ON salary_rules(salary_structure_id, name) WHERE true;
```
`UNIQUE(salary_structure_id, sequence)` is asserted in your API validation text but absent from the DDL.

## 🟡 19. `task_queue` needs to be a real ledger, not just a queue mirror

```sql
ALTER TABLE task_queue ADD COLUMN dedupe_key text,
  ADD COLUMN job_id text, ADD COLUMN queue_name text,
  ADD COLUMN priority int NOT NULL DEFAULT 0,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN started_at timestamptz, ADD COLUMN payrun_id uuid REFERENCES payruns(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX uq_task_dedupe ON task_queue(dedupe_key)
  WHERE status IN ('PENDING','PROCESSING');            -- the anti-double-email index
CREATE INDEX idx_task_payrun ON task_queue(payrun_id, task_type, status);
ALTER TABLE task_queue ADD CONSTRAINT ck_task_retry CHECK (retry_count <= max_retries);
```
Also `queue_status` should include `DEAD` (retries exhausted) and `CANCELLED`.

## 🟡 20. `payslips` needs document/delivery state for the self-serve feature

```sql
ALTER TABLE payslips ADD COLUMN pdf_hash text, ADD COLUMN pdf_generated_at timestamptz,
  ADD COLUMN document_version int NOT NULL DEFAULT 1,
  ADD COLUMN email_status text NOT NULL DEFAULT 'NOT_SENT',
    -- NOT_SENT | QUEUED | SENT | BOUNCED | FAILED
  ADD COLUMN download_count int NOT NULL DEFAULT 0;
```
(Your `pdf_url VARCHAR(500)` + `email_sent BOOLEAN` can't express "queued", "bounced", or
"regenerated after this download", all of which the UI in `user-flows.md` needs.)

## 🟡 21. Search & list performance

`api.md` §2 promises `search` over name/email/employee_code. `CREATE INDEX … ON employees(name
varchar_pattern_ops)` doesn't help `ILIKE '%rah%'`; **`pg_trgm` is not in the IDE's supported
extension list**, so: use `to_tsvector('simple', …)` + GIN (built-in) for the three columns, or accept
sequential scan at 45 rows and say so. Don't spend hackathon time here — but do add:

```sql
CREATE MATERIALIZED VIEW mv_employee_search AS
  SELECT id, to_tsvector('simple', coalesce(name,'')||' '||coalesce(email,'')||' '||employee_code) tsv
  FROM employees;   -- REFRESH on seed; or a plain GIN on the employees table
```

## 🟡 22. Missing tables (the set that makes the features possible)

| Table | Why |
| --- | --- |
| `company_settings` | divisor policy, fiscal year start, PT/TDS config, brand/logo/address for PDF, `payrun_lock_after_paid`, mail sender, `overtime_multiplier`, `pt_annual_cap` |
| `payslip_documents` | versioned artifacts (payslip/annual summary/loan letter) with `sha256`, `bytes`, `storage_path` → powers caching, regeneration, ZIP download, audit |
| `email_deliveries` | the idempotent delivery ledger (`payslip_id + document_version` unique) |
| `payslip_downloads` | self-serve audit: who downloaded which payslip when, IP, UA (Admin "Audit Logs" screen already expects this granularity) |
| `payslip_inputs` | one-off amounts (bonus/recovery) typed on a payslip that rules can read via `inputs.X` — Odoo parity, ~1 h of work |
| `payslip_arrears` / `adjustments` | "carry to next month" for negative net and for H1 over/underpayment |
| `refresh_tokens`, `password_resets` | auth story is incomplete without them |
| `pt_slabs`, `tax_slabs`, `tax_declarations` | statutory rules as **data** (see `03` §7) |
| `holiday_templates` + generated `holidays` | `is_recurring boolean` alone can't materialize "every 26 Jan"; store `month_day` and expand per year |
| `payrun_employees.compute_status/error` | the wizard's Step-2 + per-row failures need a place to live; today one employee's error has nowhere to go |

## 🟡 23. Constraint hygiene to add while you're in there

```sql
ALTER TABLE employees  ADD CONSTRAINT ck_emp_join CHECK (date_of_exit IS NULL OR date_of_exit >= date_of_joining);
ALTER TABLE employees  ADD CONSTRAINT ck_emp_salary CHECK (basic_salary IS NULL OR basic_salary >= 0);
ALTER TABLE attendance ADD CONSTRAINT ck_att_hours CHECK (worked_hours IS NULL OR (worked_hours >= 0 AND worked_hours <= 24));
ALTER TABLE payslips   ADD CONSTRAINT ck_payslip_days CHECK (worked_days >= 0 AND expected_working_days >= 0);
ALTER TABLE payslips   ADD CONSTRAINT ck_payslip_net  CHECK (net_amount >= 0);          -- with a VOID escape
ALTER TABLE payslip_lines ADD UNIQUE (payslip_id, sequence);
ALTER TABLE payslip_lines ADD COLUMN amount_signed numeric GENERATED ALWAYS AS
   (CASE WHEN category='DEDUCTION' THEN -amount ELSE amount END) STORED;   -- no more sign bugs
ALTER TABLE working_schedules ADD CONSTRAINT ck_sched_active CHECK (total_weekly_hours BETWEEN 0 AND 168);
```
The `GENERATED ALWAYS … STORED` column is a good demo detail: the sign rule becomes *structural*.

## 🟡 24. Things that are **right** in your schema — keep, don't "improve" away

- `UNIQUE(employee_id, date)` on attendance; `UNIQUE(payrun_id, employee_id)` on payslips.
- Denormalised `rule_name`/`rule_code`/`category`/`sequence` on `payslip_lines` — *historical accuracy*
  is exactly the right instinct for payroll (a renamed rule must not rewrite last year's payslip).
- Separate `payruns` (batch) vs `payslips` (document) — mirrors `hr.payslip.run`/`hr.payslip`.
- `pay_frequency` already on `payruns` — that's the seed of the half-month feature.
- `is_manual` + `manual_reason` on attendance, and `overtime_approved` — audit-friendly.
- `time_off_types.requires_allocation` / `max_days_per_year`.
- `payrun_employees` junction table (lets the wizard select, re-select, and deselect before compute).

## What to change first (ordering)

1. `06` #5 (contract selection) → #9 (totals derived) → #10 (period_key/kind) — these three decide the
   engine's shape, so do them before writing any compute code.
2. #1, #2, #4 (time math + schedule fallbacks) before attendance UI exists.
3. #8 (leave balances as a service) before the approval screen.
4. #18 + #22 additions alongside the engine, since each column exists to serve one rule feature.
5. #11, #19, #20 before `mark-paid` / `send` / self-serve download.
