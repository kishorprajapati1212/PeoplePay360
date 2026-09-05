# 13 · How a salary rule becomes a number on a payslip

Written because the payrun screen is full of numbers and it was not obvious which rule made which one. This
is the whole path, with the arithmetic shown. Every figure here is asserted by `backend/scripts/test-unit.js`
("payslip engine" tests), so if the code changes and this page goes stale, the tests fail first.

## 1. A rule is one line on the slip

A salary rule (`salary_rules`) is a row that says five things:

| On the Rules screen | What it decides |
| --- | --- |
| **Category / Line kind** | Is it money in (`EARNING`), money out (`DEDUCTION`), a correction (`ADJUSTMENT`), or only a total (`REPORT`, e.g. GROSS and NET)? |
| **Computation** | `FIXED` (an amount), `PERCENTAGE` (a share of another line), or `FORMULA` (an expression). |
| **Sequence** | The order the engine works in. A rule can only use a line that was already computed, so Basic (1) comes before HRA (2), and the totals come last (100+). |
| **Apply only when** (`condition_expr`) | A test like `overtime_hours > 0`. False → the line is 0, and the slip says why. |
| **Pro-rata / Evaluation window / Rounding** | Whether a part-month scales it, what window its caps are measured against, and whether it is floored to a whole rupee. |

Nothing else matters for the arithmetic. `appears on payslip` only hides the line; `is_taxable` only feeds
the exemption table.

## 2. The engine, in four steps

`backend/src/lib/payroll/engine.js` — `computePayslip()`:

1. **Order** the rules by sequence (and pull a dependency in front of whatever needs it).
2. **Each rule, in turn:** condition → resolver or FIXED/PERCENTAGE/FORMULA → caps → rounding. One line out.
3. **Totals are added from the lines**, never stored separately: `gross = Σ earnings`,
   `net = gross − deductions + adjustments`. So the printed slip and the arithmetic cannot disagree.
4. **Two lines the rules did not produce** are appended: a carry-in arrear line, and a round-off line.

Every line keeps the sentence the engine wrote while working it out (`computation_log`). That sentence is
printed under the amount on the payslip — it is the audit trail, not a comment.

## 3. A full month, with numbers

Contract wage ₹85,000 · February 2026 · 20 expected working days · factor 1 (whole month worked) ·
PF 12% with the ₹15,000 wage ceiling · ESI off · PT ₹200 for this slab · bonus rate 0.10.

| # | Rule | Computation | Amount | The engine's own sentence |
| --- | --- | --- | --- | --- |
| 1 | BASIC | 40% of contract wage | **₹34,000.00** | `40% of ₹85000.00` |
| 2 | HRA | 50% of **BASIC** | **₹17,000.00** | `50% of ₹34000.00` — the base is the line, not the wage |
| 3 | MEDA | fixed | ₹1,250.00 | `₹1250.00 fixed` |
| 4 | CONV | fixed | ₹1,600.00 | `₹1600.00 fixed` |
| 5 | PERB | formula `bonus_rate * wage` | ₹8,500.00 | `formula → ₹8500.00` |
| 6 | OT | formula, `overtime_hours > 0` | ₹0.00 | `Skipped: condition "overtime_hours > 0" is false` |
| 100 | GROSS | report | **₹62,350.00** | repeats the sum of the earning lines |
| 110 | PF | 12% | **₹1,800.00** | `12% of ₹15000.00 (ceiling applied: wage ₹85000.00)` |
| 120 | PT | statutory slab | **₹200.00** | `Slab ₹50000.00–∞ → ₹200.00/month (Gujarat)` |
| 200 | NET | report | **₹60,350.00** | gross − deductions |

Read it as: 34,000 + 17,000 + 1,250 + 1,600 + 8,500 = **62,350**, minus 1,800 + 200 = **60,350 in hand**.

Two things in that table are the usual surprises:

* **HRA is a share of BASIC, not of the wage.** `base_code` names a rule code; if the code is already in the
  structure, that computed line is the base. Set the base to `CONTRACT_WAGE` when you want the wage.
