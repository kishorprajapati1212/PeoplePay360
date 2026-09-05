# PeoplePay360 — HR + Payroll (PERN)

React + Tailwind front end · Express API · PostgreSQL · JWT · bcrypt · Redis + a worker for bulk mail and PDF generation.
Everything below runs with defaults you never have to type: Postgres `postgres/postgres`, DB `peoplepay360`, Redis with no password, ports `4000 / 4100 / 5173`.

```
peoplepay360/
├── backend/           Express API + worker + migrations + seeder   ← the whole back half lives here
│   ├── db/            migrations/ (11 .sql, applied in order) and seed/ (demo data)
│   ├── src/
│   │   ├── index.js   starts the API (port 4000)
│   │   ├── app.js     the Express app: helmet → cors → routes → 404 → error handler
│   │   ├── config.js  one place for every environment variable, with defaults
│   │   ├── lib/shared/permissions.js   ★ the one file that defines roles, permissions and the menu
│   │   ├── db/        pool + transaction helpers
│   │   ├── middleware/  auth · requirePerm · scope · validate · rateLimit · errorHandler
│   │   ├── repositories/  raw SQL only (one file per table)
│   │   ├── services/      business rules (payroll engine, attendance, time-off, users…)
│   │   ├── controllers/   HTTP: parse → call service → status codes
│   │   ├── routes/        one file per resource, mounted in src/routes/index.js
│   │   ├── domain/        zod request validators, one per resource
│   │   ├── jobs/          queue definitions + BullMQ workers
│   │   ├── lib/pdf/       the payslip PDF (no headless Chrome needed)
│   │   ├── utils/         money, date, csv, logger, banner, clickable urls
│   │   └── worker/        standalone process (port 4100) draining the Redis queues
│   ├── scripts/       smoke test · unit tests · route list · import checker
│   ├── test/          the two engine test files (node:test)
│   ├── storage/       generated pdfs / mail previews / uploads (git-ignored)
│   └── .env           defaults already point at local Postgres + Redis
├── frontend/          Vite + React + Tailwind
│   └── src/
│       ├── config/    what the app talks to (API base, cookie, token lifetime)
│       ├── api/       one file per resource + http.js (the only fetch in the app)
│       ├── auth/      login state, tokens, <Authorized>, useCan
│       ├── rbac/      reads the menu/permissions the API returned — nothing hard-coded here
│       ├── hooks/     useApi · useCrud · usePagedQuery · useSession
│       ├── components/{ui,data,crud}   inputs, tables, filters, the generic CRUD page
│       ├── layout/    AppShell (sidebar + topbar), PageHeader
│       ├── pages/     one folder per screen area (employees, org, attendance, timeoff,
│       │              salary, payroll, settings, portal) — this is where you will spend your time
│       ├── utils/     money/date formatting, CSV, downloads
│       └── App.jsx    the route table, with the permission each page needs
├── docs/              00-INDEX.md is the map of all 12 design documents
├── scripts/           dev.js (runs all three processes) and check-syntax.sh
├── docker-compose.yml postgres + redis + api + worker + web + a one-shot migrate/seed
└── package.json       npm run setup / dev / check (they just call the folders above)
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
| HR Manager | `hr@oxp.com` | employees, org, attendance, time-off, and the payroll screens |
| HR user | `hr2@oxp.com` | the same screens, minus what the role is denied (see below) |
| Payroll Manager | `payroll-admin@oxp.com` | salary structures, rules, pay runs, payslips, exports |
| Payroll user | `payroll@oxp.com` | runs and payslips, but cannot approve a run, mark it paid, or void it |
| Employee | `aarav.mehta@oxp.com` (or any employee's work email) | only My pay: own profile, own attendance, own requests, own payslips |

Log out with the avatar menu (top right). The access token (`localStorage`, `pp360.auth.v1`) lasts `JWT_ACCESS_TTL` = 15 min in the dev `.env`; the refresh token is an httpOnly cookie that lives `JWT_REFRESH_DAYS` = 30 days, so reloading never logs you out — `api/http.js` silently calls `/api/auth/refresh` on a 401 and retries once.

`hr2@oxp.com` is the same HR screens as `hr@oxp.com` but with the restricted role (`HR_PAYROLL_USER` alone): leave approval caps at 3 days, salary-rule editing, pay-run approval, marking paid and void are refused by the API — and those buttons simply do not render.

---

## 5 · What works today

* **Login for every role** — bcrypt check, JWT + refresh cookie, `/api/auth/me` returns the role's permissions **and** its menu, so the sidebar and every button are derived from the API, never hard-coded in React.
* **CRUD on the real objects**, screen by screen: employees (plus contracts, attendance, time-off, payslips, terminate), departments / schedules / holidays (with a bulk "generate holidays" action), attendance entry + clock + overtime approval, time-off types / requests (approve–refuse) / allocations, salary structures and rules (with the validator), pay runs (create → compute → validate → generate PDFs → mark paid → send → void), payslip detail (lines, inputs, history, print/PDF/email), users (create, roles, activate, reset password), company settings (all ~30 payroll switches incl. PT slabs), and the access matrix.
* **Bulk work in the background** — payslip PDFs, payslip emails, employee imports and report exports are queued in Redis and drained by the worker; watch them under Settings → System.
* **Scope**: the API filters every list to the rows you are allowed to see (`own` for employees), so the front end does not need to guard data — only the buttons.

## 6 · Checks you can run

```bash
cd backend && node scripts/test-unit.js        # 38 engine/HR rules tests, no database needed
cd backend && node --test test/                # payslip + arrear math (uses the seeded DB)
cd backend && node scripts/smoke.js            # drives all 150 endpoints against the API
cd frontend && npm run build                   # real production build (also proves every import)
bash scripts/check-syntax.sh                   # syntax of all .js/.jsx in ~1 s, no build
```

`scripts/check-syntax.sh` needs `frontend/node_modules` (it borrows the esbuild that ships with vite) and says
so out loud when it is missing, rather than quietly checking only half the files.

At the repo root, `npm run check` does all four in one go (JSX/JS syntax → every backend module loads →
38 unit tests → the 150-route inventory), and `npm run build` runs the real production build of the front end.
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
* the seeder is idempotent: `node backend/db/seed/seed.js --if-empty` (add `--reset` to start over in dev)
* no SMTP is configured, so "Send payslip by email" writes a `.eml` file into `backend/storage/mail/` and the UI shows that instead of pretending to deliver
