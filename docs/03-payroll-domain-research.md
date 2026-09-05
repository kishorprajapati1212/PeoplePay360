# 03 — Payroll domain research (how it actually works)

Two halves: **§1–4** what the reference system (Odoo) does, because the problem statement is
"rebuild Odoo HR & Payroll behaviour"; **§5–9** the math and rules our engine must implement.

---

## 1. Object mapping: Odoo → our schema

| Odoo model | Our table | Notes worth copying |
| --- | --- | --- |
| `hr.employee` | `employees` | Odoo keeps employee separate from `res.users` (login) — same as our `users`/`employees` split with `user_id`. |
| `hr.contract` | `contracts` | Holds `wage`, `structure_type_id`, `working_hours_id`, dates, `state` (draft/open/closed/expire). Payroll reads the contract **valid for the payslip period**. |
| `resource.calendar` + `resource.calendar.attendance` | `working_schedules` + day columns | Odoo stores per-weekday attendance lines; we flattened to mon_start…sun_end. Same idea: derived `hours` per day. |
| `resource.calendar.leaves` | `holidays` (+ company closures) | Used to exclude days from worked-day counts. |
| `hr.attendance` | `attendance` | `worked_hours` computed by `_compute_worked_hours()` from check_in/check_out — we do it in a trigger/service. |
| `hr.leave.type` | `time_off_types` | `leave_validation_type`, `allocation_type` (days/hours/half-days), `requires_allocation`, `support_negative_balance`, `unpaid_work_entry_type_id` ← **this is the leave→payroll link Odoo uses; we need an equivalent flag.** |
| `hr.leave.allocation` | `time_off_allocations` | Allocation itself needs approval in Odoo (two-level); ours is single-level — note it as a deliberate simplification. |
| `hr.leave` | `time_off_requests` | states: confirm → validate → validate1, `refuse`. |
| `hr.payroll.structure` | `salary_structures` | Odoo 17/18 adds a parent level: `hr.payroll.structure.type` (country + wage type + default scheduled pay + default work-entry type). Structure = the rule set for a pay frequency. |
| `hr.salary.rule` | `salary_rules` | See §2 — this is the heart. |
| `hr.rule.category` | `rule_category` enum | Odoo categories form a **hierarchy** (BASIC ⊂ ALW ⊂ GROSS ⊂ NET) and `categories.GROSS` is a *sum of all rules in that category*. |
| `hr.payslip` | `payslips` | states `draft → confirm → paid` + `approve`/`posting` states; has `struct_id`, `contract_id`(s), `date_from`, `date_to`, `worked_days_line_ids`, `input_line_ids`, `details_by_salary_rule_code`. |
| `hr.payslip.line` | `payslip_lines` | |
| `hr.payslip.run` | `payruns` | "Payslip Batches": pick structure + period → **Create Payslips** (draft payslips for all assigned employees) → **Verify All** → **Create Payroll Journal Entries** → **Close**. |
| `hr.input.type` | *(missing in our schema — add `payslip_inputs`)* | One-off values typed on a payslip (bonus, recovery) that rules can read via `inputs.X.code`. Big usability win, tiny build cost. |
| `hr.salary.rule.range` | optional | Slab/range based rules. |
| Payslip PDF qweb report | `payslip_documents` + worker | Odoo prints via QWeb HTML→PDF. Our HTML-template→renderer path is the same idea. |
| `hr.self.service` portal | `/me/*` | Odoo's self-service exposes own info, time off, expenses and payslip access — our extra feature is aligned with the real product. |

### Things Odoo does that we should copy (cheap, high signal)

1. **"Details by rule" trace** — every payslip stores, per rule, the *computation logic string and
   the variables used*, so an auditor can see `50000 / 20 * 19` not just `47500.00`. We should store
   `calculation_trace JSONB` on `payslip_lines`. This is the single best "we understand payroll"
   detail available to us.