* **PF is 12% of ₹15,000, not of ₹85,000.** The statutory resolver reads `pf_wage_ceiling` from company
  settings. That is a setting, not a constant in code — change it on the Settings screen and the next
  compute uses the new number.

## 4. The same month as two halves

A half-month run does not "cut the bill in half"; it computes the slice on its own days.

1st half (1–15 Feb, 10 of 20 expected days → factor 0.5, mode PRO_RATA):

| Rule | Amount | Why it moved / stayed |
| --- | --- | --- |
| BASIC | ₹17,000.00 | pro-rata line, × 0.5 |
| HRA | ₹8,500.00 | 50% of an *already halved* Basic — the factor is deliberately **not** applied a second time |
| MEDA | ₹625.00 | fixed, pro-rata, × 0.5 |
| PERB | ₹8,500.00 | `pro_rata: false` + `evaluation_period: MONTH_ONCE` → paid in full, once a month |
| PF | ₹900.00 | wage-based, so it follows the salary down |
| PT | ₹200.00 | `pt_charge_slice: MONTH` → charged on every slip unless the state policy says otherwise |
| **Gross / Net** | **₹35,425.00 / ₹34,325.00** | |

2nd half: the same lines for its own days. A `MONTH_ONCE` rule like PERB gets **₹0** in the second slip,
because `prior.month_codes` already contains it — otherwise a monthly bonus would be paid twice in one month.

## 5. Money that is measured per day

| Case | Arithmetic | Verified by |
| --- | --- | --- |
| Divisor | `CALENDAR_DAYS` → days in the slice; `FIXED_30` → 30; `FIXED_26` → 26; `ACTUAL_WORKING_DAYS` → the schedule's days in the month | `settings.js` / `DAY_BASIS_DIVISOR` |
| One day without pay (LOP) | one day out of the paid days; a half day counts as half (`present: 3.5`) | `attendanceStats` test |
| Joining mid-month | `factor = days from joining ÷ days in the month` (e.g. 13 ÷ 22 = 0.590909) and only `pro_rata` lines scale | half-month tests |
| Overtime | `approved hours × (wage ÷ expected days ÷ hours per day) × overtime multiplier` → 1.5 h of ₹85,000 over 20 days at 8 h = ₹531.25/h × 1.5 × 2 = **₹1,593.75** | OT test |
| Rounding | per-line `down`/`up` first; then one `ROUND_OFF` line moves the net to a whole rupee — never spread across lines | rounding test |

Only *approved* overtime counts, and only within the period the slip covers.

## 6. Statutory lines are data, not code

PF, ESI and PT have resolvers (`resolvers.js`) that read company settings and `pt_slabs`, and they write
their own explanation. The important behaviours, each covered by a test:

* **ESI is all or nothing.** Wage ₹20,000 → employee 0.75% = **₹150.00**; wage ₹85,000 → the line is **0**
  because the wage is above `esi_wage_limit`. It is not a taper.
* **PT respects the annual cap.** With a ₹500 yearly cap and ₹200 a month, the 13th month is trimmed, not
  dropped: ₹200, ₹200, then **₹100** because that is all that is left.
* **A resolver returning 0 is a decision**, not a missing value. The engine never falls through to a second
  calculation, which is why an exempt employee shows ₹0 instead of a wrong number.
* **An admin can override any of them** by putting a `FORMULA` on the statutory rule — the formula wins.
  That is deliberate, so a weird state rule does not need a code change.

## 7. Caps and windows

| Field | Meaning |
| --- | --- |
| `cap_amount` | the most the line may be **in one evaluation window** (`PERIOD`, `MONTH`, `MONTH_ONCE`, `FISCAL_YEAR`), less what earlier slips in that window already used |
| `annual_cap` | the same over the financial year, from `prior.ytd_by_rule` |
| `evaluation_period` | which window both caps are measured against, and whether "already paid this month" suppresses the line |

So a FIXED rule with a quantity (`₹500 × paid_days`, capped at 10 days) and a percentage rule with a ₹1,500
ceiling go through the same two lines of code.

## 8. What a formula may contain

