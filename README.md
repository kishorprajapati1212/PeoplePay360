# PeoplePay360 — HR + Payroll (PERN)

React + Tailwind front end · Express API · PostgreSQL · JWT · bcrypt · Redis + a worker for bulk mail and PDF generation.
Everything below runs with defaults you never have to type: Postgres `postgres/postgres`, DB `peoplepay360`, Redis with no password, ports `4000 / 4100 / 5173`.

```
peoplepay360/
├── backend/                     Express API + worker + migrations + seeder  ← the whole back half
│   ├── db/                      migrations/ (11 .sql, applied in order) and seed/ (demo data)
│   ├── src/
│   │   ├── index.js             starts the API (port 4000)        ├── app.js  helmet → cors → routes → 404 → error handler
│   │   ├── config.js            one place for every env var, with defaults
│   │   ├── lib/shared/permissions.js   ★ the one file that defines roles, permissions and the menu
│   │   ├── lib/payroll/         the salary engine (rules, periods, formula)   · lib/pdf/ the payslip
│   │   ├── lib/formula/ lib/mailer/    expression evaluator · Gmail/SMTP transport
│   │   ├── db/                  pool + transaction helpers        · queue/  Redis connection + BullMQ queues
│   │   ├── repositories/        raw SQL only, one file per table
│   │   ├── services/            business rules (payroll engine, attendance, time-off, users…)
│   │   ├── controllers/         HTTP only: read req.valid, call a service, pick a status code
│   │   ├── routes/              one file per resource, mounted in src/routes/index.js
│   │   ├── validators/          zod request schemas, one file per resource
│   │   ├── middleware/           auth · rbac · scope · validate · idempotency · rate-limit · error handler
│   │   ├── worker/              the standalone process (port 4100) that drains the queues
│   │   └── utils/               money, dates, csv, logger, banner, clickable urls
│   ├── scripts/                 smoke test · unit tests · route list · import checker
│   ├── test/                    the engine tests (node:test)
│   ├── storage/                 generated pdfs / mail previews / uploads (git-ignored)
│   └── .env                     defaults already point at local Postgres + Redis
├── frontend/                    Vite + React + Tailwind
│   └── src/
│       ├── config/app.js        what the app talks to (API base, token key, page size)
│       ├── api/                 client.js (the only fetch) + endpoints.js (every call, grouped like the backend)
│       ├── theme.js / theme.css light + dark toggle · the two palettes as colour variables
│       ├── auth/                login state, tokens, the refresh timer
│       ├── rbac/                reads the permissions + menus the API sent — no role table is copied here
│       ├── hooks/               useApi (fetch once, reload on demand) · useTable (search, filters, paging)
│       ├── components/          ui/ (inputs, table, chips, modal, toast) · data/ · crud/ (the generic list+form page)
│       ├── layout/              AppShell (sidebar + top bar), PageHeader, MobileNav
│       ├── pages/               one folder per area: employees, org, attendance, timeoff, salary,
│       │                        payroll, settings, portal  ← where you will spend your time
│       ├── utils/               money/date formatting, query helpers, downloads
│       └── App.jsx              the route table, one line per screen
├── docs/                        00-INDEX.md maps the five design documents
├── scripts/                     dev.js (runs api + worker + web) and check-syntax.sh
├── docker-compose.yml           postgres + redis + api + worker + web + a one-shot migrate/seed
└── package.json                 npm run setup / dev / check (they only call the folders above)
```

★ = if you want to change who can see or do what, that single file is the only place you edit.

---

## 1 · Run it with Docker (recommended)

```bash
docker compose up -d --build
```

That is the whole setup: Postgres and Redis start, the schema is migrated, demo data is seeded, and three apps come up. The database seeding is skipped automatically if data is already there.

```bash
docker compose logs -f api      # follow the API
docker compose down             # stop (data survives in named volumes)
docker compose down -v          # stop and wipe back to a clean database
```

### Which variable do I change when it runs in Docker?

One rule decides it: `backend/.env` is mounted into the api, worker and migrate containers, and the config loader
only fills in a key that the process does not already have — so **whatever `docker-compose.yml` lists under
`environment:` wins**, and everything else comes from `backend/.env`.

