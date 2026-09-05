# 09 — Build plan (phases), seed design, demo script, cut-list

Total ≈ 55–60 focused engineer-hours. If you have ~2 days: **Phase 0,1,2,3,4,7 + the half of 5/6 marked
MVP** and skip 8/9 (which are your extras… except the two extras the user asked for — those are in
Phase 7/8 and must stay).

Every phase ends with: `npm run test` green, `git commit`, and the phase's DoD pasted in the PR/commit
message. Do not start Phase N+1 with Phase N's DoD unmet — that's how hackathon projects die.

---

## Phase 0 — Harness & environment (3 h) · *blocking risk, do it first*

Goal: a running skeleton where **install, migrate, boot, login, healthcheck** all work in Project IDX.

- `git init`, npm workspaces (`apps/api`, `apps/worker`, `frontend`, `backend/src/lib/shared|payroll|formula|pdf|mailer`), ESLint+Prettier, `.env.example` (from `05` §8), `README.md` skeleton.
- `.idx/dev.nix` exactly as `05` §2 → **rebuild the environment and confirm `psql` + `redis-cli` both answer**.
  This one step retires the three scariest unknowns (native `npm i bcrypt`, Postgres service, Redis socket).
- `db/migrate.js` (ordered `.sql` files, `schema_migrations`, txn-per-file, `--reset`, `-- no-transaction`
  directive) + `001_enums.sql`, `002_users.sql`.
- `backend/src/lib/shared/{money.js,dates.js,permissions.js,zod/*.js}` + `backend/src/lib/payroll` empty module with one
  passing test (`toPaise('0.1')+toPaise('0.2') === 30`).
- Express `/healthz` (checks pg + redis, returns `{ok, db, redis, uptime, version}`), pino logger, error
  handler, `app.set('trust proxy', 1)`, helmet/cors. Vite React app with a `Login` shell + `api/client.js`
  (relative `/api`, JSON, bearer, 401 → refresh-once-then-logout).
- `scripts/dev.sh` (kill stale ports via `lsof -ti:4000 | xargs -r kill`, then `concurrently`), `scripts/smoke.sh` (login → /healthz).

**DoD:** in a fresh IDX workspace: `npm run setup` → `npm run dev` → preview shows login page →
`curl -s localhost:4000/healthz | jq .redis` = `true` → `npm t` passes. **Commit `package-lock.json`.**

## Phase 1 — Schema v2 (4 h)

Apply all of `06-schema-review` (items 1–24), in migration files:
`003_departments_schedules.sql` (+`day_hours()` and fixed `calc_weekly_hours`), `004_employees.sql`
(sequence default, unique email, FK fixes), `005_contracts.sql` (**no status-based selection**, partial
unique indexes), `006_attendance.sql` (fixed trigger + `vw_attendance_exceptions` +
`payroll_calendar()`), `007_timeoff.sql` (`is_unpaid`, `duration_unit`, allocation approval columns,
service-layer balance math — remove `deduct_leave_balance` trigger), `008_holidays.sql`
(+ `holiday_templates`), `009_salary_config.sql` (new rule columns incl. `evaluation_period`,
`pro_rata`, `base_code`, unique sequence), `010_payruns_payslips.sql` (paid_at/locked_at, `period_key`,
`payslip_kind`, `month_anchor`, `line_kind`/`amount_signed`, `recalc_payslip_totals`),
`011_queue_and_delivery.sql` (task_queue additions, `email_deliveries`, `payslip_documents`,
`payslip_downloads`), `012_auth_tables.sql` (`refresh_tokens`, `invitations`, `password_resets`),
`013_config.sql` (`company_settings`, `pt_slabs`, `tax_slabs`, `tax_declarations`, `payslip_inputs`),
`014_audit.sql`, `015_indexes.sql` (+ GIN tsvector), `016_views.sql`.

**DoD:** `npm run db:reset` twice in a row → same schema hash; `psql` `\d payslips` shows
`period_key`, `month_anchor`, `amount_signed`; the three 🔴 trigger fixes demonstrably work — write
`db/tests/triggers.sql` asserting weekly hours for the 22:00→06:00 schedule = 40 and that a
leave-status attendance row keeps `ON_LEAVE`.

## Phase 2 — Auth + RBAC + audit (5 h)

