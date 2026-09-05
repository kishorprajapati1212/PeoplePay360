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

| sign in as | email | what you can do |
|---|---|---|
| Admin | `admin@oxp.com` | everything, plus Settings (users, roles, company, queues, audit) |
| HR Manager | `hr@oxp.com` | employees, org, attendance, time-off, and salary structures (not the rules, not the money) |
| HR user | `hr2@oxp.com` | the same screens, minus what the role is denied (see below) |
| Payroll Manager | `payroll-admin@oxp.com` | salary structures, rules, pay runs, payslips, exports |
| Payroll user | `payroll@oxp.com` | runs and payslips, but cannot approve a run, mark it paid, or void it |
| Employee | `aarav.mehta@oxp.com` (or any employee's work email) | only My pay: own profile, own attendance, own requests, own payslips |

Log out with the avatar menu (top right) — it opens on click, so it works from the keyboard and from a phone. The access token (`localStorage`, key `pp360.token`) lasts `JWT_ACCESS_TTL` = 15 min in the dev `.env`; the refresh
token is an httpOnly cookie that lives `JWT_REFRESH_DAYS` = 30 days, so reloading never logs you out —
`api/client.js` calls `/api/auth/refresh` on a 401 and retries the request once.

`hr2@oxp.com` is the same HR screens as `hr@oxp.com` but with the restricted role (`HR_PAYROLL_USER` alone): leave approval caps at 3 days, salary-rule editing, pay-run approval, marking paid and void are refused by the API — and those buttons simply do not render.

---

## 5 · What works today

* **Login for every role** — bcrypt check, JWT + refresh cookie, `/api/auth/me` returns the role's permissions **and** its menu, so the sidebar and every button are derived from the API, never hard-coded in React.
* **CRUD on the real objects**, screen by screen: employees (plus contracts, attendance, time-off, payslips, terminate), departments / schedules / holidays (with a bulk "generate holidays" action), attendance entry + clock + overtime approval, time-off types / requests (approve–refuse) / allocations, salary structures and rules (with the validator), pay runs (create → compute → validate → generate PDFs → mark paid → send → void), payslip detail (lines, inputs, history, print/PDF/email), users (create, roles, activate, reset password), company settings (all ~30 payroll switches incl. PT slabs), and the access matrix.
* **Two screens, two audiences**: `/attendance` and `/payslips` are shared — HR sees everyone and the correction
  dialog, an employee sees only their own rows (the same screen asks the API which permission it got, so nothing is
  hard-coded twice). An employee's **Download PDF** button mints a short link to `/api/portal/payslips/:id/pdf`
  (the audited self-service route), while payroll gets `/api/payslips/:id/pdf`.
* **Bulk work in the background** — payslip PDFs, payslip emails, employee imports and report exports are queued in Redis and drained by the worker; watch them under Settings → System.
* **Scope**: the API filters every list to the rows you are allowed to see (`own` for employees), so the front end does not need to guard data — only the buttons.

## 5b · Light and dark

The toggle sits in the sidebar footer (and in the top bar on small screens). `html.dark` is the default because that
is what the mockup shows; `html.light` is the same screens on paper — with its own hover, selected-row,
input and border values, because a pale grey hover that is perfect on navy is invisible on white, and every
button has a focus ring so the keyboard can see where it is. Both themes are one block of colour variables in
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
cd backend && node scripts/test-unit.js        # 43 payroll-engine, leave and RBAC tests, no database needed
cd backend && node --test test/                # guards every perm: token against the catalogue, and the nav map
cd backend && node scripts/smoke.js            # drives all 151 endpoints against the API
cd frontend && npm run build                   # real production build (also proves every import)
bash scripts/check-syntax.sh                   # syntax of all .js/.jsx in ~1 s, no build
```

`scripts/check-syntax.sh` needs `frontend/node_modules` (it borrows the esbuild that ships with vite) and says
so out loud when it is missing, rather than quietly checking only half the files.

At the repo root, `npm run check` does all four in one go (JSX/JS syntax → every backend module loads →
44 unit tests → the 151-route inventory), and `npm run build` runs the real production build of the front end.
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
