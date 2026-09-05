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

## 2 · Or run it bare (no Docker)

Needs Node 20+ and a local Postgres + Redis listening on the default ports (then `backend/.env` already matches; edit it only if your credentials differ).

```bash
npm run setup        # backend/ + frontend/ dependencies (that is all it does)
npm run db:migrate   # 11 SQL migrations — needs a Postgres on :5432, which backend/.env already assumes
npm run db:seed      # demo company: 13 employees, 5 staff logins + a login per employee, pay runs (db:reset = start over)
npm run dev          # api :4000 + worker :4100 + web :5173 in one terminal, printing the URLs below
```

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
address in all three places, because "the payroll admin cannot get in" turned out to be this table writing
`payroll.admin@oxp.com` where the seeder writes `payroll-admin@oxp.com`.

| sign in as | email | roles seeded | what you can do |
|---|---|---|---|
| Admin | `admin@oxp.com` | `ADMIN` + `HR_MANAGER` | everything: User Access, writing company settings, queues, audit log |
| HR Manager | `hr@oxp.com` | `HR_MANAGER` | employees, contracts, org, attendance, time off (approve, assign balances), salary structures to read, company settings to read. No computation, no release. |
| Payroll Officer | `hr2@oxp.com` | `HR_PAYROLL_USER` | the HR screens, plus create / compute / validate a run and mark it paid. No bulk payslip e-mail, no structure writes, no void or delete. |
| Payroll Manager | `payroll@oxp.com` | `HR_PAYROLL_MANAGER` | a run end to end: compute, validate, mark paid, generate PDFs, **bulk e-mail the payslips**, edit slip lines and arreares, structures and rules, void/delete a run. Cannot create users and cannot write company settings. |
| Payroll Admin | `payroll-admin@oxp.com` | `HR_PAYROLL_MANAGER` + `HR_MANAGER` | the same, and can also fix the employee or contract behind a wrong payslip in the same session. |
| Employee | `aarav.mehta@oxp.com` (any seeded work email) | `EMPLOYEE` | only My pay: own profile, own attendance, own leave requests, own payslips (download goes through `/api/portal/payslips/:id/pdf`). |

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
* **CRUD on the real objects**, screen by screen: employees (plus contracts, attendance, time-off, payslips, terminate), departments / schedules / holidays (with a bulk "generate holidays" action), attendance entry + clock + overtime approval, time-off types / requests (approve–refuse) / allocations, salary structures and rules (with the validator), pay runs (create → compute → validate → generate PDFs → mark paid → send → void), payslip detail (lines, inputs, history, print/PDF/email), users (create, roles, activate, reset password), company settings (all ~30 payroll switches incl. PT slabs), and the access matrix.
* **Two screens, two audiences**: `/attendance` and `/payslips` are shared — HR sees everyone and the correction
  dialog, an employee sees only their own rows (the same screen asks the API which permission it got, so nothing is
  hard-coded twice). An employee's **Download PDF** button mints a short link to `/api/portal/payslips/:id/pdf`
  (the audited self-service route), while payroll gets `/api/payslips/:id/pdf`.