`auth.service` (login/refresh/logout/me/forgot/reset), bcrypt cost 12 (measure; log the number),
`requireAuth` + `requirePermission(perms)` from `backend/src/lib/shared/permissions.js` (the matrix in
`user-flows.md` as **data**), `ownEmployeeId` injection, audit helper, rate limit via Redis.
Frontend: login, `ProtectedRoute`, `Can` component, role-based nav, `/admin/users` (list/create/edit/
role/deactivate/reset).

**DoD:** a table-driven test asserts every cell of the permission matrix (`roles × routes → 200/403`),
including the two spicy ones: employee cannot pass another `employee_id`, and self-registration cannot
set a role. `POST /auth/register` is **removed**; `POST /employees` creates user + invitation
(one-time token → `/set-password`).

## Phase 3 — HR master data CRUD (6 h)

Employees (Kanban/List/Form + smart buttons with counts), Contracts (+ conflict preview + terminate),
Schedules (weekly grid, auto hours), Departments, Holidays (+expand-recurring). Server-side
pagination/search/sort. `PATCH` everywhere with zod. Employee form is the hub — spend the UI time on
its **smart buttons + related-record navigation**, since that's B1/B2 of the PDF.

**DoD:** create employee → contract auto-activates & expires the previous one → the counts on the
employee form are right → filtered deep links work → audit rows exist for each mutation.

## Phase 4 — Attendance + Time off (6 h)

Check-in/out for self (`/me/attendance/*`), HR list with exception filters + manual correction,
overtime approval; leave types, allocations (create + approve + balances + expiry), requests
(submit → team queue → approve/refuse/cancel/partial) with **balance math in a service transaction**,
overlap checks, sandwich rule flag, `payroll_calendar()` exposed as a debug view in the employee form
("what payroll sees for Feb").

**DoD:** tests — approve consumes, refuse refunds, partial approval refunds the difference, two
in-flight requests can't overspend, hours-unit leave doesn't corrupt days, and
`worked+leave+absent+holiday == expected` for a seeded month.

## Phase 5 — Payroll engine + salary config (8 h) · *the heart*

`backend/src/lib/formula` (tokenizer → allowlist parser; **no `eval`/`new Function`**; unit tests rejecting
`process.exit()`, `this`, `constructor`, `require`, `=>`, `;`, `fetch`), `backend/src/lib/payroll`
(`expectedDays`, `contractForPeriod`, `buildContext`, `runRules`, `applyProRata`, `applyCap` with
`evaluation_period`, invariants assert, `trace`), rule CRUD + reorder + `validate` dry-run,
structures list with rule/employee counts, statutory seed data (`pt_slabs` for Gujarat, PF/ESI rules),
`payslip_inputs`, employer cost.

**DoD:** `vitest backend/src/lib/payroll` green with the 10 invariants from `03` §6 + the Feb-2026 worked
example from `03` §9 asserted **in paise**; and a test that changing HRA 40%→35% changes only the HRA
and GROSS/NET lines. Manual check: hand-sum a printed payslip and it closes to the paisa.

## Phase 6 — Payrun workflow (6 h)

Wizard (step 1 scope incl. `pay_frequency`/`compute_mode`, no DB write; step 2 `eligible-employees`
with blockers), `POST/GET/PATCH/DELETE /payruns`, `compute` (per-employee try/catch →
`payrun_employees.compute_status/error`, batch in chunks of 20 in one txn, lock via
`SET NX PX` + `status` guard), `recompute` (DRAFT/COMPUTED/VALIDATED only), `validate` (warnings table +
persists VALIDATED), `mark-paid` (requires VALIDATED, locks rows: trigger `BEFORE UPDATE ON payslips
WHERE old.status='PAID' → RAISE`), `unpay` for managers, payrun detail screen with status badges,
warnings panel, payslip detail with trace, PDF-list read.

**DoD:** compute 45 employees in < 2 s; double-click compute is safe (idempotency + row lock);
editing a PAID payrun → `409 LOCKED`; recompute bumps `document_version`; warnings block
`mark-paid`; `npm run smoke` covers this whole path headlessly.

## Phase 7 — Async delivery: PDF + bulk email + progress (7 h)