| you want to change | change it here | to apply |
|---|---|---|
| the mail account and App Password | **nowhere** — Settings → Company → E-mail delivery, as admin | the next send, no restart (the row is cached 15 s and a save invalidates it at once) |
| `EMAIL_NAME`, `EMAIL_PASSWORD`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `MAIL_FROM`, `MAIL_DAILY_LIMIT`, `INVITE_TTL_MINUTES`, `INVITE_VIA_QUEUE`, `SEED_EMPLOYEES`, `SEED_PAYRUN_MONTHS`, `DEMO_PASSWORD`, `PDF_RENDERER`, `PUBLIC_APP_URL` | `backend/.env` | `docker compose restart api worker` (no rebuild: the file is bind-mounted) |
| `DATABASE_URL`, `REDIS_HOST`, `PORT`, `HOST`, `NODE_ENV`, `JWT_SECRET`, `JWT_*`, `WEB_ORIGIN`, `CORS_ORIGINS`, `WORKER_PORT` | `docker-compose.yml` — those are the ones compose *sets*, so the same key in `.env` is ignored | `docker compose up -d` |
| a link in an e-mail that must be reachable from another machine | `PUBLIC_APP_URL=http://<host-or-ip>:5173` in `backend/.env` (compose does not set it) | `docker compose restart api worker` |
| Postgres/Redis credentials a container uses | `docker-compose.yml` (`POSTGRES_USER/PASSWORD/DB` + the `DATABASE_URL` above — they must agree) | `docker compose up -d`, and `down -v` if the database already got created with the old ones |

The file's own header says the same: no variable in `docker-compose.yml` needs touching to send real mail.


## 2 · Or run it bare (no Docker)

Needs Node 20+ and a local Postgres + Redis listening on the default ports (then `backend/.env` already matches; edit it only if your credentials differ).

```bash
npm run setup        # backend/ + frontend/ dependencies (that is all it does)
npm run db:migrate   # 15 SQL migrations — needs a Postgres on :5432, which backend/.env already assumes
npm run db:seed      # demo company: ~160 employees (SEED_EMPLOYEES), 5 staff logins + a login per employee,
                     # pay runs for the recent months (SEED_PAYRUN_MONTHS). Already seeded? It stops and says so.
                     # for a payroll-from-zero demo: npm run db:seed -- --no-payruns
npm run dev          # api :4000 + worker :4100 + web :5173 in one terminal, printing the URLs below
```

A database that already has data is left alone on purpose — recomputing months of payroll for nothing is slow. So
if your box still has the older thirteen-person demo company, grow it from `backend/` with `npm run db:seed -- --force`
(the thirteen are updated in place, the rest of the 160 are added, attendance, pay runs and leave queues are topped
up), or start clean with `npm run db:reset`.

**Payroll from zero.** A pay run already marked PAID is the one thing that makes a demo look like a report instead of
a product, so the seeder can leave payroll out entirely: `cd backend && node db/seed/seed.js --no-payruns` (same flag
as `--skip-payroll`; `SEED_PAYRUNS=false` is the environment form for Docker). Everything the first run needs stays
real — contracts, attendance, leave requests waiting for an approver, 34 salary rules — so Create → Compute produces
genuine payslips for the month, and `GET /api/payruns` answers zero until you make the first one. Crowd size is
`SEED_EMPLOYEES=100` to `400` (160 by default; 35 of them are hand-written with deliberate wrinkles, the rest
generated, and the two flags combine: `SEED_EMPLOYEES=200 node db/seed/seed.js --no-payruns`).

`backend/.env` is committed with working dev defaults (same credentials Postgres ships with), so there is
nothing to copy or edit; `backend/.env.example` is the same file for reference. If your Postgres/Redis are not
on `127.0.0.1:5432` / `:6379`, change `DATABASE_URL` + `REDIS_HOST` there and nothing else.

## 3 · The URLs

Open these in a browser (Ctrl+Click works in a terminal, and every process prints them at boot):

| what | URL |
|---|---|
| **the app** — start here | <http://localhost:5173> |
| API health check | <http://localhost:4000/api/health> |
| worker health check | <http://localhost:4100/health> |
| a generated payslip (button on the payslip screen) | <http://localhost:5173/payslips> → open one → **PDF** |

## 4 · Logins (the seeded demo accounts)

Every account uses the same password: **`Password@123`**

Every row is a login the seeder creates, the seeder prints, and the sign-in screen offers as a button — same
address in all three places, because a demo list that invents an address is worse than no demo list: an earlier
round had this table writing `payroll.admin@oxp.com` where the seeder wrote `payroll-admin@oxp.com`. The list is
generated from `USERS` in `backend/db/seed/data.js`, so the two cannot drift again, and no account exists that is
not on it.

**One role per account.** The five roles are the specification's five, and an account carries exactly one of them:
`POST /api/users/:id/role` sets it, and `POST /api/users/:id/roles` still works only as a one-item list. Two people
doing two jobs get two accounts, not a union of powers — that is what makes the audit log mean something. The
first rule in `user:write` is that **an administrator cannot change another administrator**: role, password and
active status are self-service at that level. That is enforced by the API, so it is demonstrated by creating a
second admin in *Settings → User Access* rather than by keeping a spare admin in every demo list.