Allowed: numbers, `+ - * / ( )`, comparisons (`> < >= <= = !=`, for `Apply only when`), and eight functions —
`min(a, b, …)` · `max(a, b, …)` · `round(x)` · `floor(x)` · `ceil(x)` · `abs(x)` · `days_in_month(date)` ·
`if(test, then, else)`. No assignment, nothing else. A formula may read the whole context but never write to
it, and `eval` is not involved at all (`backend/src/lib/formula` is a parser plus a small tree-walking
evaluator). An unknown name is a hard error when the rule is saved, not on payday.

Variables (the list in `formula/eval.js` — `DEFAULT_ALLOW`, built by `payroll/context.js`):

`worksheet` · `result` · `gross` · `net` · `total_deductions` · `wage` · `basic` · `days` · `expected_days` ·
`paid_days` · `present_days` · `absent_days` · `leave_days` · `unpaid_days` · `lop_days` · `half_days` ·
`period_days` · `month_days` · `worked_hours` · `scheduled_hours` · `overtime_hours` · `overtime_earnings` ·
`pf_employee` · `pf_employer` · `esi_employee` · `esi_employer` · `pt` · `tds` · `loan_deduction` ·
`professional_tax` · `bonus` · `bonus_rate` · `arrear` · `allowance`

Plus the dotted groups, each read-only:

| Group | Names |
| --- | --- |
| `attendance.` | `days`, `present`, `absent`, `late`, `half_days`, `on_leave`, `worked_hours`, `overtime_hours`, `shortfall`, `missing_checkout`, `manual_edits` |
| `timeoff.` | `paid`, `unpaid`, `total`, `by_type` |
| `employee.` | `id`, `code`, `name`, `status`, `employee_type`, `job_position`, `department`, `date_of_joining`, `date_of_exit` |
| `contract.` | `id`, `wage`, `start_date`, `end_date`, `salary_structure`, `working_hours_per_week` |
| `inputs.` | whatever a pay input was called on this run (`bonus_rate`, `tds`, `loan_deduction`, …) |
| `run.` | `period_start`, `period_end`, `period_key`, `pay_frequency`, `compute_mode`, `factor`, `is_half_month`, `half`, `payrun_status`, `payrun_name`, `month_prior_net`, `month_h1_net` |

The list itself is `DEFAULT_ALLOW` in `backend/src/lib/formula/eval.js`, and the values are built by
`backend/src/lib/payroll/context.js` — one line in each, if a rule author needs another name.

Rule codes are also variables once their line has been computed, which is why sequence matters:
`HRA` can read `BASIC`, `BASIC` cannot read `HRA`.

The **Formula tester** panel on the Rules screen runs this same evaluator with a sample wage and day count,
so a formula can be checked before it is saved.

## 9. Where you see the answer in the app

* **Rules screen** — under each rule name, one sentence assembled from those same fields
  (`frontend/src/pages/salary/RulesPage.jsx`, `explainRule`).
* **A payslip** — the sentence under every amount, plus the numbered "How this slip was computed" panel that
  lists the day basis, the factor, what was scaled, what was skipped and how the totals add up
  (`frontend/src/pages/payroll/PayslipDetailPage.jsx`, `explainSlip`). Employees see the same thing.
* **The PDF** — the lines with their amounts; the per-line sentence is kept in the app because a slip is a
  statement, not a working.
* **`payslip_versions`** — a recomputed slip is a new version, so the number you were shown and the number
  that was later changed are both still there.

## 10. If a number looks wrong

1. Open the slip and read the line's `↳` sentence: it names the base and the factor that were used.
2. Is the sequence right? A percentage of a line that comes later reads as 0.
3. Is the base a rule code that exists **on this structure**? `base_code` is checked against the structure.
4. Is the rule's window `MONTH_ONCE` while the payrun is half-month? Then the second slip is meant to be 0.
5. Is the amount inside a cap? `cap_amount` shows up as a smaller line, and the sentence says so.
6. Did the employee not work the whole month? Only lines with `pro_rata` scale — a fixed monthly allowance
   with `pro_rata: false` is paid in full, on purpose.