* **Bulk work in the background** — payslip PDFs and payslip e-mails are queued in Redis and drained by the worker (Settings → System shows the queue and the delivery log). E-mail is bulk in two senses: *all of a run* (`POST /payruns/:id/send`) and *a selection across runs* (`POST /payslips/send` — by ids, payrun, period or employee list, skipping rows with no PDF or no work email instead of failing the batch). Imports are synchronous and accept `dry_run: true` so you can see the row errors before anything is written.
* **A payrun period you can trust** — a blank "Period ends" means the last day of the start month, resolved in one function (`resolvePeriodEnd`) that the candidate preview, the estimate and the created run all call, and the wizard prints the date it picked before you press Create.
* **Assign balances to many** — Time-off types has an *Assign balance* button per row, and Allocations has a panel that grants one type to a ticked set of people in a single transaction (`POST /time-off/allocations/bulk`), with a skip/add/replace rule for people who already have a grant.
* **Identity fields that check themselves** — bank account, IFSC, PAN, UAN, ESIC, Aadhaar, PIN code, phone, colour, code and money formats live in one `PATTERNS` table (`frontend/src/components/crud/schemaForm.jsx`) that supplies the placeholder, cleans the value as you type, and refuses a bad one on save — the same bounds the API enforces, so a red box and a 400 cannot disagree.
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
| Create a user | three answers: name, work email, role. No password to invent (the API hands out the demo password from `.env`) and the employee link is optional | `frontend/src/pages/settings/UsersPage.jsx` |
| A duplicate record | 409 with a sentence, not SQL: "This employee already has a contract covering those dates…". It stays on screen inside the dialog and the offending field is underlined | `backend/src/lib/shared/errors.js` → `frontend/src/api/client.js` |
| A dropdown with 200 entries | filter box + scrollable list that flips upward near the bottom of the screen, so nothing is cut off inside a dialog | `frontend/src/components/ui/controls.jsx` (`Select`) |
| Any number in a form | the box says what it is measured in (₹, %, hours, days, order), shows an example in the placeholder, and compares what you typed with the same minimum and maximum the API uses — while you type, before a save is refused. A blank number means "leave the stored value alone", never "make it zero" | `frontend/src/components/crud/schemaForm.jsx` (`rangeProblem`), the field lists in each page |
| Company settings | the ~30 payroll switches are one table in the page source — label, unit, min, max, step, example, and a sentence about what the value touches. `min`/`max` there are the same numbers as `companyBody` in the API, so the screen cannot accept what the server would reject | `frontend/src/pages/settings/CompanyPage.jsx` |
| Editing a row | every list has an **Edit** button in the row, next to Delete. On a `CrudPage` screen (departments, holidays, leave types, rules, structures, allocations) it opens the same form pre-filled; on the three hand-written ones it opens that screen's own dialog — a punch day (`/attendance`), a user's name and sign-in email (`/users`), the employee record (`/employees`, whose Edit is a link to `/employees/:id?edit=1`, so the form exists exactly once). Rows that other screens depend on say `locked` instead of offering a delete the API would refuse, and a resource with no update endpoint gets no Edit button at all | `frontend/src/components/crud/CrudPage.jsx`, `frontend/src/pages/employees/EmployeeDetailPage.jsx` |
| "Why does this line say that?" | each payslip line prints the sentence the engine wrote while computing it, the slip has a numbered **How this slip was computed** panel, and each rule on the Rules screen gets one plain-English line built from its own fields | `docs/13-how-a-payslip-is-computed.md` |
| Anything else | only lengths and formats that a human can get wrong by accident (dates, money ≥ 0, one running contract per employee, no leave beyond the balance). No password-strength theatre, no regex for Indian pincode | `backend/src/validators/*.js` |

## 5d · Real payslip emails (Gmail in two minutes)

1. Google account → Security → 2-Step Verification → **App passwords** → create one (16 characters).
2. Put both values in [`backend/.env`](backend/.env): `EMAIL_NAME=you@gmail.com`, `EMAIL_PASSWORD=abcd efgh ijkl mnop`.
3. Restart (`docker compose restart api worker`, or Ctrl+C and `npm run dev`).

That is the whole config: the mailer sees credentials, picks the Gmail driver by itself and sends payslips with the PDF
attached. With those two lines empty it stays on `preview` and writes each mail to `backend/storage/mail/*.eml`
instead, so the demo works offline. `GET http://localhost:4100/health` prints which driver the worker is using, and a
rejected send is stored on the payslip (`email_status = FAILED` + the provider's own message in the task row) so you can
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
49 unit tests → the 153-route inventory), `npm run build` runs the real production build of the front end,
`npm run test:ui` renders 12 of the screens in jsdom and asserts what they say, and `python3 scripts/check-contrast.py`
measures every colour pair in both themes against WCAG.
Other root shortcuts: `npm run setup`, `npm run dev`, `npm run smoke`, `npm run db:reset`, `npm run up` / `down` / `logs`.

## 7 · Change the rules, not the code

Roles, permissions and menu entries live in [`backend/src/lib/shared/permissions.js`](backend/src/lib/shared/permissions.js):

```js
export const ROLE_PERMISSIONS = {
  ADMIN: ['*'],
  HR_MANAGER: ['employee:read', 'employee:write', 'attendance:write', 'payroll:run:approve', ...],
  ...
};
```

Add `'report:read'` to a role, or a new entry to `ROLE_NAV`, and the API's `/api/auth/me` immediately starts returning it — the sidebar item and the button visibility follow, because both are read from that response. `DENIES` holds the few things that are withheld even from a broad role (e.g. an HR Manager approving more than 3 days of leave).

## 7b · Single-port mode (no Vite)

Once you have run `npm run build`, the API also serves the built front end, so the whole product is one URL:
<http://localhost:4000>. Vite's dev server (`:5173`) proxies `/api` for hot reload; `SERVE_WEB=false` turns the
static serving off if you would rather the API be API-only.

## 8 · Data and files

* generated PDFs, mail previews and uploads → `backend/storage/` (`pp_storage` volume on Docker; git-ignored, delete it any time, it is recreated). The API serves a slip with `GET /api/payslips/:id/pdf` — there is no public URL for the folder itself.
* the seeder is safe to re-run: `node backend/db/seed/seed.js` tops up the company settings and the demo logins, stops before touching a full company, and takes `--force` (re-run the demo data over the top) or `--reset` (empty the app tables first)
* no SMTP is configured, so "Send payslip by email" writes a `.eml` file into `backend/storage/mail/` and the UI shows that instead of pretending to deliver
