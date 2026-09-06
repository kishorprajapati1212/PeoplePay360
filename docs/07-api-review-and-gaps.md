# 07 — Review of `uploads/api.md`: security holes, contradictions, and the missing 60% of routes

Verified against the file as written. Section **E** is the corrected, complete route list — build from
that, not from the old doc.

## A. 🔴 Security holes in the API as currently specified

| # | Hole | Evidence | Fix |
| --- | --- | --- | --- |
| A1 | **IDOR on attendance check-in.** `POST /attendance/checkin` takes `{"employee_id": "emp-uuid-1"}` from the request body, and every authenticated role may call it ("Check In/Out: ✓" for all roles in `user-flows.md`). Any employee can clock in/out (or fake absence) for anyone — including the CEO — and therefore alter **payroll inputs**. | api.md §5 | Employee-facing routes must derive `employee_id` from the token: `POST /me/attendance/check-in`, `POST /me/attendance/check-out` (no body id at all). HR-side entry uses `/attendance` with explicit id **and** `hr:attendance:write` permission. Ownership check in one middleware, not in each handler. |
| A2 | **Privilege escalation via self-registration.** `POST /auth/register` is public (per its own text: "Self-registration for employees") and accepts `"role": "HR_PAYROLL_MANAGER"`. One guard clause ("Non-admin trying to create admin/payroll roles → 403") is the only barrier, and it's described in prose, not schema. | api.md §1 | (a) Default the role: `role = req.user?.isAdmin ? body.role : 'EMPLOYEE'` (ignore, don't just reject). (b) Better: **remove self-registration**; employees are created by HR via `POST /employees`, which mints an `invitations` row with a one-time activation link. (c) If you keep it, new accounts are `is_active=false` until HR approves. Ship a test for this case — it's the single most likely judge probe. |
| A3 | **Payslip PDFs reachable without auth.** `payslips.pdf_url = "/uploads/payslips/payslip-uuid-1.pdf"` (api.md §9 and §11) means a static Express mount. Anyone with a leaked/guessed UUID path — or an `index.html` listing — reads other people's salaries; and browsers/referrers get the path. | api.md §9 | **No `/uploads` static mount.** Only `GET /api/payslips/:id/pdf` (auth + ownership + status checks) which streams with `Content-Disposition`. UUIDs are unguessable but "unguessable" is not an access control — say this out loud in the writeup, it's a scoring-friendly point. |
| A4 | **Bulk send is not idempotent.** `POST /payruns/:id/send` + flows' "This will email 50 employees. Continue?" — nothing prevents a double-click, a retry after a network error, or two managers pressing send → 100 mails with payslips attached. No `Idempotency-Key`, no "already sent" state in the contract. | api.md §8 | Require `Idempotency-Key` (Redis, 24 h) **and** server-side dedupe (`uq_task_dedupe` + `email_deliveries` unique per `(payslip_id, document_version)`); respond `409 ALREADY_SENT` unless `?resend=true&reason=…`; log the resend. Expose `already_queued: n` in the 202 body. |

Plus: no rate limit anywhere in the contract (login brute force), no account lockout, no password
policy stated, `403` error code is named `UNAUTHORIZED`, JWT expiry/TTL not documented, no
`/auth/logout` (so a stolen token lives for its full TTL), and no way to invalidate tokens on role
change (an ex-HR user keeps payroll rights until expiry) → all fixed in §E.

## B. 🔴 Contradictions with the problem statement (these cost marks)