2. **Inputs** for one-off amounts, and **appearance/report-only rules** (`appears_on_payslip`,
   `active`) — we already have `appears_on_payslip`; add `is_report_only` so GROSS/NET pseudo-lines
   don't double count.
3. **Structural change handling** — when an employee's structure changes mid-period, Odoo produces
   two payslips for the month covering day ranges. Our period-driven engine does this for free.
4. **Batch-level workflow** — Odoo's batch is "generate draft payslips, then individually/collectively
   confirm". Our `DRAFT → COMPUTED → VALIDATED → PAID` is the same shape; keep it literal.

---

## 2. Salary rule anatomy (Odoo `hr.salary.rule`) → our rule engine

Odoo's per-rule fields and the semantics we must reproduce:

| Odoo field | Meaning | Our equivalent | Required behaviour |
| --- | --- | --- | --- |
| `sequence` | execution + display order | `sequence` | Lower first. Conventional bands: BASIC 1–10, allowances 11–99, GROSS 100, deductions 110–199, NET 200. |
| `code` | short id used by other rules | `code` | unique per structure; referenced in formulas as `rules.BASIC` |
| `category_id` | BASIC/ALW/GROSS/DED/NET | `category` enum | drives aggregation (see below) |
| `condition_select` = `none`/`python` | whether rule applies | `condition` expression | empty → always applies |
| `amount_select` = `fixed`/`percentage`/`python` | how amount is computed | `computation_type` | FIXED→`amount`; PERCENTAGE→`amount` is a % of a base; FORMULA→expression |
| `amount_percentage_base` | which value % applies to | *(missing — add `base_code`)* | **Important:** "40% of what?" must be explicit. Free-text formula hides this. |
| `quantity` + `amount_select=fixed` | per-unit amount × count (e.g. ₹30/meal × worked days) | `quantity_expression` | needed for per-day allowances; add it |
| `appears_on_payslip` | print or not | exists | GROSS/NET often print, but must not be summed |
| `active`, `struct_id` | scoping | exists | |

### Aggregation contract (this is where teams get payslips wrong)

Define it once, in writing, and implement exactly:

```
earned(amount)   = Σ lines where category in (BASIC, ALLOWANCE, REIMBURSEMENT)
deducted(amount) = Σ lines where category = DEDUCTION
GROSS            = earned            (a rule with category GROSS is a REPORT-ONLY echo of this sum)
NET              = GROSS - deducted  (report-only echo again)
```

Rules:
- Lines with category `GROSS`/`NET` are **never** added into `earned()`/`deducted()`. If someone
  adds a rule with `category = 'GROSS'` and `computation_type = 'FORMULA'` (`basic + hra`), we must
  (a) evaluate it, (b) assert it equals our computed GROSS within ₹0.01, and (c) **warn, not
  silently use it**. That assertion is a 15-line function and an excellent "we thought about it"
   talking point.
- Every rule runs against an immutable, append-only map: `results[code] = value`. A rule may only
  read codes/categories already computed (lower sequence). Reading a future code ⇒ hard error
  `RULE_DEPENDENCY_FORWARD` at save time, not at compute time. Detect it by extracting identifiers
  from the parsed formula (`depends_on` stored at save).
- Deduction lines are stored **positive** in `payslip_lines.amount` with `category = DEDUCTION`, and
  rendered as `-6000.00`. Your `api.md` stores them **negative** (`amount: -6000.00`). Pick one and
  be consistent — I recommend *positive magnitude + category determines sign*, because then
  `SUM(amount) WHERE category='DEDUCTION' = total_deductions` and nobody writes `-Math.abs()`.
  Document it in the DB comment so a judge reading code sees intent. (See `06` §9.)

---

## 3. Payroll context resolution (per employee, per period)

The engine's "input bundle" — build it explicitly as a typed object, it makes the rest trivial and
unit-testable:

```js
PayrollContext {
  employee, contract, schedule, structure, rules[],
  period: {start, end, basis_days, calendar_days},
  holidays: Date[],            // inside period
  attendanceDays: {present, halfDay, absent, onLeavePaid, onLeaveUnpaid, holiday, missingCheckout},
  hours: {worked, expected, overtime, overtimeApproved},
  leaves: [{type, days, isUnpaid, overlaps}],
  adjustments: [{code, amount, reason}],   // inputs table
  proRataFactor,               // period basis_days / month basis_days (or 1 for monthly)
  monthLedger: {...},          // what has already been paid in this calendar month (for halves)
  paidAmount: {basic, gross, deductions},  // for reconciliation lines
}
```

Resolution rules:

1. **Contract**: `status='ACTIVE' AND start_date <= period_end AND (end_date IS NULL OR end_date >= period_start)`
   with tie-break `ORDER BY (is_primary DESC), start_date DESC LIMIT 1`. If zero → error
   `NO_ACTIVE_CONTRACT`. If overlapping actives → error `AMBIGUOUS_CONTRACT` (should be impossible
   thanks to the partial unique index, but check anyway — judges may insert data via psql).
   For mid-period changes we take **overlap days per contract** and prorate each segment
   (this is exactly how Odoo splits a structural-change month) → two wage lines, e.g.
   `Basic (Jan 1–14 @ 50k)` + `Basic (Jan 15–31 @ 55k)`.