| sign in as | email | roles seeded | what you can do |
|---|---|---|---|
| Admin | `admin@oxp.com` | `ADMIN` | everything: User Access, writing company settings, queues, audit log. Cannot change a peer admin's role, password or status |
| HR Manager | `hr@oxp.com` | `HR_MANAGER` | employees, contracts, org, attendance, time off (approve, assign balances), salary structures to read, company settings to read. No computation, no release. |
| Payroll Officer | `hr2@oxp.com` | `HR_PAYROLL_USER` | the Payroll menu (create / compute / validate a run, mark it paid) and the Time Off menu — including **Approve / Refuse** on leave, because a leave day changes the pay. Reads employees and attendance; does not edit them. No bulk payslip e-mail, no structure writes, no void or delete. |
| Payroll Manager | `payroll@oxp.com` | `HR_PAYROLL_MANAGER` | a run end to end: compute, validate, mark paid, generate PDFs, **bulk e-mail the payslips**, edit slip lines and arreares, structures and rules, void/delete a run, and approve leave (Time Off menu). Cannot edit employees, contracts, attendance rows or schedules, cannot create users and cannot write company settings. |
| Employee | `aarav.mehta@oxp.com` (any seeded work email) | `EMPLOYEE` | only My pay: own profile, own attendance, own leave requests, own payslips (download goes through `/api/portal/payslips/:id/pdf`). |

Signing in takes each role to the screen that role works from — `landingFor()` in `frontend/src/App.jsx`, from a
small table (`ADMIN` → `/dashboard`, `HR_MANAGER` → `/employees`, both payroll roles → `/payroll`, `EMPLOYEE` →
`/portal`), each entry checked against the role's own menu so nobody is landed on a page that would refuse them.
The first menu entry is only the fallback for a role nobody listed, and an account with no screens at all gets
`/no-access`, which says so.

**What the seeder fills in, apart from people:** leave balances for the financial year `2026-04-01 → 2027-03-31`
for *every* type that grants days — the grant list is derived from `LEAVE_TYPES` (`requires_allocation` and
`max_days_per_year`), so a type added on the Time-off types screen is allocated automatically instead of needing
a code change; working schedules for all seven days (Mon–Fri 09:30–18:30 with a 60-minute break, Sat and Sun off,
40 hours), attendance, requests that go through the real approval service, and one payrun with computed slips.

Log out with the avatar menu (top right) — it opens on click, so it works from the keyboard and from a phone. The access token (`localStorage`, key `pp360.token`) lasts `JWT_ACCESS_TTL` = 15 min in the dev `.env`; the refresh
token is an httpOnly cookie that lives `JWT_REFRESH_DAYS` = 30 days, so reloading never logs you out —
`api/client.js` calls `/api/auth/refresh` on a 401 and retries the request once.

The table is a summary of `ROLE_PERMISSIONS` + `DENIES` in `backend/src/lib/shared/permissions.js`, and the
screens are built from it: `/api/auth/me` returns the menu and the permission list, so a button a role may
not use is not rendered at all rather than sitting there to fail with a 403. `Settings` → *Access matrix*
prints the same grid from the server if you want the authoritative version.

---

## 5 · What works today

* **Login for every role** — bcrypt check, JWT + refresh cookie, `/api/auth/me` returns the role's permissions **and** its menu, so the sidebar and every button are derived from the API, never hard-coded in React.
* **CRUD on the real objects**, screen by screen: employees (plus contracts, attendance, time-off, payslips, terminate), departments / schedules / holidays (with a bulk "generate holidays" action), attendance entry + clock + overtime approval, time-off types / requests (approve–refuse) / allocations, salary structures (a row opens it, every rule is described in words, and *Show the amounts* runs the real engine on a wage you type in) and rules (with the validator and the same sentence), pay runs (create → compute → validate → generate PDFs, with a panel that counts how many slips have a file and fills the gaps whether or not the worker is up → mark paid → send → void), payslip detail (lines, inputs, history, print/PDF/email), users (create, roles, activate, reset password), company settings (all ~30 payroll switches incl. PT slabs), and the access matrix.
* **Two screens, two audiences**: `/attendance` and `/payslips` are shared — HR sees everyone and the correction
  dialog, an employee sees only their own rows (the same screen asks the API which permission it got, so nothing is
  hard-coded twice). An employee's **Download PDF** button mints a short link to `/api/portal/payslips/:id/pdf`
  (the audited self-service route), while payroll gets `/api/payslips/:id/pdf`.