BullMQ queues (`ppdf`, `pmail`) with `queue/producer.js` writing `task_queue` in the same txn;
`pdfQueue`/`mailQueue` workers in `apps/worker`; `backend/src/lib/pdf` (pdfkit layout per `03` §8 + watermark +
`rupeesInWords` + font from `assets/fonts`); `backend/src/lib/mailer` (Ethereal/Gmail/`file` drivers, quota
guard, failure classification, masked a/c); `GET /payruns/:id/status` from the ledger;
`GET /payruns/:id/stream` SSE + `usePayrunProgress` progress bar; `retry-failed`; `reclaimStalled`
on boot; `bull-board` at `/admin/queues` (⚙); `SIGTERM` shutdown.

**DoD:** send a 45-employee payrun → progress bar advances → 45 rows SENT in `email_deliveries` →
open the Ethereal inbox and **see 45 emails with 45 valid PDFs**; kill the API mid-batch and restart →
ledger shows what's incomplete and `retry-failed` finishes it; click Send twice → **no duplicate
mail** (assert `email_deliveries` count stays 45).

## Phase 8 — The two extras (6 h)

Implement `08` Part 1 (half-month/custom period + reconciliation + `MONTH_ONCE` statutory + arrear)
and Part 2 (portal download with on-demand generation, `released_at` gating, `payslip_documents`,
`payslip_downloads`, ZIP). Include `POST /payruns/preview` and `/api/employees/:id/month-ledger`.

**DoD:** H1 then H2 for the same employee where H2 has an unpaid day → H1 ₹32,300.00, H2 shows the
advance line and either closes to ₹64,400.00 total or raises `NEGATIVE_NET` with the carry option (both
asserted by tests); PT charged once; ESI decided on month-equivalent; YTD includes halves; portal
download works for a slip whose PDF was never generated (202 → PDF in <3 s); a DRAFT slip is
invisible via API **and** its `/pdf` returns 404.

## Phase 9 — Dashboard, reports, polish, pitch (7 h)

`/api/dashboard` (all B9 metrics + filters period/dept/employee_type, alerts incl. contract attention,
missing bank, pending > 48 h, duplicate period, half-month imbalance) with **one SQL CTE bundle** and
`recharts`; `export` (CSV bank sheet, PDF ZIP); audit-log UI with old/new diff; empty states, loading
skeletons, toast system, status colour legend; `README.md` (setup, architecture diagram, decisions,
how to reset demo state in 20 s); 10-slide pitch deck; roadmap slide; seed-state snapshot
(`npm run demo:arm` → puts the DB in "best possible demo state": Feb payrun DRAFT with 2 warnings, 3
pending leaves, H1 paid and H2 pending).

**DoD:** a colleague can run the 5-min demo from the README alone, on their own machine or a fresh
workspace, with zero help from you.

---

## Seed design (make the data *prove* the features)

```
1 company · 4 departments · 3 schedules (Standard Mon–Fri 40h, Mon–Sat 48h, Night 22–06)
45 employees: 40 ACTIVE, 2 ON_LEAVE, 2 TERMINATED (mid-history, so contract-period selection matters),
              1 joined 10 Feb 2026, 1 with NO bank details, 1 with NO schedule, 1 hourly-ish contractor,
              2 with an overlapping-contract attempt (should be blocked), 1 salary revised effective 01 Feb
users         : 1 ADMIN, 2 HR_MANAGER, 2 HR_PAYROLL_USER, 2 HR_PAYROLL_MANAGER, 36 EMPLOYEE (pw: Demo@1234)
2 structures  : Regular Salary (9 rules), Contractor (3 rules) + Intern Stipend (2)
rules         : BASIC, HRA 40%, LTA, MEAL (qty × paid days), OT (formula+condition), TRANSPORT (cap),
                PF 12% (MONTH + ceiling), PT (MONTH_ONCE + annual cap), PROF_TAX condition basic>…,
                ESI (condition month_gross<=21000), LO_P (formula), GROSS (REPORT), NET (REPORT)
holidays      : 2026 calendar incl. 26 Jan, 15 Aug, 02 Oct, 25 Dec + Republic Day Saturday (edge case!)
time off      : types Casual/Sick/Earned/LOP/Comp-Off (unit days), Unpaid-Work (unit hours)
                allocations for FY2025-26 and FY2026-27, 3 PENDING + 2 APPROVED + 1 REJECTED requests,
                one approved leave SPANNING a half boundary
attendance    : 6 months generated from schedules with realistic noise: ~4% absent, 6% late (>15 min),
                8% OT (0.5–4 h, some unapproved), 2% missing check-outs, 3 manual HR edits,
                one half-day, one cross-midnight night-shift record (proves 06 #2)
payroll       : 6 monthly payruns Sep–Jan (COMPUTED→PAID, PDFs generated, emails "sent"),
                Feb payrun left DRAFT (this is what you compute live on stage),
                Feb H1 PAID + H2 DRAFT for the half-month demo, one ARREAR in a past month
audit         : naturally accumulated by the generators (do not fake audit rows)
```