2. **Schedule**: `contract.working_schedule_id ?? employee.working_schedule_id` → error if none
   (the spec's Step-2 eligibility filter says "has schedule").
3. **Expected days in period** = for each date in `period_start..period_end`: count the day if the
   schedule has non-zero hours for that weekday AND the date is not a holiday AND (date >=
   date_of_joining) AND (date_of_exit IS NULL OR date <= date_of_exit). This one function
   (`expectedDaysInPeriod`) drives overtime, per-day rate, proration and attendance coverage —
   so it must be pure and exhaustively tested (leap year Feb, 5/6-day weeks, holiday on Sunday,
   joiner on day 31, exit mid-period).
4. **Attendance counts** from `attendance` + approved `time_off_requests` (overlap-aware):
   a day is *paid* if present/half-day/paid-leave/holiday; *LOP* if absent or unpaid leave;
   missing check-out is its own bucket → never silently counted as full day (report + warning).
5. **Overtime hours** = Σ `overtime_hours` where `overtime_approved = true` (only approved OT is
   payable) — and, if the company policy has an OT threshold, apply `max(0, ot - threshold)`.

---

## 4. Day-count conventions (India) — must be a setting, not a constant

There is **no single legal divisor**; the Code on Wages doesn't prescribe one, so companies choose:

| Method | Divisor | Effect |
| --- | --- | --- |
| Calendar days | days in that month (28–31) | per-day pay varies month to month |
| Fixed 30 | 30 | predictable; common in IT |
| **Fixed 26** | 26 (6-day week minus weekly offs) | manufacturing/labour-law friendly |
| Actual working days | computed from schedule minus holidays | most accurate; **what our spec implies** (`expected_working_days`) |

Decision: implement **`actual_working_days`** as default because `payslips.expected_working_days`
already exists in your schema and the sample data matches it (Feb 2026 = 20 working days Mon–Fri ✓),
but store the choice in `company_settings.payroll_day_basis` so the demo can show it's configuration.
Per-day rate = `monthly_basic / expected_working_days`; per-hour = per-day / `expected_hours_per_day`.

---

## 5. The computation algorithm (write this once, in `src/payroll/engine.js`)

```
computePayslip(payrun, employee):
  ctx   = buildContext(payrun, employee)                     # §3
  if ctx.contract is null: raise NO_ACTIVE_CONTRACT
  base  = { contract_wage: ctx.contract.wage,
             monthly_basic: ctx.employee.basic_salary ?? ctx.contract.wage,
             days: { expected: ctx.period.basis_days, paid: ctx.paidDays, lop: ctx.lopDays },
             hours:{ worked, expected, overtime },
             flags:{ employee_type, is_tax_regime_old } }
  acc   = {}                                                 # code -> value
  trace = {}                                                 # code -> {expr, vars, raw, rounded}
  for rule in ctx.rules sorted by (sequence, id):
      if rule.condition and not evalBool(rule.condition, base ∪ acc): trace[code]={skipped}; continue
      raw =
        FIXED      : rule.amount
        PERCENTAGE : rule.amount/100 * valueOf(rule.base_code ?? categories.BASIC)
        FORMULA    : evalExpr(rule.formula, scope)
      raw *= (rule.quantity_expr ? evalExpr(rule.quantity_expr, scope) : 1)
      raw  = applyProRata(raw, rule)              # rule.pro_rata → * ctx.proRataFactor (paidDays/expectedDays)
      raw  = applyCapFloor(raw, rule, ctx)        # e.g. PT annual cap, PF wage ceiling
      amt  = round2(raw)
      acc[code] = amt;  lines.push({...})
  gross      = Σ acc where category in (BASIC, ALLOWANCE, REIMBURSEMENT)
  deductions = Σ acc where category = DEDUCTION
  net        = gross - deductions
  assertConsistency(gross, deductions, net, ctx)   # §6 invariants
  ytd        = previousYtd(employee, fiscal_year) + current
  return {lines, gross, deductions, net, ytd, trace}
```

Ordering detail that matters: `round2` **per line**, then sum the rounded lines (so the printed
columns add up). Rounding each line and then rounding the total is what makes a human's hand-check
succeed. Never sum raw then round.

### Scope object exposed to formulas (the whole API surface)

```
basic, hra, gross, deductions, net, contract_wage, monthly_hours,
expected_days, paid_days, lop_days, overtime_hours, overtime_approved_hours,
per_day_rate, per_hour_rate, pro_rata_factor, worked_hours,
rules.<CODE>            # previously computed rule values
categories.<CATEGORY>   # running sums by category
inputs.<CODE>           # one-off typed amounts
employee.type, employee.is_active
timeoff.<TYPE_CODE>_days
```

Restrict to: numbers, the identifiers above, `+ - * / ( )`, `> < >= <= == !=`, `and/or/not`,
ternary `? :`, and functions `min max abs round floor ceil`. **No** property access on
`globalThis/process/require`. That whitelist is the security boundary (§4 in `04-architecture`).

---

## 6. Invariants to assert (and to write as tests)

These are the properties a payroll system is judged on:

1. `Σ earnings − Σ deductions == net` (exactly, in paise).
2. `gross == Σ (BASIC+ALLOWANCE+REIMBURSEMENT)` — no GROSS/NET line inside any sum.
3. `net >= 0` → else `NEGATIVE_NET` error blocking `mark-paid` (offer "carry to next month" instead).
4. `worked + leave_paid + leave_unpaid + absent + holiday == expected_days` (attendance reconciliation).
5. Two payslips for the same employee must not overlap in dates → `DUPLICATE_PERIOD`.
6. `H1 + H2` (both halves) net must equal monthly net within ₹1 (reconciliation property of
   `08-extra-features`).
7. YTD for the latest payslip == Σ of that fiscal year's nets (recompute cascade after editing an
   earlier period: mark later payslips `stale`, force recompute).
8. A rule's amount is deterministic: same inputs twice → same paise (no `Date.now()`/random inside
   the engine; test with a fixed clock).
9. Refusing/cancelling an approved leave restores the balance exactly.
10. Re-clicking "Send Payslips" never sends twice for the same `(payslip, delivery_kind, version)`.

---

## 7. Statutory components (India) — as configuration tables, with honest scoping

For a 2026 India-focused hackathon, implementing these *as data* (not code) is what sells it.
Verify current rates with a finance source before demoing numbers; the point is the shape.