* **Payslip files that do not depend on the queue** — the payrun page has a *Payslip PDFs* panel that counts how many
  slips have a file, creates the missing ones, and says which way they were made: handed to the worker, or rendered in
  the request when the worker is not answering (up to `PDF_INLINE_LIMIT`, 40 by default). The register has the same
  button, and a slip's own download has always rendered on demand — so there is no path where "generate" quietly
  produces nothing.
* **Mail that is configured, not hard-coded** — Settings → Company → E-mail delivery holds SMTP host, port, implicit
  TLS, account, App Password, from-address, a daily cap and one *Send real mail* switch. The API and the worker read the
  same row (15-second cache, invalidated on save), `.env` stays the fallback, and the password is never sent back to
  the browser. *Check connection* and *Send a test mail to my address* go through the live mailer, so an invitation, a
  password reset, a leave decision or a payslip cover letter all work the moment that line is green.
* **The demo company is a company** — the seeder grows to ~160 people (`SEED_EMPLOYEES`), each with a contract that
  covers the current period, attendance for the last months, a leave balance for this financial year and some
  requests waiting for an approver, and it drives the real payroll engine for the last full month (`SEED_PAYRUN_MONTHS`)
  while leaving this month as a DRAFT run so the first thing you press has work to do. Dates are counted back from
  today, never written into the file: a demo that goes stale in a month is the bug that made "Nobody is eligible"
  look like a broken payrun.
* **Every required field says so** — the star, the box highlight and the sentence that blocks a submit come from one
  list per form (`frontend/src/utils/form.js`), built by reading the API validator that will actually refuse you; a
  field that may stay empty is labelled *Optional* rather than starred, and no Save button is left disabled without a
  reason next to it.
* **Bulk work in the background** — payslip PDFs and payslip e-mails are queued in Redis and drained by the worker (Settings → System shows the queue and the delivery log). E-mail is bulk in two senses: *all of a run* (`POST /payruns/:id/send`) and *a selection across runs* (`POST /payslips/send` — by ids, payrun, period or employee list, skipping rows with no PDF or no work email instead of failing the batch). Imports are synchronous and accept `dry_run: true` so you can see the row errors before anything is written.
* **A payrun period you can trust** — a blank "Period ends" means the last day of the start month, resolved in one function (`resolvePeriodEnd`) that the candidate preview, the estimate and the created run all call, and the wizard prints the date it picked before you press Create.
* **Assign balances to many** — Time-off types has an *Assign balance* button per row, and Allocations has a panel that grants one type to a ticked set of people in a single transaction (`POST /time-off/allocations/bulk`), with a skip/add/replace rule for people who already have a grant.
* **Identity fields that check themselves** — bank account, IFSC, PAN, UAN, ESIC, Aadhaar, PIN code, phone, colour, code and money formats live in one `PATTERNS` table (`frontend/src/components/crud/schemaForm.jsx`) that supplies the placeholder, cleans the value as you type, and refuses a bad one on save — the same bounds the API enforces, so a red box and a 400 cannot disagree.
* **A state you pick, not type** — every screen that captures a state offers the Indian states as a list: the company
  registered office and its Professional Tax state (Settings → Company), and each employee's home state. The 28 states
  and 8 union territories come from `backend/src/lib/shared/india.js`, the eight PT states are marked where they apply,
  and PT slabs only load for a state that has them. `GET /api/meta` serves the picklists (states, PT states, leave
  categories) and `frontend/src/utils/picklists.js` caches them for the session; a value already stored that is not on
  the list stays visible and labelled, so opening a form never silently rewrites a record.
* **A dashboard per kind of user, from one registry** — `frontend/src/pages/dashboards/registry.js` holds the list:
  payroll gets the run view (`/payroll`), an HR manager gets headcount and attendance, and an employee gets their own
  month — hours, overtime, leave pending, balance per type, recent requests and the last payslip. Which one you see is
  decided by the permissions the API sent, not by a role string in React, and a key nobody registered renders a message
  naming the registered kinds instead of a blank screen. Adding a dashboard is one entry there plus a component file.