Generator rules: **payslips must be produced by calling the real engine** (never inserted by hand), or
your dashboard/validations demo against data the engine can't reproduce. And make
`npm run db:reset` finish in < 60 s — you'll run it 30 times.

## The 5-minute demo script (map it to §8 of the PDF: two end-to-end scenarios)

| Time | Action | What the audience sees (requirement it proves) |
| --- | --- | --- |
| 0:00 | Login as **Admin** → seed state shown in one sentence | architecture, RBAC |
| 0:20 | As **HR Manager**: open Rahul's employee form → smart buttons → 3 contracts (one EXPIRED) | A1/A2 unified hub, history preserved |
| 0:50 | HR: create contract with hike effective 1 Mar → old auto-expires → open Feb payrun later to show Feb still uses 50k | ★ period-based contract selection |
| 1:15 | As **Employee**: check-in → request 2 days leave → auto balance 24→? | B3/B4, allocation consumption |
| 1:40 | As **HR Manager**: approve 2 of 2 days (partial 1 day) → balance updates, request linked | A4 ★ |
| 2:00 | As **Payroll Manager**: Configuration → Salary Rules → change HRA 40% → **35%**, dry-run tester shows the delta, save | ★ "config drives payslips, not mockups" |
| 2:40 | Payroll → NEW Payrun wizard: structure + Feb 2026 + employee-type filter → Step 2 eligibility shows 2 blocked rows (no contract / no schedule) | B5 ★ |
| 3:10 | Compute → table fills; warnings panel: missing bank, unapproved OT, duplicate-period | B6 ★, error detection |
| 3:30 | Validate → VALIDATED; fix bank details as HR; recompute → totals change; Mark Paid → locks | B6 |
| 3:50 | **Send Payslips** → progress bar (PDFs 12/45 → emails 5/45), open `bull-board`, open Ethereal inbox with the attachment | B8 ★ async architecture |
| 4:20 | As **Employee**: portal → payslip list → download the same PDF → YTD + explanation of lines; show DRAFT slip invisible | **your extra feature #2** |
| 4:40 | Payroll: create **1st Half Feb** payrun → preview ₹32,300.00 → mark paid → 2nd half auto-offsets with the advance line; show the `NEGATIVE_NET`→arrear guard | **your extra feature #1** |
| 5:00 | Dashboard: 5 KPI cards + 2 charts + alerts, flip department filter; 20-second roadmap close | B9/A7 ★ + deliverable #3 |

Rehearse it 3× with `npm run db:reset` between runs, and keep `scripts/smoke.sh` as the "everything is on
fire" fallback (show the JSON, not the UI, if the browser dies).

## Cut-list (decide this *now*, not at 3 a.m.)

| If you're short on time | Cut | Keep at all costs |
| --- | --- | --- |
| −4 h | Kanban view (list+form only), schedule grid → simple 7×3 form, holiday CRUD → seeded only, bull-board, ZIP download | engine, wizard, warnings, portal PDF |
| −8 h | also: overtime approval UI (seed it approved), allocations approval, employer-cost chart, `MONTH_ONCE` statutory subtlety → **but say it in the pitch** | period-correct contract, leave→LOP link, sequence-driven rules, idempotent send |
| Never | | money in paise, RBAC matrix as tested data, no `/uploads` static mount, no `eval`, no hardcoded dashboard numbers |

## Repo hygiene that quietly scores

- Conventional commits per phase (`feat(payroll): period-correct contract selection`), one PR/branch.
- `docs/` (this folder) committed — a "why" trail is rare in hackathon repos and reviewers notice.
- `README.md` with: the architecture ASCII diagram, the 6 locked decisions from `00-INDEX`, a table of
  deliberate deviations from the spec (with reasons), how to reset demo state, and the roadmap.
- Zero `console.log` in committed code (pino), zero TODO in the payroll path, `npm run lint` clean.
- Tests named as requirements: `it('uses the contract valid for the pay period, not the latest one')`.