| Component | Shape | Implementation |
| --- | --- | --- |
| Provident Fund (EPF) | Employee 12% of (Basic+DA); employer 12% (3.67% EPF + 8.33% EPS). Statutory wage ceiling ₹15,000/month; many employers apply it on full basic | `PF_EMP = 12% of basic`, cap `LEAST(basic, 15000)` when `company_settings.pf_ceiling_enabled`. Also emit employer cost = same amount (dashboard "employer cost" chart gets this for free) |
| ESI (ESIC) | 3.25% employee / 0.75% employer while gross wage ≤ ₹21,000/mo (disability contribution changes the split; verify) | `condition: gross <= esi_wage_limit`, `pro_rata: true` |
| Professional Tax | State slabs; e.g. Gujarat ~₹200/month cap ₹2,500/yr, some states collect lump instalments in Feb/Aug | `pt_slabs` table `effective_from, wage_from, wage_to, monthly_amount, annual_cap`; engine applies **remaining-to-cap** logic — the one that breaks half-month runs |
| TDS on salary (s.192) | Project annual income → annual tax (regime-dependent) → divide across remaining months of the FY; 80C/80CCD/80D only in old regime; declarations + proof stage | `tax_declarations(employee, fy)` + `tax_slabs(fy, regime)` tables; monthly `TDS = (annual_tax/12) - already_deducted_this_fy`. **Simplify to a single slab table lookup for the hackathon** and label it "illustrative" |
| Bonus (Payment of Bonus Act) | 8.33–20% of eligible salary, pro-rated by working days | optional `reimbursement`/allowance rule |
| Gratuity | (last basic × 15 × years)/26 for >5 yrs | full-and-final only — roadmap |
| LTA exemption, HRA exemption | formula on receipts | roadmap (needs proof docs) |

Also worth a config row, because it's a real payroll control: **salary attachment/recovery**
(court orders, loan EMIs) = a DEDUCTION rule with `cap` = 50% of net. One line item, big
"we know payroll" credibility.

---