* **New accounts set their own password** — creating a user (or *Send link* on any row) issues a single-use invitation:
  192 random bits, stored only as a SHA-256 hash, valid for `INVITE_TTL_MINUTES` (10) minutes **or until it is
  used**, whichever comes first, and the account stays unusable until it is. A used link is dead even inside the
  window, and the minutes are editable in Settings → Company → E-mail delivery. **The message is sent by the request that made it** — one SMTP conversation per account, in order,
  no Redis in between — so "sent" means sent, and a bulk press of *Send links (N waiting)* takes as long as the mail
  server needs while reporting every account individually. `INVITE_VIA_QUEUE=true` is the alternative for a
  deployment that would rather have the worker dial SMTP with its retries; the answer and the UI then say "queued".
  `GET /api/invite/:token` says whose it is, `/set-password?token=` (outside the login guard) is the screen that takes
  it, `POST /api/auth/set-password` consumes it, and the same link is shown in the dialog with a Copy button — because
  with no SMTP credentials the only copy is the `.eml` under `backend/storage/mail`.
* **One role per account** — the specification's five, and exactly one of them: `POST /api/users/:id/role` (the older
  `/roles` still works as a one-item list and says so when handed two). Changing it ends that person's sessions. And an
  administrator cannot change a peer administrator — role, password and active status at that level are self-service;
  the Users page shows "deactivate: self only" on those rows rather than a button that can only fail.
* **Leave types have a category and a payoff answer** — Casual / Sick / Earned / Privilege / Compensatory / Maternity /
  Paternity / Unpaid / Loss of pay / Other (`time_off_types.category`, migration `012_leave_category.sql`, filterable
  with `?category=` and `?pay=`), plus Pay treatment: PAID or UNPAID, which is what writes `is_unpaid` and attaches the
  LOP component. The form no longer asks for a checkbox called "unpaid" next to a select that says the same thing.
