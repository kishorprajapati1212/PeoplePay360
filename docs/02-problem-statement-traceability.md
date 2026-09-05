# 02 — Problem statement → implementation traceability

Every requirement extracted from the PDF (sections 4A/4B, 7, 8), mapped to how we satisfy it.
**M** = must-have for scoring, **S** = stretch. "Where implemented" names the screen, the endpoint and the
table, so any row can be checked in one minute; `../README.md` §5 is the running-thing version of the same list.

## A. HR Backend (configuration & master data)

| ID | Requirement (PDF) | Where implemented | Acceptance check | Ph |
| --- | --- | --- | --- | --- |
| A1 | Employee Kanban + List + Form views | `web: /employees` (3 view toggles), `GET /employees` | Same data renders in all 3; Kanban groups by department/status | M |
| A1 | Form captures department, manager, schedule, job position, status | `employees` table + `PATCH /employees/:id` | Edit department → list reflects it | M |
| A1 | Quick links from list and from form to related Contracts/Attendance/Time Off | `GET /employees/:id` returns `counts` → smart buttons open `/attendance?employee_id=…` | Click "18 attendance" → filtered attendance list | M |
| A2 | Contract history preserved; list shows dates, wages, status; active highlighted | `contracts` + `GET /contracts?employee_id=` | Old contracts remain after new one created | M |
| A2 | Contract form captures duration, dept, position, wage, salary structure | `POST /contracts` | Structure chosen → drives payslip rules | M |
| A2 | **Payroll uses only the contract applicable to the period; no concurrent active contracts** | partial unique index + `resolveContract(employee, period_start)` | Same employee, hike effective Feb 1: Jan payslip uses old wage, Feb uses new | **M★** |
| A3 | Schedule List (name, type, weekly hours) + Form with day/start/end/break | `working_schedules` + `GET/POST /schedules` | — | M |
| A3 | Weekly hours auto-calculated, not typed | DB trigger (or service-layer calc — recommended, see `06` §3) | Change a break to 0 → weekly hours change | M |
| A3 | Schedules assigned to employee **or** contract | both FKs exist; contract overrides employee | Night-shift employee gets OT differently than fixed | M |
| A4 | Time Off reachable from main nav: Requests, Allocations, Types | `web: /timeoff/{requests,allocations,types}` | — | M |
| A4 | Types define unit (days/hours), allocation requirement, approval, payroll link | `time_off_types` with `category` (Casual / Sick / Earned / Privilege / Compensatory / Maternity / Paternity / Unpaid / LOP / Other — migration `012_leave_category.sql`) and the pay treatment that writes `is_unpaid` + `payslip_code = 'LOP'` | Sick = paid, LOP = unpaid → affects payslip; `?category=CASUAL&pay=UNPAID` filters the same way | M |
| A4 | Allocations track taken/remaining/validity, approval needed before available | `time_off_allocations` | Balance shown before request | M |
| A4 | **Approved request auto-deducts allocation; transparently linked** | service-layer in one transaction | Approve → remaining drops → linked from allocation view | **M★** |
| A5 | Structures = containers of rules; list shows rule count, employee count, active | `GET /salary-structures` (add `employee_count`) | — | M |
| A5 | Structure form manages rules + execution sequence | `PUT /salary-structures/:id/rules/order` | Drag rule below another → payslip changes | M |
| A5 | Structure selected on payrun dictates rules applied | `payruns.salary_structure_id` | Two structures → two payruns → different lines | M |
| A6 | Rules: Name, Code, Category, Sequence in List+Form | `salary_rules` | — | M |
| A6 | Categories separate Basic/Allowance/Deduction/Gross/Net | `rule_category` enum + aggregation contract (`03` §5) | GROSS excludes deductions | M |
| A6 | **Rules processed in sequence so dependencies resolve** | compute loop `ORDER BY sequence` + cycle check | HRA % of basic works only because basic first | **M★** |
| A6 | Fixed / percentage / formula computations | `computation_type` + formula parser | Live-edit formula → recompute | **M★** |
| A7 | Dashboard shows live metrics from real records | `/api/dashboard` aggregates only | No hardcoded numbers anywhere in dashboard | **M★** |
| A7 | Filter by period, department, employee type | `?period_start&period_end&department_id&employee_type` | Filter changes every card | M |

## B. Frontend (operational experience)