## 8. Payslip anatomy (what the PDF must contain — copy the industry layout)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ACME TECHNOLOGIES PVT LTD            PAYSLIP — 01 Feb 2026 to 28 Feb 2026  │
│ [logo]  GST/PAN/EST code block            Status: PAID · Ref: PS-2026-0234 │
├───────────────────────────────────────────────────────────────────────────┤
│ Name / Code / Dept / Designation / DOJ / Emp type / Bank (a/c masked       │
│ ****1234) / IFSC / PAN          | Location / Reporting manager / Contact no │
├───────────────────────────────┬────────────────────────────────────────────┤
│ EARNINGS              Amount  │  DEDUCTIONS                          Amount │
│ Basic Salary        47,500.00 │  Provident Fund (employee)        5,700.00  │
│ House Rent Allow.   19,000.00 │  Professional Tax                    200.00  │
│ Meal Voucher (×19)     570.00 │  Loss of Pay (1 day)              2,500.00  │
│ Overtime (4.5 h)     2,109.38 │  ESI                                 640.13  │
│ GROSS SALARY        69,179.38 │  TOTAL DEDUCTIONS                   9,040.13│
├───────────────────────────────┴────────────────────────────────────────────┤
│ NET PAY 60,139.25  ·  "Sixty Thousand One Hundred Thirty Nine and Paise    │
│ Twenty Five Only"                                                          │
├────────────────────────────────────────────────────────────────────────────┤
│ Days: Expected 20 · Present 18 · Paid leave 1 · Absent 1 · OT 4.5 h       │
│ YTD: Gross 425,062.50 · Deductions 52,200.00 · Net 372,862.50             │
│ Employer cost: +PF 5,700.00 +ESI 1,152.32 = 66,991.57                     │
├───────────────────────────────────────────────────────────────────────────┤
│ Generated 2026-03-01 10:04 IST by Priya (HR Payroll Manager)              │
│ Verification hash a91f3c · Not a tax receipt                              │
└───────────────────────────────────────────────────────────────────────────┘
```

Notes:
- **Amount in words** is expected on Indian payslips and takes 25 lines of code. Free "polish" point.
- **Masked account number** — never print the full a/c in an emailed PDF (it goes to a personal
  Gmail). This is a real security practice and easy to demo.
- **Verification hash** = `sha256(payslip_id + net_paise + pdf_bytes).slice(0,6)` printed on the PDF
  and stored in DB → lets anyone answer "was this payslip edited after issue?" Print the same hash on
  the portal. Cheap, memorable, and unusual in hackathon projects.
- The **status badge must differ for draft/computed/paid**: an emailed or downloaded DRAFT payslip is
  a real incident. Also watermark `PREVIEW — NOT PAID` on non-paid PDFs (see `08` §4).
- Rupee glyph `₹` (U+20B9) is **not** in the standard Helvetica/AFM fonts of pure-JS PDF libs →
  register a TTF (DejaVu Sans or Inter) and ship it inside the repo at
  `backend/src/lib/pdf/assets/fonts/`, don't rely on nix font dirs.

---

## 9. Worked example our seeds/tests must reproduce (Feb 2026)

Assumptions: Mon–Fri schedule, 8 h/day, Feb 2026 has 28 days with Sundays on 1, 8, 15, 22 and
Saturdays 7, 14, 21, 28 → **20 expected working days** (matches `api.md`'s `expected_working_days: 20`).
Basic ₹50,000/mo, HRA 40% of basic, meal voucher ₹30/paid day, OT ×1.5 on per-hour rate,
PF 12% of basic (no ceiling for this employee), PT ₹200, one unpaid absent day, one paid leave day,
4.5 h approved OT, `pro_rata` applied to Basic/HRA/voucher/LOP.

```
per_day      = 50000 / 20                = 2,500.00
paid_days    = 19                        (18 present + 1 paid leave)
Basic        = 2500 × 19                 = 47,500.00     # or 50,000 with LOP -2,500 → same net
HRA (40%)    = 47500 × 0.40              = 19,000.00
Meal voucher = 30 × 19                    =    570.00
OT           = (50000/20/8) × 4.5 × 1.5  =  2,109.38     # 312.50/hr × 1.5
GROSS        = 47500 + 19000 + 570 + 2109.38 = 69,179.38
PF (12% of earned basic = 47500)         =  5,700.00
PT                                     →  =    200.00
ESI (3.25% of gross, wage ≤ 21k? NO)     =      0.00     # gross far above limit → rule skipped
DEDUCTIONS                               =  5,900.00
NET                                      = 63,279.38
```

Two teaching points from this:
- the brief's own `api.md` shows the same payslip as
  gross 70,843.75 / ded 8,700 / net 62,143.75 **and** as gross 70,000 / ded 6,200 / net 63,800, with
  an OT line of 843.75 that doesn't match its own formula (312.5 × 4.5 × 1.5 = 2,109.38). Fix the
  doc examples so the sample data is engine-generated, or a sharp judge will add up your demo payslip
  and find it doesn't close.
- PF base = **earned** basic (pro-rated), not contracted basic. That single decision is why
  `pro_rata` must be a per-rule flag.

---

## 9. What the shipped engine actually does (audited 5 Sep 2026)

Every rule below is implemented in `backend/src/lib/payroll/`, is pure (no DB), and is covered by
`npm run test:unit` in `backend/` (43 tests) plus an independent hand-arithmetic audit of the seeded
structures. Numbers are from the seeded fixture: ₹85,000 wage, Mon–Fri 09:30–18:30 with a 60-minute
block, September 2026 = 22 expected days, Gujarat PT slabs, OXP Standard Salaried structure.

| Calculation | Rule as built | Verified value |
| --- | --- | --- |
| Calendar | `expected_days(from,to)` walks the schedule grid, skips rest days and holidays, clamps to joining/exit | Sept 22 days · Oct 21 (2 Oct is a Friday) · Aug 21 (15 Aug 2026 is a Saturday, so no extra loss) |
| Earnings | `PERCENTAGE` off `CONTRACT_WAGE`/`BASIC`/any earlier rule code, `FIXED` × quantity, or `FORMULA` | Basic 34,000.00 (40%), HRA 17,000.00 (50% of Basic) |
| Proration | factor = days in slice ÷ days in the **whole** month, per-rule `pro_rata` decides who scales | joiner on 14 Sep: factor 0.590909 → Basic 20,090.91, PF 1,063.64, bonus untouched (8,500.00) |
| Overtime | approved hours only → rounded to `overtime_round_to` → `hours × (wage ÷ expected days ÷ hours/day) × multiplier`, skipped under `overtime_min_hours` | 3 h → 2,897.73 · 1.1 h bills as 1.00 h → 965.91 · 0.1 h → no line |
| Loss of pay | `unpaid days × (month-equivalent gross ÷ divisor)` with divisor from `payroll_day_basis`; 2 half days = 1 day | 1 day absent → 2,879.55, PF and PT stay whole |
| PF | 12% of `min(wage, pf_wage_ceiling)`, employee and employer each from their own setting | 1,800.00 deducted · 1,800.00 employer (report line, outside net) |
| ESI | employee `esi_employee_pct` (0.75), employer 3.25, whole family exempt above `esi_wage_limit` | ₹20,000 stipend → 150.00 · ₹21,500 → 0.00 |
| PT | state slab lookup by wage, `pt_charge_slice` decides which half carries it, annual cap trims the last slip | 200.00 · H1 0.00 + H2 200.00 (never twice) · ₹2,400 already booked → 100.00 left of ₹2,500 |
| Caps & once-per-period | `cap_amount` (month) and `annual_cap` (fiscal year) measured against `prior.by_rule_*`; `MONTH_ONCE` zeroes the rule if the month already paid it | ₹500 × 22 days with a ₹5,000 cap → 5,000.00 · a `MONTH_ONCE` rule already paid → 0.00 — **on FIXED rules too**, not only percentages |
| Rounding | per line `rounding_mode` (exact / down to ₹ / up to ₹), then `round_net_to_rupee` adds one residual `ROUND_OFF` line on the net only | 1,250.44 → 1,250.00 or 1,251.00 · net 61,361.90 → 61,362.00 |
| Half month | `PRO_RATA`: each half on its own days. `ADVANCE_50`: H1 = advance % of the *whole-month* net, H2 = month − H1 actuals, residual on an adjustment line | month net 61,350.00 → H1 30,675.00 + H2 30,675.00; a +₹500 manual edit in H1 is recovered by H2 to the paise |
| Taxes/summary | taxable gross = earnings whose rule says `is_taxable`, printed on the slip and in the PDF; `appears_in_report` keeps a rule out of the salary-register sums | taxable 60,761.90 = gross − LTA − conveyance |
| Guards | `condition_expr` false → line skipped with a log; bad formula or unknown `base_code` → `RULE_ERROR` on the payrun (never a silent zero); `depends_on` reorders so a forward reference reads a filled worksheet; negative net → `NEGATIVE_NET` + arrear note unless `allow_negative_net` | — |

Two bugs the audit caught, both fixed:

- **Mid-month joiners and leavers were paid a full month.** `payroll.compute.js` divided the slice by a
  month expectation that was *itself* clamped to the service dates, so the factor came out 1. The
  denominator is now the unclamped month (`monthBase`), which is also the right divisor for OT and LOP.
- **A FIXED rule's cap and "month once" window did nothing.** `capPaise()` only ran for `PERCENTAGE` and
  `FORMULA`, so a half-month run paid a fixed monthly allowance twice and `cap_amount` on a per-day
  fixed rule was ignored. FIXED lines now go through the same cap/once logic, and the seeded LTA rule
  was re-marked `MONTH_ONCE` for exactly that reason.