* **A refusal that explains itself** — every "cannot delete" arrives as a sentence from the API naming the table that
  holds the row (`Key (id)=(7) is still referenced from table "employees"` becomes "still used by employee rows…
  Deactivate it instead"), the dialog stays open with that reason inside it, and *Deactivate instead* sits next to the
  explanation. Same for the blank list after a delete: a table with filters on says so and offers *Clear filters (n)*,
  and a deep link pointing at a record that has gone names the id and lets you drop it.
* **Switch things off instead of deleting them** — `CrudPage` lists (leave types, departments, structures) carry a per-row *Deactivate / Activate*; salary rules are retired by their end date with a *Retire* button; users and working schedules have their own switches. Anything history still points at is refused on delete by the API, and now has a non-destructive alternative in the UI.
* **You can change your own password** — the account menu offers *Change password* (`POST /auth/change-password`, ≥ 8 characters, checked in the dialog with the rules the API itself enforces, which then revokes the session — so the dialog signs you out and says so). An account still on the password an admin set gets a 10-minute session and an amber banner pointing at that dialog; both are the API's behaviour, not UI policy (`auth.service.js`).
* **A session that survives the work** — `api/client.js` sends credentials, and on a 401 it rotates the refresh cookie once (single-flight, so a burst of six requests cannot revoke each other's cookie) and replays the failed call.
* **Scope**: the API filters every list to the rows you are allowed to see (`own` for employees), so the front end does not need to guard data — only the buttons.

## 5b · Light and dark

The toggle sits in the sidebar footer (and in the top bar on small screens). `html.dark` is the default because that
is what the mockup shows; `html.light` is the same screens on **off-white paper** — `247 245 240` for the page,
`253 252 250` for a panel, `250 248 244` for an input. Pure white was the problem: a panel could not look raised,
a hover could not look like a hover, and grey text on a pale grey row was unreadable, so the light ramp is warm and
three-shade instead. Its hover, selected-row, input, border and scroll-bar values are separate for the same reason,
and every text/background pairing in both themes was measured: the weakest is **4.5:1** (AA for normal text) —
`--slate-600` on a hovered row. Nothing scrolls sideways either: `html { overflow-x: clip }`, `.panel { min-width: 0 }`
so a wide table shrinks inside its own box instead of widening the page, long `code` tokens wrap anywhere, and a
dropdown closes itself if it would hang off the edge of the window. Every button has a focus ring so the keyboard can
see where it is. Both themes are one block of colour variables in
[`frontend/src/theme.css`](frontend/src/theme.css), and `tailwind.config.js` points every colour utility at them — so
no page knows which theme is on, and a new screen is themed for free. Your choice is remembered (`pp360.theme`), and
`index.html` applies it before the first paint.

## 5c · What the forms insist on — and what they fill in for you

| Field / action | Rule | Where |
| --- | --- | --- |
| Mobile number | exactly 10 digits. Spaces, dashes and a leading `+91` are cleaned first, then the length is checked — on the screen *and* in the API, so a bad number never reaches the database | `backend/src/validators/common.js` (`mobile`) |
| Employee code | you never type one. `EMP0001`, `EMP0002`… come from a Postgres sequence, and the form says so instead of asking | `backend/src/repositories/employee.repo.js` (`nextEmployeeCode`) |
| Contract number | same idea: `CT0001` …, assigned when the contract row is created, shown read-only afterwards | `db/migrations/003_employees.sql` |
| Create a user | three answers: name, work email, one role. The employee link is optional, and no password is invented for anybody: the account gets a single-use set-password link (shown with a Copy button, queued to the worker for e-mail), and it cannot sign in until that link is used. Type a password in the box instead only if you prefer to hand one over out of band | `frontend/src/pages/settings/UsersPage.jsx` |
| A duplicate record | 409 with a sentence, not SQL: "This employee already has a contract covering those dates…". It stays on screen inside the dialog and the offending field is underlined | `backend/src/lib/shared/errors.js` → `frontend/src/api/client.js` |
| A dropdown with 200 entries | filter box + scrollable list that flips upward near the bottom of the screen, so nothing is cut off inside a dialog | `frontend/src/components/ui/controls.jsx` (`Select`) |
| Any number in a form | the box says what it is measured in (₹, %, hours, days, order), shows an example in the placeholder, and compares what you typed with the same minimum and maximum the API uses — while you type, before a save is refused. A blank number means "leave the stored value alone", never "make it zero" | `frontend/src/components/crud/schemaForm.jsx` (`rangeProblem`), the field lists in each page |
| Company settings | the ~30 payroll switches are one table in the page source — label, unit, min, max, step, example, and a sentence about what the value touches. `min`/`max` there are the same numbers as `companyBody` in the API, so the screen cannot accept what the server would reject | `frontend/src/pages/settings/CompanyPage.jsx` |
| Editing a row | every list has an **Edit** button in the row, next to Delete. On a `CrudPage` screen (departments, holidays, leave types, rules, structures, allocations) it opens the same form pre-filled; on the three hand-written ones it opens that screen's own dialog — a punch day (`/attendance`), a user's name and sign-in email (`/users`), the employee record (`/employees`, whose Edit is a link to `/employees/:id?edit=1`, so the form exists exactly once). Rows that other screens depend on say `locked` instead of offering a delete the API would refuse, and a resource with no update endpoint gets no Edit button at all | `frontend/src/components/crud/CrudPage.jsx`, `frontend/src/pages/employees/EmployeeDetailPage.jsx` |
| "I want to read the code, not guess it" | every screen has the same five parts, the shared pieces are listed by what you wanted to change, and the rules the repo keeps to are written down | `docs/15-reading-the-code.md` |
| "what did this round change, and what still needs my machine" | the last round, item by item: the complaint, what the code actually did, what it does now, and which half only a real database, worker or mail server can prove | `docs/16-round-8-plan.md` |
| "Why does this line say that?" | each payslip line prints the sentence the engine wrote while computing it, the slip has a numbered **How this slip was computed** panel, and each rule on the Rules screen gets one plain-English line built from its own fields | `docs/13-how-a-payslip-is-computed.md` |
| Anything else | only lengths and formats that a human can get wrong by accident (dates, money ≥ 0, one running contract per employee, no leave beyond the balance). No password-strength theatre, no regex for Indian pincode | `backend/src/validators/*.js` |

## 5d · Real mails (Gmail in two minutes), from the settings screen

1. Google account → Security → 2-Step Verification → **App passwords** → create one (16 characters). A normal login
   password is refused by Google with *"Username and Password not accepted"*; that sentence is what the app shows you
   back, because it is the usual mistake. Google issues an App Password as **16 characters in four groups of four**, so the app counts what you
   saved and says so when the length is wrong — the other usual mistake, and it looks identical from the outside,
   because Google answers `535 BadCredentials` either way. (`Settings → Company → E-mail delivery` prints
   `password_length` for exactly this reason; nothing on that screen ever prints the password itself.)
2. Sign in as an admin → **Settings → Company → E-mail delivery** and fill in **two boxes**: the address
   (`payroll@gmail.com`) and the App Password. Leave *SMTP host*, *port* and the TLS box **empty** — a Gmail address
   *is* `smtp.gmail.com:465 · implicit TLS`, and the app looks that up in
   `backend/src/lib/mailer/providers.js` (Google, Microsoft, Zoho, Yahoo, Apple, Fastmail, QQ Mail). The line under
   the boxes tells you what it picked before you save, and says so plainly when a domain is not on the list.
   If a host is already in that box from an earlier attempt, it is used only when it names a real server:
   `smtp.reply.example`-style values resolve to nothing, so the app ignores them, says so on the screen, and offers
   **Clear the host box and use smtp.gmail.com:465 · implicit TLS** as one button. That stale box — not the
   password — is why *Check connection* used to answer `getaddrinfo ENOTFOUND` however many addresses were tried.
3. Press **Send a test mail to my address**. It goes through the same mailer an invitation or a payslip uses, so a
   green line there means the real thing arrives. No restart, and no file to edit.

Those are also the only two lines `backend/.env` needs — `EMAIL_NAME` (or `EMAIL_USER`) and `EMAIL_PASSWORD`
(or `EMAIL_PASS`); the shorter names are accepted because they are what people type from memory. Everything else in
that file has a working default, and the port/TLS variables are documented as "only for a host you typed".

| where it can be set | wins |
|---|---|
| Settings → Company → E-mail delivery (stored on `company_settings`, migration `013_mail_transport.sql`) | this one, per key — the login lives in the database so a box with no shell access can still be configured |
| `backend/.env` (`EMAIL_NAME`, `EMAIL_PASSWORD` — two lines, and nothing else unless you are off the provider list) | the fallback, for a deployment that keeps its secret outside the database; leave the two boxes on the screen blank and this is what runs |

The password is write-only: `GET /api/company` returns `smtp_password_set: true` and never the value, and saving the
form with an empty password box keeps what is stored rather than erasing it. *Send real mail* off means preview: every
message becomes `backend/storage/mail/*.eml`, which is what happens on a demo box with no credentials at all, so the
flow (link, set-password page, first sign-in) is still testable offline. A preview file is written as a real
`multipart/alternative` message with the raw link on a line of its own in the text part, so opening it and
double-clicking the URL is the whole delivery — that is the path an invitation mail takes when nobody has typed a
password anywhere yet. `GET http://localhost:4100/health` prints
which driver the worker picked up — the worker reads the same database row, cached for 15 seconds.

One more box sits in that group: **Set-password link lives for** — minutes an invitation stays usable, 10 by
default, `INVITE_TTL_MINUTES` as the deployment fallback. It is short on purpose and it is single-use as well
(`invitations.accepted_at`): once the person has set a password, that link is dead even inside the window, and the
Users page counts the remaining minutes down under the link so you can see whether it is still open. Press
**Check connection** first: a refused login and an unanswered host are different faults with different fixes, and the
panel says which one you have (a `Username and Password not accepted` from Google means an App Password is required).

An address you typed into *mail_from* is also the reply-to and where bounces land. Gmail's personal accounts are
capped near 500 recipients a day, so keep *Daily mail cap* below that: the app then refuses to queue past it rather
than letting a provider block the domain mid-run.

The invitation mail uses the same driver, with three more knobs:

| variable | default | what it decides |
|---|---|---|
| `PUBLIC_APP_URL` | `WEB_ORIGIN` → `http://localhost:5173` | the origin of the link in the mail — set it to what the browser actually types, or every invitation is unreachable |
| `INVITE_TTL_MINUTES` | `10` | how long a set-password link stays valid — and the box in Settings → Company → E-mail delivery beats it, so this is only for a deployment that keeps the number out of the database |
| `INVITE_TTL_HOURS` | — | the older knob, still read when `INVITE_TTL_MINUTES` is unset (72 was far too long for a link that travels by e-mail) |
| `FEATURE_INVITE` | `true` | switched off, `POST /users/:id/invite` answers 409 and the Users page falls back to typing a temporary password |
| `INVITE_VIA_QUEUE` | `false` | `true` hands each invitation to the worker as one job per account instead of the request mailing it |
| `INVITE_BULK_LIMIT` | `50` | how many accounts one *Send links* press works through (the API caps it at 100) |

`POST /users/:id/invite` mails the link from the request and answers with the outcome — `mail_sent`, the driver that
carried it, and where the copy went (`backend/storage/mail/x.eml` on the preview driver). A `task_queue` row is still
written first, so the send — or the provider's refusal — is visible under Settings → System either way. Set
`INVITE_VIA_QUEUE=true` when a deployment prefers one job per account on the mail queue: the request returns
`mail_queued: true` plus the `task_id` and the worker sends it with its own retries; if Redis is unreachable it falls
back to sending the mail itself and says so (`queue_fallback_reason`), because a link nobody can open is worse than a
slow save. Either way the token is never stored in Postgres — only its hash is.

`POST /users/invites/send-pending` is the same rule for a list: it works through everyone still waiting for a first
password, one account after another, and returns `{ attempted, sent, failed, took_ms, results[] }` with a per-account
note. It stops at the first rate-limit answer from the provider rather than burning the rest of the day's quota.

A rejected send is stored on the payslip (`email_status = FAILED` + the provider's own message in the task row) so you can
see *why* in Settings → System. Note Google's own limit: ~500 recipients/day on a personal account, `550 5.4.5` above it.

## 5e · Queues: the worker, Redis and why PDFs stall

PDF generation, payslip mail, imports and exports are BullMQ jobs, so the API and the worker must dial the *same*
Redis. Both read the same three settings from [`backend/.env`](backend/.env): `REDIS_URL` (optional — a full
`redis://host:port/db` string wins if you set it), otherwise `REDIS_HOST` + `REDIS_PORT`, with `REDIS_PASSWORD`,
`REDIS_USERNAME`, `REDIS_DB` and `REDIS_TLS` as extras. `docker-compose.yml` sets `REDIS_HOST=redis` for `api` and
`worker`, which is why nothing needs changing in Docker.

If a queue stalls — PDFs never appear, mails stay queued, `Settings → System` shows jobs piling up, or the worker log
repeats `connect ECONNREFUSED 127.0.0.1:6379` — the worker was pointed at localhost while the API used the container.
`GET http://localhost:4100/health` prints the Redis host and port the worker resolved, so one curl tells you which
side is wrong; fix `.env`, then `docker compose restart api worker` (or `npm run dev` again).

## 6 · Checks you can run

```bash
cd backend && node scripts/test-unit.js        # 49 payroll-engine, period, leave, route-contract and RBAC tests, no database
node scripts/ui-probe/run.mjs                 # renders 12 screens in jsdom and asserts the text on them (needs `npm i --no-save jsdom`)
cd backend && node --test test/                # guards every perm: token against the catalogue, and the nav map
cd backend && node scripts/smoke.js            # drives all 151 endpoints against the API
cd frontend && npm run build                   # real production build (also proves every import)
bash scripts/check-syntax.sh                   # syntax of all .js/.jsx in ~1 s, no build
```

`scripts/check-syntax.sh` needs `frontend/node_modules` (it borrows the esbuild that ships with vite) and says
so out loud when it is missing, rather than quietly checking only half the files.

At the repo root, `npm run check` does all four in one go (JSX/JS syntax → every backend module loads →
58 unit tests → the 160-route inventory), `npm run build` runs the real production build of the front end,
`npm run test:ui` renders 12 of the screens in jsdom and asserts what they say, and `python3 scripts/check-contrast.py`
measures every colour pair in both themes against WCAG.
Other root shortcuts: `npm run setup`, `npm run dev`, `npm run smoke`, `npm run db:reset`, `npm run up` / `down` / `logs`.

## 7 · Change the rules, not the code

Roles, permissions and menu entries live in [`backend/src/lib/shared/permissions.js`](backend/src/lib/shared/permissions.js):

```js
export const ROLE_PERMISSIONS = {
  ADMIN: ['*'],
  HR_MANAGER: ['employee:read', 'employee:write', 'schedule:write', 'timeoff:approve', ...],
  HR_PAYROLL_USER: [...HR_CORE_PAYROLL, ...PAYROLL_CALC],   // payroll reads HR data, it does not administer it
  ...
};
```

Add `'report:read'` to a role, or a new entry to `ROLE_NAV`, and the API's `/api/auth/me` immediately starts returning it — the sidebar item and the button visibility follow, because both are read from that response. A role's menu is generated from the same list (`ROLE_NAV`, plus `NAV_OVERRIDES` for the groups a role inherits): a screen a role can open is a link it is given, and a write a role is given is a screen it can reach — `scripts/test-unit.js` checks both, because either half missing looks like "the button was never built". `DENIES` is a veto only for permissions no held role grants (e.g. an employee's `payroll:*`), so take a power off a role by removing it from that role's list, not by denying it.

## 7b · Single-port mode (no Vite)

Once you have run `npm run build`, the API also serves the built front end, so the whole product is one URL:
<http://localhost:4000>. Vite's dev server (`:5173`) proxies `/api` for hot reload; `SERVE_WEB=false` turns the
static serving off if you would rather the API be API-only.

## 8 · Data and files

* generated PDFs, mail previews and uploads → `backend/storage/` (`pp_storage` volume on Docker; git-ignored, delete it any time, it is recreated). The API serves a slip with `GET /api/payslips/:id/pdf` — there is no public URL for the folder itself.
* the seeder is safe to re-run: `node backend/db/seed/seed.js` tops up the company settings and the demo logins, stops before touching a full company, and takes `--force` (re-run the demo data over the top) or `--reset` (empty the app tables first)
* no SMTP is configured, so "Send payslip by email" writes a `.eml` file into `backend/storage/mail/` and the UI shows that instead of pretending to deliver