| # | Problem | Why it matters | Fix |
| --- | --- | --- | --- |
| B1 | `POST /payruns/:id/compute` returns `400 ALREADY_COMPUTED`, so **you cannot recompute**. But the PDF's guidelines demand "Salary Rules actively drive Payslip generation" — the demo *is* "edit HRA 40%→35%, recompute, watch the payslip change". As specced, the app cannot do its headline requirement. | Fatal to demo scenario 1 | Split the semantics: `POST /payruns/:id/compute` (only from DRAFT) vs `POST /payruns/:id/recompute` (allowed from COMPUTED/VALIDATED, forbidden from PAID → `409 LOCKED`). Recompute must (i) void old lines, (ii) bump `document_version`, (iii) mark later-period payslips STALE for YTD. |
| B2 | `payrun_status` includes `VALIDATED`, and `POST /payruns/:id/validate` returns `{is_valid, warnings}` — **but no endpoint ever transitions to `VALIDATED`**. Status machine is incomplete. | Judges will click Validate then look at the badge | `POST /validate` persists the result: `is_valid=true → status=VALIDATED` (+ `validated_at/by`), `false → stays COMPUTED` with warnings attached. `mark-paid` requires `VALIDATED` **and** zero `ERROR`-severity warnings. |
| B3 | The Wizard is spec'd as 2 steps (B5) but the API only offers `POST /payruns` with `employee_ids` in one shot. There is **no endpoint that answers "who is eligible for this structure + period?"** — the exact filter Step 2 needs (active + has contract for period + has schedule + no existing payslip). | Step 2 is the wizard's substance | Add `GET /payruns/eligible-employees?salary_structure_id&period_start&period_end` returning per-employee eligibility + `blockers[]` (`NO_ACTIVE_CONTRACT`, `NO_SCHEDULE`, `ALREADY_HAS_PAYSLIP`, `TERMINATED_BEFORE_PERIOD`). Frontend renders disabled checkboxes with reasons — a great demo moment. |
| B4 | Roles/flows require **User Management** for Admin (create/edit users, enable/disable, reset password, assign roles), **data export (CSV/JSON)**, **run database seeds**, and **Holiday Calendar CRUD** (Payroll Manager) — `api.md` has **zero** `/users`, `/holidays`, `/export`, `/admin/seeds` endpoints. | Whole role's screens unimplementable | Added in §E (they're all small). |
| B5 | `GET /payruns` (list) doesn't exist. The Payrun list view with status badges is in B6 of the PDF and in your own flows doc. | Main payroll screen has no data source | `GET /payruns?page&limit&status&period&salary_structure_id&q` + `meta`. |
| B6 | Flows require "Approve overtime entries" and the permission matrix has "Approve Overtime ✓" — no such endpoint. Overtime only appears via `overtime_approved` in the DB. | OT feature can't be demoed | `PUT /attendance/:id/overtime` `{approved: bool, note}` → triggers recompute-eligibility + returns `status` change. Also `GET /attendance?missing_checkout=true&ot_pending=true`. |
| B7 | `GET /timeoff/requests` **list endpoint is absent** (only types + create + approve + reject), yet B4 of the PDF is literally "Requests are accessed via Time Off → Requests" with a list of Employee/Type/Dates/Duration/Status. | Core HR screen | `GET /timeoff/requests?status&employee_id&department_id&scope=team|all&from&to&page` + `GET /timeoff/requests/:id`. |
| B8 | Time off **allocations** have no endpoints, though the flows doc says "Create new allocations (Give Rahul 24 Annual Leave days for 2026)" and the PDF requires Allocations screens with approval + linked history. | Feature 4 incomplete | `GET/POST /timeoff/allocations`, `PUT /timeoff/allocations/:id/{approve,refine,delete}`, `GET /timeoff/balances?employee_id&year`. |
| B9 | Salary structures/rules: only `GET/POST`. Flows require edit, "drag to reorder sequences", delete, and (for Payroll **User**) read-only. No reorder or update endpoint → sequence changes (the mechanism the PDF calls out as the point of sequencing) can't be made. | Config module incomplete | `PUT/DELETE /salary-structures/:id`, `PUT/DELETE /salary-rules/:id`, `PUT /salary-structures/:id/rules/order` `{codes:[…]}`, `POST /salary-rules/validate` (dry-run + `depends_on`/cycle check). |
| B10 | Dashboard ignores the PDF's required **Employee Type filter** and its `attendance_overview` omits the required "missing check-outs, manual edits, attendance coverage" numbers; `attendance_health` is a **string** `"92%"` (unusable for charts, no definition). | A7/B9 partial miss | Add `?employee_type=`; return `attendance_health: {rate: 0.9375, present, expected, formula: "present_days/expected_days"}`. |

## C. 🟠 Contract-quality issues

1. **Envelope inconsistency** — `data` is an object in §1/§2-detail, an array in §2-list, and an
   object-wrapped-list in §11. Fix: always `data` (array or object) + always `meta` for lists. Add
   `meta.requestId` (echoes `X-Request-Id`) and `meta.permissions` on `/auth/me` so the frontend
   renders menus from the server's truth instead of duplicating the matrix in JS.
2. **Money as raw JSON floats** — `basic_salary: 50000.00`, `net_amount: 62143.75`. `JSON.parse`
   gives you IEEE-754; `0.1+0.2` style bugs then appear in the *UI*, not the engine. Fix: emit
   `net_amount` (number, always 2dp) **plus** `net_amount_paise` (int) and `net_amount_display`
   ("₹62,143.75"). Accept ints on input (`*_paise`) for writes. Document it once; the API version bump
   is cheap and it's a defensible engineering choice to explain to judges.
