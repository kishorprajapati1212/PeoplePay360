# 14 · What is built, and what is not

Written after round 4, because "is this actually there, or is it a picture of a screen?" deserved one
place with the answer. Everything below was read out of the code in this tree — the counts come from
`node backend/scripts/routes-list.js`, and the "no UI" list from scanning `frontend/src` for each
endpoint path (the script that produced it is described at the end).

Two rules were kept while writing it: if a button exists, the endpoint behind it exists and is
registered; if a sentence describes a role, it was checked against `permissionsFor()` rather than
remembered.

---

## 1 · Round 4 — what each complaint turned out to be

| You said | What was actually wrong | What is there now |
|---|---|---|
| "the payroll admin cannot enter the system, even when I create a new one" | `frontend/src/pages/LoginPage.jsx` offered a **Payroll Admin** button that filled `payroll.admin@oxp.com`, while the seeder creates `payroll-admin@oxp.com` (hyphen). Clicking it could only fail, and a hand-typed retry then hit the login guard (8 attempts / 5 min, then 15 min cooling off). A newly created login also had no password shown or asked for, so nobody knew what to type. | The demo list is generated from the same addresses the seeder writes, and lists each role's real powers. `hr2@oxp.com` is on it too (it was seeded but never printed or documented). Creating a user now has an optional **Temporary password** box, and the success toast says which of the two passwords works. The password box on the login card can be shown while typing. |
| "payslip generation shows compute but there is no result" | Two bugs stacked. The run detail page read `run0.payslips`, but `GET /api/payruns/:id` answers with **`employees`** — so the table was empty whatever you computed. And the Compute button threw its response away and always said "Computed every payslip". | The table reads the run's own rows (`payrun_employees` joined to slips): compute state, gross/deductions/net, days, slip status, PDF and email per person, with a **Show only the ones with problems** switch. Compute now prints what happened — `n of m computed · k flags · j blocking errors`, plus the failed names with their codes (`NO_CONTRACT`, …) — and Validate says why it refuses. |
| "add payrun does not give the right result" | The wizard promised *"Period ends — blank = end of the month"* while `payrun.service.js` did `to = period_end \|\| period_start`: a blank end date produced a **one-day** period, so pro-rata paid roughly 1/30th and half the candidates looked like joiners/leavers. | `resolvePeriodEnd()` is one function used by `preview()`, `create()` and the candidate list, so all three agree on the last day of the month. The wizard shows the date it will use, `Period ends` cannot be earlier than `Period starts` (red note + the API's own `DATE_RANGE` check), and Create takes you into the new run instead of dropping you back on the list. A duplicate period is refused with a message that names the run that already exists. |
| "the leave dropdown does not show correctly" (screenshot) | `GET /api/time-off/types` required `timeoff:approve` **or** `timeoff:type_write`. An employee has neither — only `timeoff:type_read` — so the request form got a 403, and `Select` drew its 34px box with nothing in it. Not a z-index problem: the popover is already a `z-[100]` portal. | The route accepts `timeoff:type_read` (same broadening for `/types/:id`, `/allocations`, `/balances/:employeeId`, `/overview`). `Select` grew the states it should always have had: *loading*, *failed to load* (red, with the message), and *nothing to choose yet* (amber, with a sentence about what to do). Arrow keys and Enter work, and scrolling the dialog repositions the list instead of closing it. `MyTimeOffPage` now explains the empty case and links to the screen that fixes it. |
| "it says HR will assign the balance but there is no button" | There was one place to grant a balance: *Time Off → Allocations → + New*, one person at a time. The types screen had nothing, and the employee note only said "ask HR". | **Assign balance** is a row button on Time-off types (per type), and Allocations has an **Assign balance to many** panel: pick the type, tick people (search, All in view, None), days, the validity window, and what to do when someone already has a grant (skip / add on top / replace). It posts to the new `POST /api/time-off/allocations/bulk`, which is one transaction and reports `{applied, created, adjusted, skipped[…], not_found}`. The "0 balance" note in *My time off* links straight to it with the type pre-selected. |
| "make sure the email is actually sent, and that it goes to many" | The only bulk send was *per run* (`POST /payruns/:id/send`), it appeared only when the run was already PAID, and its result was never shown. Fixing one bounced slip meant opening each payslip. | New `POST /api/payslips/send` — a bulk release for a **selection**: by payslip ids, by payrun, by period (`YYYY-MM`), by employee list, or any combination. It skips rows without a PDF or a work email instead of failing the batch, defaults to "only what has not been sent for this document version", and returns the counts plus how it will be delivered (SMTP/Gmail via the worker, or the preview driver writing `.eml` files when no credentials are configured — now said in the toast, so a demo send that "did nothing" is explained rather than guessed at). Buttons: *Payslips → ✉ Email payslips…* (period or run), a per-row **Email** for one slip, and the run's own *Email payslips* step which reports `queued / skipped` from the response. |
| "some fields show active but there is no deactivate" | `CrudPage` had Edit and Delete only. Turning a configuration row off was possible in the API (`is_active` on types, structures, departments) with no way to reach it, and Delete is refused for exactly those rows because history points at them. | `CrudPage` grew an `active` prop → a per-row **Deactivate / Activate** button that PATCHes just that flag (boolean for departments, `ACTIVE`/`INACTIVE` for types and structures, decided from the row's own value), with a confirmation that says what stays untouched. Leave types also got **Show inactive** (the list accepts `?include_inactive=true`) so a switched-off row can be found again. Salary rules have no flag — they are retired by `active_to`, so they got a **Retire** row button that writes the date for you. Working schedules and Users already had their own switches. |
| "the seeder's payroll-manager data is incorrect" | `payroll@oxp.com` was seeded as `HR_PAYROLL_USER + HR_MANAGER` while the README told you it *cannot* validate, mark paid or void a run — it can (the deny list is only a veto when no other role grants it). `payroll-admin@oxp.com` was `HR_PAYROLL_MANAGER` alone, which is the role that *can* bulk-mail. | The seeds now match the documentation instead of contradicting it: `payroll@oxp.com` = `HR_PAYROLL_MANAGER` (owns the run end to end), `payroll-admin@oxp.com` = `HR_PAYROLL_MANAGER + HR_MANAGER` (the same, plus fixing the employee/contract behind a wrong slip), `hr2@oxp.com` = `HR_PAYROLL_USER` (compute/validate/mark paid, no bulk mail). The README table, `ROLE_HINT` in the Users screen and the login-page buttons all say the same, checked against `permissionsFor()` — the matrix in this repo's README §"Roles" is generated from that file. |
| "a warning is shown but clicking shows no warning" | The chip counted payslips whose `computation_summary → warnings` array is non-empty; the detail panel called `GET /payruns/:id/warnings`, which read a **different** source (`payslip_lines.computation_log ILIKE 'ERROR%'`). A soft warning therefore produced "1 warn" beside "No warnings". | Both read `computation_summary → warnings`. The panel lists every entry with its severity (⛔ ERROR / ▲ WARN), the rule code that raised it, the employee, and a link to the slip. The list chip is now labelled `n flagged · m blocked` with a tooltip, because those are counts of *payslips affected*, not of individual checks. |
| "so many places have no placeholder or validation — account number etc." | Only the mobile field was cleaned. Bank account, IFSC, PAN, UAN, ESIC, PIN code, colours and codes were free text; a typo like `hdfc-1234` reached the API and came back as a generic field error. | `PATTERNS` in `frontend/src/components/crud/schemaForm.jsx` is the single table of formats: `bank_account` (6–18 digits), `ifsc` (`^[A-Z]{4}0[A-Z0-9]{6}$`), `pan`, `uan` (12), `esic` (17), `aadhaar`, `pincode`, `phone`, `hex_color`, `code`, `email`, `rupees`. Each declares a placeholder, an input transform (upper-case, digits-only, paste `+91 98250 12345` → `9825012345`) and the sentence shown under the box. `fieldProblems()` runs them on save, so the dialog turns red instead of sending; `CrudPage` and the employee dialog use it, Company settings uses the same table. Applied to: employee create + edit (bank, IFSC, PAN, UAN, ESIC, PIN, email, job title/placeholders), Users (name, email, temporary password ≥10), Company settings (PIN code, sender mailbox, plus the previously missing `country`, `currency`, `currency_symbol`, `pt_state`, `pt_charge_slice`), Leave types (code, payslip code, colour). |
| extra things found on the way | — | The **Payslips** register had a "Any payrun" filter hard-wired to `options={[]}` — an empty dropdown; it now loads the runs, and gained a *Bank details missing* filter. `LeaveTypesPage` offered a `HALF_DAYS` unit and an `approval_route: MANAGER_THEN_HR` that the API enum does not accept (a guaranteed 400); both are gone. The account menu's *My portal* was shown to staff roles that have no portal route; it is now derived from the role's own menu. `PATCH /api/payslips/:id/inputs` existed on the server and in `endpoints.js` with **no screen calling it**, so a rule that warned "no input" had nowhere to be fixed: the payslip page grew a **Manual inputs** panel (code, label, rupees, reason; remove; recompute after). `api/client.js` did not refresh on a 401 despite what the README said: it now rotates the refresh cookie once per burst (single-flight) and replays the failed call, so a 15-minute access TTL no longer empties a screen mid-edit. |

---

## 2 · Built and wired (screen → endpoint → table)

Every row here has a real button or form on the named screen; nothing in this list is a stub.

| Area | Screens | Endpoints used |
|---|---|---|
| Sign-in, session, roles | Login card with role buttons, 401 refresh + replay, `/api/auth/me`-driven menu, permission-gated buttons everywhere | `POST /auth/login`, `/auth/logout`, `/auth/refresh`, `GET /auth/me`, `GET /auth/access-matrix` |
| Own password | Change-password modal in the account menu + the "still on the handed-over password" banner | `POST /auth/change-password` |
| Dashboard | Per-role tiles, counts, quick links | `GET /dashboard` |
| Employees | List, create (3 tabs: personal / job / salary+contract+bank), detail with contracts, attendance, time off, payslips, salary tabs, terminate dialog, manual inputs | `GET/POST /employees`, `GET/PATCH /employees/:id`, `POST /employees/:id/terminate` |
| Org | Departments (tree fields, activate/deactivate), working schedules (weekly grid, active switch), holidays (+ bulk generate) | `/org/departments*`, `/org/working-schedules*`, `/org/holidays*`, `/org/holiday-templates` |
| Contracts | List, create/edit, terminate, renew, expiring strip | `/contracts*`, `/contracts/:id/terminate`, `/contracts/:id/renew` |
| Attendance | Day grid, entry edit, clock in/out, overtime approval, exceptions, CSV export | `/attendance*`, `/attendance/clock`, `/attendance/:id/overtime`, `/attendance/exceptions`, `/attendance/export.csv`, `/payruns/:id/export.csv` |
| Time off | Types (policy per type, deactivate, assign balance), requests (approve/refuse/cancel), allocations (+ bulk grant), overview, carry-forward, my requests | `/time-off/*` incl. the new `/time-off/allocations/bulk` and `/time-off/carry-forward` |
| Salary structures & rules | Structures CRUD (+ deactivate, impact), rules CRUD with formula validator, preview against a wage, retire-by-date | `/salary/structures*`, `/salary/rules*`, `/salary/rules/validate`, `/salary/preview`, `/salary/pt-slabs` |
| Pay runs | Two-step wizard (structure, period, frequency, mode → candidates with estimated net), status board, compute/validate/PDFs/mark paid/email/void, salary-register CSV, PDF ZIP, per-person compute state, warnings, queue and delivery log | `/payruns*` (create, preview, employees, compute, validate, generate-pdfs, mark-paid, send, void, export.csv, zip) |
| Payslips | Register with filters (status, payrun, missing bank), detail with lines/inputs/arrears/history/downloads/PDF, bulk email by selection or period | `/payslips*`, `/payslips/send`, `/payslips/:id/{compute,lines,inputs,arrear,pdf,preview-pdf,print,history,downloads}` |
| Portal (employee) | My profile, my attendance, my time off + request form, my payslips + download through the ownership-checked route | `/portal/*`, `/auth/token-for-payslip/:id` |
| Settings | Company (≈35 switches in one documented table, format-checked), PT slabs (read), Users (create with password, roles, activate/deactivate, reset password), access matrix, queues/audit with retry + reclaim | `/company`, `/salary/pt-slabs`, `/users*`, `/system/jobs`, `/system/tasks`, `/system/tasks/:id/retry`, `/system/reclaim`, `/system/audit` |
| Cross-cutting | Toasts, error panels with retry, empty states that name the fix, 12 formatters, two themes with a checked contrast ramp, scroll-aware modals, ErrorBoundary, mobile nav | — |

**Route count: 153 registered endpoints** (`node backend/scripts/routes-list.js`).

---

## 3 · On the server, deliberately not in the UI

These work if you call them (curl, a script, an integration) — no screen offers them, and that is the
honest state rather than an oversight to hide:

* `POST /api/employees/import` and `POST /api/attendance/import` — CSV ingestion with per-row errors.
  No importer screen, although the API already answers `dry_run: true` with per-row errors — what is
  missing is the three-part form (paste → preview → commit), not the backend. `GET /attendance/export.csv`
  is a button on the Attendance header now, which is the round trip for preparing a file.
* `POST /api/salary/pt-slabs`, `POST|DELETE /api/company/pt-slabs*` — Professional Tax slabs are
  **read-only** in the UI (`Company → Payroll conventions` shows the flat amount, the annual cap and the
  charge slice). Editing a slab table by hand while a month is half-computed is how a state's PT gets
  applied twice; if you need it, the modal to add is small but the audit story is not.
* `GET /api/reports/{salary-register.csv,payroll-summary.csv,attendance.csv,payslips.zip}` — a
  convenience path family kept for links and scripts. The screens use the resource-scoped equivalents
  (`/payruns/:id/export.csv`, `/payruns/zip/:id`, `/attendance/export.csv`) because those carry the
  run's state with them.
* `GET /api/employees/me`, `GET /api/contracts/employee/:id` — the portal and the employee detail page
  use `/portal/*` and `/employees/:id/contracts` instead, which apply the ownership check.
* `GET /api/meta` — a liveness stub for probes; no UI needed.

## 4 · Not built, and what stands in place of it

| Not built | What this app does instead | Smallest step if you need it |
|---|---|---|
| Real bank disbursement files (NACH/EBank credit formats, IDBI/AADHP payroll upload) | `GET /payruns/:id/export.csv` is a plain salary register: employee code, bank account, IFSC, gross/deductions/net | One generator per format under `lib/exports/`, reusing the CSV's SQL; the run needs a "disbursement batch" state to mark what was handed over |
| Cheque / cash disbursement, payment references | `mark-paid` stamps the run with who and when; the note field is free text | a `payments` table (mode, reference, amount) + one form per payslip |
| Full & final settlement, notice pay, gratuity lump sums | Contracts can be terminated with a date and the final month computes pro-rata; gratuity is a salary rule if you model it as one | a settlement service that reads the contract history and produces a slip outside a normal run |
| Retro-active revision workflows (back-dated increments with arrears across months) | `POST /payslips/:id/arrear` raises one arrear slip against a chosen run | a "revision" entity that generates arrears across a range of periods in one go |
| Loan / advance schedules with EMI recovery | `advance_percentage` (half-month advance) + a MANUAL deduction line per slip | a recoveries table with instalment rows the engine consumes |
| Multi-company, multi-currency, cost centres | one company row (`company_settings`) with `currency` / `currency_symbol` shown on the payslip | a `company_id` on every table, and tenant scoping in the queries |
| Attendance device pulls (ZKTeco/biometric files), geo-fenced clock-in | `POST /attendance/import` (CSV), `POST /attendance/clock`, a `source` column per row | a device-file parser into the same import path; geofencing needs the mobile client |
| Inbound e-mail (bounce handling, payslip requests by mail) | `email_deliveries` records QUEUED/SENT/FAILED, and a failed row is reported in the run's delivery log | a webhook into `POST /system/…` that flips the ledger row |
| Digital signatures / tamper-evident PDFs | every PDF is hashed (SHA-256 stored per document version, shown on the slip page and in the download audit) | sign with an org certificate at render time; the hash is already the input |
| Self-service onboarding (invite link, first-login password set, document upload) | `FEATURE_INVITE=false`, `FEATURE_SSO=false` in the config; an admin creates the login and hands the password over | the invite token flow reuses `must_change_pw` (which is honoured: such a session is capped at 10 minutes) |
| SSO / OIDC | password login with a 5-attempt guard and a 15-minute lock-out window | `POST /auth/sso/callback` behind `FEATURE_SSO`; `user_role_grants` already supports external identities |
| A payroll "wizard" that walks the whole month | each step is a button on the run page, and the numbers are visible at every step | nothing missing structurally; it is a UX preference |
| Company GSTIN / CIN / PAN fields | `company_settings` has no such columns, so the Company screen cannot show them honestly | migration `0xx_company_tax_ids.sql` + 3 rows in the `SETTINGS` table + `gstin`/`cin`/`pan` patterns (already in `PATTERNS`) |
| Retention purge | `document_retention_years` is stored, edited and shown; nothing deletes | a nightly worker job that ages out `payslip_documents` and mail `.eml` files |

## 5 · Verified how

`bash scripts/check-syntax.sh`, `node backend/scripts/check-api-imports.js` (static import graph + real
ESM load of every backend module), `node backend/scripts/routes-list.js` (153),
`node backend/scripts/test-unit.js` (49 tests: the payroll engine, period math, the route contracts the new buttons need, and RBAC — no database),
`node --test backend/test`, `npm run build` for the SPA, `python3 scripts/check-contrast.py` (898 class combinations resolved against both themes and measured with the WCAG formula — 0 under the floor, after three light-theme chips were darkened in `theme.css`), and `npm run test:ui` (`scripts/ui-probe/`) — 12 cases that render
the screens this round touched in jsdom against a stubbed API and assert the text on them. Two real bugs came
out of writing it: a row action whose `show(row)` predicate ran with no row at all, and an early
`return <NoAccess/>` sitting above two hooks in `CrudPage`, which made React render a different number of hooks
the moment `/auth/me` arrived. The probe now pins both. What cannot be verified in this sandbox: anything that needs
Postgres or Redis — the seeder, `npm run smoke`, and a real SMTP delivery — so those are described by
their code path, not by an executed run.