| ID | Requirement | Where | Acceptance | Ph |
| --- | --- | --- | --- | --- |
| B1 | Top nav: Employees, Contracts, Attendance, Time Off, Payroll, Reports | `AppShell` nav filtered by role | Employee sees only portal | M |
| B2 | Employee form = identity, role, dept, manager, schedule, status + smart buttons | `/employees/:id` | — | M |
| B3 | Attendance global list; columns in/out/worked/status | `/attendance` | — | M |
| B3 | Attendance form supports manual correction restricted to authorized users | `PUT /attendance/:id` (HR+) writes `is_manual`, `manual_reason`, `edited_by` | Employee gets 403 | M |
| B3 | Attendance retained for reporting/dashboard | aggregates read the same table | — | M |
| B4 | Requests only via Time Off → Requests | route guard | — | M |
| B4 | Request list: employee, type, dates, duration, status | `GET /timeoff/requests` | — | M |
| B4 | Approve/refuse workflow on the form | `POST …/approve`, `…/refuse` | Refuse needs reason | M |
| B4 | Approved reduces balance for allocation-based types | see A4 | — | M |
| B5 | NEW launches a wizard; Step 1 = scope (structure, period); Continue without creating | `web: PayrunWizard` step 1 | No row in DB after step 1 (**test this**) | **M★** |
| B5 | Step 2 filters eligible staff for explicit selection | `GET /payruns/eligible-employees?structure&start&end` (missing in your api.md) | Only active + has-contract + has-schedule | **M★** |
| B5 | Create Payrun initialises batch with only selected employees, opens processing view | `POST /payruns` | 50 checked → 50 payslips after compute | M |
| B6 | Payrun form actions: Compute, Validate, Mark Paid, Send Payslips | `POST /payruns/:id/{compute,validate,mark-paid,send}` | Buttons disabled by status machine | M |
| B6 | Shows run name, structure, period, status, payslip summary | `GET /payruns/:id` | — | M |
| B6 | Highlights warnings (missing bank, duplicate payslips) before finalisation | `POST /payruns/:id/validate` | Cannot mark paid with ERROR-severity warnings | **M★** |
| B6 | Finalized/paid batches preserved as history | status machine locks rows | Delete after PAID → 409 | M |
| B7 | Payslips via parent payrun or dedicated list | `/payslips` | — | M |
| B7 | List columns: employee, structure, payrun, period, status, worked days | `GET /payslips` | — | M |
| B7 | Salary computation section: Basic, Allowances, Deductions, Gross, Net | `payslip_lines` ordered by sequence | Hand-add the lines and it equals Net | **M★** |
| B7 | Computation uses applicable period contract + payrun structure | engine (no per-request override) | — | M |
| B8 | Print Payslip action → PDF per employee | `POST /payslips/:id/pdf` + `GET /payslips/:id/pdf` | PDF opens, numbers match screen | M |
| B8 | Parent payrun → Send Payslips bulk email | `POST /payruns/:id/send` (202) | 50 employees get one mail each, no dupes | **M★** |
| B9 | KPI cards: net salary paid, payslips generated, avg salary, approved time off, attendance health | `GET /dashboard` | — | M |
| B9 | Charts: salary cost by department, monthly net trend | same payload | — | M |
| B9 | Alerts: payroll statuses, missing required info, duplicate payslips, contract attention | `dashboard.alerts` (needs contract-attention query) | — | M |
| B9 | Attendance/leave overviews incl. missing check-outs, manual edits, coverage, pending requests, balances | `dashboard.attendance_overview` (extend: `missing_checkout`, `manual_edits`, `coverage_pct`) | — | **M★** |
| B9 | Department breakdown = headcount + spend | `salary_by_department` | — | M |

## C. Technical guidelines (section 7)

| Guideline | Our compliance strategy |
| --- | --- |
| Any stack allowed | Node 20+, Express, React+Vite, PostgreSQL (`dev.nix` service), Redis (BullMQ), JWT+bcrypt |
| Business rules in application logic, not hardcoded | Every number comes from config tables: `salary_rules`, `working_schedules`, `holidays`, `time_off_types`, `company_settings` (divisor policy, PT table). Grep-forbidden: any literal `0.12`, `200`, `50000` in `src/`. |
| Salary rules actively drive payslips; config screens functional | Demo step: change HRA 40%→35%, recompute, watch payslip move. Requires "recompute a computed payrun" to exist. |
| Surface issues before finalisation | Warning engine with `severity: ERROR|WARNING`, blocks `mark-paid` on ERROR |
| Dashboard real-time from operations | Single SQL-heavy endpoint + `COUNT/SUM` over live tables; no seeded chart data |
| PDF + bulk email from payrun workflow | Redis-backed worker; SSE progress bar; delivery ledger |

## D. Deliverables (section 8)

| Deliverable | Plan |
| --- | --- |
| Functional platform with representative data | `npm run db:seed`: 13 employees, 5 staff logins (one per role) plus a login per employee, 3 structures, 3 schedules, 6 months of attendance, half-month and monthly payruns, leave history, deliberately seeded anomalies |
| 5-min live demo, two end-to-end scenarios | Sign in as `admin@oxp.com` (README §4). Scenario 1: Employees → New (10-digit mobile, code assigned for you) → Contracts (wage) → Payroll → Payruns → compute → validate → PDFs → mark paid → send → the employee downloads the same PDF from /portal/payslips. Scenario 2: Time Off → Allocations (grant days) → a request from the employee's login → approve → the next compute shows the LOP line, with the engine's own sentence under it (`13-how-a-payslip-is-computed.md`). |
| Future roadmap slide | 1-page: tax filing/Form 16, employer cost & accruals, loans/advances, multi-currency, ESIC/PF challans, biometric integration, audit diff view, mobile app |
| Mockup reference | `https://app.excalidraw.com/l/65VNwvy7c4X/17vHpCNFjex` — open it once and mirror layout so UI matches the brief's mental model |

## E. Explicitly out of scope (say this in the roadmap slide, don't build)

Accounting journal entries / GL posting, payslip→bank file formats (NACH/SEPA), income-tax filing,
multi-company, multi-currency, recruitment, appraisal/salary package configurator, timesheet
work-entries system, DTS/e-invoicing, PDF e-signatures, LDAP/SSO.