3. **No pagination on `/payslips`, `/attendance`, `/contracts`, `/timeoff/*`** while `/employees`
   defines `page/limit/search`. Uniform: `page, limit(≤100), q, sort, order` everywhere; `total_pages`
   in `meta`.
4. **No `sort`/`order`/`fields` params** — the flows doc shows sortable list views.
5. **`PUT` with "all fields optional"** — that's `PATCH`. Use `PATCH /:id` semantics (or keep PUT but
   say it's partial; inconsistency between verb and body is a code-review smell).
6. **No optimistic concurrency.** Two payroll users on one payrun → last write wins on real money.
   Add `version int` to `payruns`/`payslips` and require `If-Match`/`expected_version` on
   compute/validate/mark-paid/line-edits → `409 VERSION_CONFLICT`. (Also gives you a nice
   "we handled concurrency" line.)
7. **Error model gaps.** Missing codes actually needed: `FORBIDDEN` (rename from `UNAUTHORIZED`),
   `PAYRUN_LOCKED`, `PAYRUN_NOT_COMPUTED`, `ALREADY_SENT`, `DUPLICATE_PERIOD`, `RULE_DEPENDENCY_FORWARD`,
   `FORMULA_INVALID`, `EMAIL_QUOTA_EXCEEDED`, `PDF_RENDER_FAILED`, `INSUFFICIENT_BALANCE` should carry
   `{requested, available}`, `NO_SCHEDULE`. Add `error.retryable: bool` (drives the frontend "Retry"
   button) and `error.details[].field`.
