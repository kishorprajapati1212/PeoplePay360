# 01 — What I understood from the problem statement

## 1. One sentence

Build a **connected** HR + payroll platform where an employee's master data, contracts, schedules,
attendance, leave, and configurable salary rules all feed one deterministic engine that produces
correct, explainable, PDF-able payslips — *not* five CRUD screens with a calculator bolted on.

The PDF says this explicitly:

> "The goal … is to build an HR and Payroll platform that goes beyond simple employee CRUD screens
> and becomes a connected operational flow."

and again in the guidelines:

> "Ensure Salary Rules actively drive Payslip generation; configuration screens must be fully
> functional and integrated, **not static mockups**."

That "not static mockups" line is the whole project. The highest-value thing you can do is make the
configuration (salary structures + rules, schedules, leave types, holidays) **actually change the
numbers on a payslip live, on stage**.

## 2. The chain the judges want to see fire end-to-end

```
users/roles ─┐
             ├─> employees (hub) ──> contracts (period-scoped, 1 active)
schedules  ──┘        │                     │
                      │                     ├─> salary_structure ─> salary_rules (sequenced)
attendance ───────────┤                     │
time off (alloc/req) ─┘                     ▼
                                    PAYRUN (batch: scope+period+employees)
                                            │
                                     compute │  ← engine: expected days → paid days →
                                            │     rules in sequence order → gross →
                                            │     deductions → net → YTD
                                            ▼
                                   payslips + payslip_lines
                                            │
                            validate/warn   │  ← missing bank, dup, negative net, unapproved OT
                                            ▼
                                    mark paid (locked, immutable)
                                            │
                        ┌───────────────────┴───────────────────┐
                        ▼                                       ▼
                  PDF per payslip                        dashboard KPIs/charts
                  (async worker)                         (live aggregates)
                        ▼
                  bulk email (async worker, Redis queue)
                        ▼
                  employee downloads same PDF from self-service portal  ← YOUR EXTRA FEATURE
```

## 3. What each module must really do (my reading)

| Module | The non-obvious requirement |
| --- | --- |
| Employee master | Employee is the **hub**: smart buttons with counts that deep-link into filtered Contracts/Attendance/Time Off views. Kanban + List + Form. |
| Contracts | History must be preserved, but payroll must pick exactly the contract valid **for the pay period** — not "the latest one". Promotion mid-year ⇒ two payslips with different wages in different months. |
| Working schedule | Weekly hours are **derived**, never typed. They define (a) expected hours/day → overtime, (b) which days are working days → expected days in a period. Saturday/Sunday patterns differ per employee. |
| Attendance | Check-in/out → worked hours → overtime → status. Exceptions (absent, late, missing check-out) are reviewable; HR corrections are allowed but **flagged `is_manual` with a reason**. |
| Time off | Types → allocations (balances) → requests → approve/refuse. Approval must **consume** the allocation and must be reversible on cancel/reject. Unpaid leave must reach payroll as Loss of Pay. |
| Salary structure/rules | Rules are typed (fixed / percentage / formula), ordered by sequence, categorised (BASIC/ALLOWANCE/GROSS/DEDUCTION/NET), and are the *only* source of payslip numbers. |
| Payrun | 2-step wizard (scope → employee selection), then Compute → Validate → Mark Paid. Warnings before finalising. Paid = immutable archive. |
| Payslip | Line-by-line explainability + YTD + PDF. |
| Delivery | PDF generation + bulk email, async (your Redis/worker story). |
| Dashboard | Live aggregates from the same tables: KPI cards, salary-by-department, monthly trend, attendance & leave overview, operational alerts. |

## 4. Roles (5) — implement the matrix literally

`EMPLOYEE`, `HR_MANAGER`, `HR_PAYROLL_USER`, `HR_PAYROLL_MANAGER`, `ADMIN`.

The interesting boundaries in `user-flows.md`:

- HR Manager has **zero payroll visibility** (cannot see payslips or salary rules) — this is a
  deliberate segregation-of-duties design, mirror it exactly.
- `HR_PAYROLL_USER` may **create + compute + mark paid** but **may NOT** trigger bulk send and may
  NOT edit salary rules. `HR_PAYROLL_MANAGER` is the only role that can hit the big red "Send
  Payslips" button. That is a great, demonstrable permission test.
- Only `ADMIN` manages users, roles, audit logs.

Because the spec ships a testable permission matrix, RBAC should be data (`role → permission` map)
enforced by one middleware — not `if (role === 'ADMIN')` scattered in 40 controllers.

## 5. What is being scored (my inference from sections 6–8)

1. **Business-logic complexity** — period-based contract selection, leave consumption, rule
   sequencing, payroll error detection.
2. **Unified flow** — one click path from hire → payslip → email → download.
3. **Architecture** — RBAC, parent/child relations, historical tracking, aggregate analytics.
4. **Real-time dashboard** (no fake charts) and **PDF + bulk email from the payrun workflow**.
5. **Live 5-minute demo** of two end-to-end scenarios + a roadmap slide.

So: a smaller feature set that is genuinely wired beats a wide mockup. Also budget for the demo:
seed data that *has* problems in it (missing bank, unapproved OT, pending leaves) so the warning
panel and dashboard alerts light up without you faking anything.

## 6. The six traps I expect to bite teams (and us)

1. **Money as floats** → `0.1 + 0.2`, payslip lines that don't sum to the printed total. Judges
   love adding up a payslip by hand.
2. **Rule ordering / dependency bugs** → HRA computed before Basic, GROSS rule summing deduction
   lines, negative net silently allowed. Need cycle detection + a "why is this line this value"
   trace per rule.
3. **Attendance timezones and cross-midnight shifts** → night shift 22:00→06:00 gives negative
   worked hours in the trigger in `schema.md` (see `06-schema-review`).
4. **Double payment via half-month runs / recompute after PAID** → needs idempotency +
   "already-paid in this period" guards + arrear/adjustment lines instead of silent overwrite.
5. **Bulk email that isn't idempotent** → a re-click mails 50 employees twice. Needs a job
   dedupe key, a delivery ledger, and a 202+status flow.
6. **Privilege escalation in the API as designed** → `POST /attendance/checkin {employee_id}` and
   `POST /auth/register {role}` as currently written let any employee clock-in for someone else and
   let anyone self-assign `HR_PAYROLL_MANAGER` (see `07-api-review`).

## 7. Your extra features, and how I'd frame them

- **Half-month / custom-period payslips** — not an add-on; it is the natural consequence of making
  the engine period-driven. HR picks 1–15 or 16–end (or any range), engine prorates by expected days
  in *that* range, statutory caps are applied once per real month, second half reconciles the first
  half with a "Less: paid in first half" line. Built in `backend/src/lib/payroll/halfmonth.js`; the
  arithmetic, with numbers, is `13-how-a-payslip-is-computed.md` §4.
- **Employee self-serve payslip download** — turns the bulk-email feature from "nice" into
  "operationally safe": email is a notification, the portal is the source of truth. Needs ownership
  checks, status gating (never expose a DRAFT payslip), on-demand generation with the *same* queue,
  caching by content hash, and a download audit row. Also enables a genuinely useful "download last
  12 payslips as ZIP" for loan applications.

Both are cheap to build if the schema reserves the fields for them now (`payslip_kind`,
`pay_frequency`, `payslip_documents`, `pro_rata` flag on rules). That reservation is why we are
writing these docs before code.