8. **Async contract thinness.** `202` + `status_url` is good; add `Location: /api/tasks/{id}`,
   `Retry-After: 2`, and the `GET /payruns/:id/status` shape should include `eta_seconds`,
   `failed_items: [{employee, stage, error}]` (flows doc explicitly requires "Shows which emails
   failed and why"), plus `GET /payruns/:id/stream` (SSE).
9. **`GET /contracts/active/:employeeId`** — action-in-path. Prefer
   `GET /employees/:id/contract?as_of=2026-02-15`, which also lets you preview "which contract would
   a past period use" — the exact behaviour B-★ in `06` #5 fixes. Keep the old path as an alias if you
   want doc compatibility.
10. **Sample data in the doc is internally inconsistent** (a judge who adds up your printed payslip
    will notice):
    - Same employee, same period, two different results: `POST /payruns/:id/compute` says Rahul
      `gross 70,000 / deductions 6,200 / net 63,800`; `GET /payslips/:id` says
      `70,843.75 / 8,700 / 62,143.75`.
    - `OT_PAY` formula `(basic/(expected_days*8))*overtime*1.5` with 50,000/20/8 × 4.5 × 1.5 =
      **2,109.38**, but the payslip line shows **843.75** (= 187.5 × 4.5).
    - Payrun totals `210,000 / 25,200 / 184,800`: deductions are exactly 12% of gross, i.e. PT and LOP
      vanished from the batch aggregate.
    - `/employees` says `total: 45`, `/dashboard.salary_by_department` sums to 20 headcount, and
      `attendance_health "92%"` vs overview 45/(45+3)=93.8%.
    **Fix method, not numbers: generate all documented sample values from `npm run seed` output**
    (engine-generated), then paste the real response into `api.md`. Never hand-write payroll examples.

## D. 🟡 Small but free improvements (do these while editing routes)

- `GET /healthz` (db+redis ping), `GET /api/system/queue` (ledger ⇄ Redis diff), `GET /api/version`.
- `POST /payslips/:id/pdf` (generate now) vs `GET /payslips/:id/pdf` (download) — split so the portal
  can trigger generation for an uncached payslip (see `08` §4).
- `GET /payslips/:id/pdf?disposition=inline` for in-app preview, `attachment` for download.
- `POST /payruns/:id/export` (bank payment sheet CSV + a zip of all PDFs) — half a day, and it's the
  deliverable a real payroll person asks for first.
- `POST /payruns/:id/emails/retry-failed` and `POST /tasks/:id/retry` (Admin).
- `GET /audit-logs` needs `from/to` and `limit`; add `GET /audit-logs/ diff/:id` is unnecessary — return
  `old/new` (already do) and let the UI render the diff.
- Standardize date query names: your docs mix `date_from/date_to` (attendance), `period_start/period_end`
  (payslips), `from/to`. Pick `from`/`to` for filters, keep `period_start/period_end` as entity fields.
- Add `?as_of=` everywhere a period-dependent read happens (contract, schedule, balances) — that's
  retroactivity in one word.
- `PUT /attendance/:id` should accept `expected_hours_override` + reason (HR fixing a schedule mistake)
  and record `edited_by`.
- Every list needs an unambiguous empty-state contract (`data: []`, `meta.total: 0`) and every
  mutation should return the updated resource (you mostly do).

## E. The corrected route surface (implement this list)

Legend: 🔓 public · 👤 any authenticated · 🏢 HR+ · 💵 payroll+ · 💾 manager+ · ⚙ admin.

```
# Auth  (7)
POST   /api/auth/login                     🔓   rate-limited 5/15min, returns access+refresh+user+permissions
POST   /api/auth/refresh                   🔓   rotating refresh, family-revoke on reuse
POST   /api/auth/logout                    👤   revoke refresh + blacklist jti
POST   /api/auth/forgot-password             🔓   token → email (queued like payslips: reuses the mail worker!)
POST   /api/auth/reset-password              🔓   token + new password, revokes all sessions
GET    /api/auth/me                        👤   {user, employee?, permissions, menus[]}
PUT    /api/auth/password                  👤   old+new

# Master data
GET    /api/departments                    👤   CREATE/PUT/DELETE ⚙
GET    /api/schedules                        👤   POST/PATCH/DELETE 💾 ; GET /api/schedules/:id/hours?week=
GET    /api/holidays                         👤   POST/PATCH/DELETE 💾 ; POST /api/holidays/expand-recurring?year=
GET    /api/employees                        🏢   (self: own row only)
POST   /api/employees                        🏢   creates user+invitation (no role from client)
GET    /api/employees/:id                    🏢   + counts{contracts,attendance_this_month,time_off_pending,payslips}
PATCH  /api/employees/:id                    🏢
DELETE /api/employees/:id                    ⚙   hard delete ⚙ only; HR/Payroll get 409 with "use ?status=TERMINATED"
POST   /api/employees/terminate              🏢
POST   /api/employees/import:                💾   CSV (bulk demo/ops win); returns row-level errors
GET    /api/employees/:id/contract?as_of=      👤   period-correct contract (also used by engine preview)
GET    /api/employees?scope=team             👤   manager sees own team (closure on employees.manager_id)
# Contracts (🏢)
GET/POST /api/contracts  GET/PATCH /api/contracts/:id  POST /api/contracts/:id/terminate
POST   /api/contracts/preview-conflict       🏢   "what will this change affect" (overlap + #payslips)
# Attendance
POST   /api/me/attendance/check-in           👤   no body
POST   /api/me/attendance/check-out          👤
GET    /api/attendance                       🏢   filters: employee_id,department,from,to,status,exception=missing_checkout|short_day|manual
POST   /api/attendance                       🏢   HR-created row (is_manual=true, reason required)
PATCH  /api/attendance/:id                   🏢
PUT    /api/attendance/:id/overtime          🏢   {approved, note}
POST   /api/attendance/generate-preview      💾   from schedules for a date range (seed/demo helper)
# Time off
GET    /api/timeoff/types                    👤   POST/PATCH/DELETE 💾
GET    /api/timeoff/allocations              🏢   POST 💾 (approval), PATCH/DELETE 💾
GET    /api/timeoff/balances?employee_id     🏢
GET    /api/timeoff/requests                 👤   scope=all|team|own
POST   /api/timeoff/requests                 👤   (own); 🏢 may file on behalf
GET    /api/timeoff/requests/:id             👤
POST   /api/timeoff/requests/:id/approve     🏢|manager   {partial_days?}
POST   /api/timeoff/requests/:id/refuse      🏢   reason required
POST   /api/timeoff/requests/:id/cancel      👤   restores balance if approved
# Salary configuration
GET/POST /api/salary-structures  GET/PATCH/DELETE /api/salary-structures/:id     read 👤(payroll) / write 💾
GET/POST /api/salary-rules       PATCH/DELETE /api/salary-rules/:id             write 💾
PUT    /api/salary-structures/:id/rules/order 💾  {codes:[…]}
POST   /api/salary-rules/validate            💾   {formula, condition, structure_id, employee_id?}
                                                → {ok, depends_on[], error?, sample: {per_line_values}}
GET    /api/salary-structures/:id/impact     💾   employees + last-3-months payslip counts using it
# Payroll
GET    /api/payruns                            💵   filters status/period/structure, meta totals
POST   /api/payruns                            💵   + Idempotency-Key; validates period vs pay_frequency
GET    /api/payruns/:id                        💵
PATCH  /api/payruns/:id                        💵   DRAFT only (rename, employees add/remove)
DELETE /api/payruns/:id                        💾   DRAFT/COMPUTED; PAID → 409 LOCKED (else void)
GET    /api/payruns/eligible-employees         💵   wizard step 2 (see B3)
POST   /api/payruns/:id/compute                💵   DRAFT→COMPUTED
POST   /api/payruns/:id/recompute              💵   COMPUTED/VALIDATED→COMPUTED (bumps doc version)
POST   /api/payruns/:id/validate               💵   persists warnings, →VALIDATED when clean
POST   /api/payruns/:id/mark-paid              💵   requires VALIDATED + no ERROR warnings
POST   /api/payruns/:id/unpay                  💾   manager-only corrective path, writes audit + reason
POST   /api/payruns/:id/send                   💾   202 + Idempotency-Key (see A4)
GET    /api/payruns/:id/status                  👤   ledger-derived progress
GET    /api/payruns/:id/stream                  👤   SSE (text/event-stream)
POST   /api/payruns/:id/emails/retry-failed    💾
GET    /api/payruns/:id/export?format=csv|zip  💵   bank sheet / PDF bundle
GET    /api/payslips                           👤   role-scoped (EMPLOYEE → own)
GET    /api/payslips/:id                       👤   incl. calculation_trace when can('payroll:view')
GET    /api/payslips/:id/pdf                    👤   streams file; 202+queued when missing (see 08 §4)
POST   /api/payslips/:id/pdf                    💾   force regenerate (new document_version)
GET    /api/payslips/:id/html                    👤   print-ready HTML (browser "Save as PDF")
PATCH  /api/payslips/:id/lines/:lineId          💾   manual correction; recomputes totals via trigger
POST   /api/payslips/:id/inputs                  💾   one-off bonus/recovery (feeds rules via inputs.*)
# Employee self-service (all derive employee id from token, never from body)
GET    /api/me  PATCH /api/me                  👤
GET    /api/me/summary                          👤   portal home: days this month, balance, next pay, latest slip
GET    /api/me/payslips?year=                    👤   only status PAID/COMPUTED(=released) rows
GET    /api/me/payslips/:id                      👤
GET    /api/me/payslips/:id/pdf                  👤   audited download
POST   /api/me/payslips/zip                      👤   {year?} → async, reuses same queue; returns download url
GET    /api/me/attendance?month=YYYY-MM          👤   + POST check-in/out above
GET    /api/me/timeoff                            👤   balances + requests; POST request
GET    /api/me/contracts                            👤
GET    /api/me/ytd?year=                            👤   incl. tax summary (declarations vs deductions)
# Reports / dashboard
GET    /api/dashboard?from&to&department_id&employee_type   💾/⚙ (decide: see F)
GET    /api/reports/salary-cost?group_by=month|department    💵
GET    /api/reports/employer-cost                             💾
GET    /api/reports/attendance?month&department               🏢
# Admin / system
GET/POST /api/users  PATCH/DELETE /api/users/:id ⚙
PUT    /api/users/:id/role  POST /api/users/:id/deactivate  POST /api/users/:id/reset-password  ⚙
GET    /api/audit-logs?entity_type&entity_id&performed_by&from&to&limit ⚙
GET/PUT /api/company-settings                                    ⚙
GET    /api/system/queue  /healthz  /version                      👤/🔓
POST   /api/admin/seeds/{run,reset}                              ⚙   (Admin "run database seeds" in flows)
GET    /api/queues   (bull-board mount at /admin/queues)          ⚙
```

Route count: ~85. Many are 10-line CRUD; the *risky* ones are compute/recompute/send/download/
eligible-employees — build those first (see `09` phases).

## F. Three decisions to make before coding

1. **Should HR Manager see the dashboard?** Your matrix says `View Dashboard ✗` for HR Manager, yet the
   PDF's B9 says the dashboard serves "Payroll **and HR** users". Implement the matrix (✗) and add a
   separate `GET /api/reports/attendance` + HR-only `/api/dashboard?view=hr` if you want to show
   reconciliation. Note the contradiction in the README — showing awareness scores better than silently
   picking one.
2. **Should `HR_PAYROLL_USER` be able to see salary rules?** Matrix says read-only structures/rules ✓,
   so `/api/salary-rules` must be readable by payroll+ (not 💾 only) while writes stay 💾.
3. Decide **when a payslip becomes visible in the portal**: at `COMPUTED` (employees may see draft
   numbers — risky) vs at `PAID` (safe, and my recommendation) with a `released_at` column so HR can
   release a specific slip early (e.g. before the bank file runs). Add
   `payslips.released_at timestamptz` and gate `/api/me/payslips*` on
   `status='PAID' OR released_at IS NOT NULL`. That one column turns a judgement call into a feature.
