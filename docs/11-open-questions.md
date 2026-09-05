# 11 — Open questions (with the default I'll use if you don't answer)

Ordered by how much rework a wrong answer causes. Answer inline or just say "use your defaults".

## 🔴 Blocking (change the repo skeleton)

**Q1. Which environment will you actually build in today?**
Official Firebase Studio docs state new workspace creation and signup are **disabled as of
2026-06-22** (sunset 2027-03-22). Options:
**Answered: Docker.** `docker-compose.yml` at the repo root is the supported path (Postgres 16 + Redis 7 +
api + worker + web + a one-shot migrate/seed), and `npm run dev` still works bare on any machine that has
Postgres and Redis on the default ports. Nothing in the application code is Docker-specific: it is all
`DATABASE_URL` / `REDIS_HOST` / `PORT` env vars with local defaults (`backend/.env`).
`.idx/dev.nix` was dropped as requested, so a workspace rebuild can no longer delete the app.

**Q2. PDF renderer: pure-JS (pdfkit) or Chromium (puppeteer-core)?**
`pdfkit` = zero system deps, ~100 ms/page, you hand-code the layout — *and it cannot fail on the
judge's machine*. `puppeteer` = your HTML/CSS payslip prints pixel-identical to the web view, but needs
`pkgs.chromium` + `--no-sandbox` + fonts in a Nix sandbox (~100 MB, shared-lib risk per `10` §C).
*Default:* **pdfkit as primary**, `puppeteer-core` behind `PDF_RENDERER=puppeteer` with automatic
fallback. Do not build the HTML-template-first approach unless you tell me the IDE installs Chromium fine.

**Q3. How much of the schema review in `06` do you want applied?**
You already wrote `schema.md`; 24 findings are queued. Options: (a) apply all, (b) apply only the 8 🔴,
(c) keep your schema as-is and patch only where the features are impossible (`period_key`,
`month_anchor`, `line_kind`, `paid_at`, `is_unpaid`, FK fixes).
*Default:* **(a) all**, delivered as migrations `001…016` so your original doc stays as a readable
"design v1" and the diff is auditable. If you'd rather edit your file in place, say so.

**Q4. Is this a team or solo, and what's the real time budget (hours/days)?**
It decides whether `09` runs Phase 0→9 or the −4 h / −8 h cut-list, and whether I write tests as I go or
batch them into one phase.

## 🟠 Design calls I need from you (each has a one-line default)

| # | Question | My default |
| --- | --- | --- |
| 1 | Half-month policy: **pro-rata by actual days** or **flat 50% advance**? | `PRO_RATA` default, `ADVANCE_50` selectable per payrun |
| 2 | Where do once-per-month deductions (PT, loan EMI) land — H1, H2, or split? | **H2** (`MONTH_ONCE` → latest un-finalised slice), configurable in `company_settings` |
| 3 | Negative H2 net: block validation, or auto-carry as arrear to next month? | **Warn + block**, with a one-click "carry ₹X as arrear" action |
| 4 | When does an employee see a payslip in the portal? | **`status='PAID'`** or `released_at` set by HR |
| 5 | Should HR Manager get read-only payslip access (their matrix says no, the PDF's dashboard line says yes)? | **Follow your matrix (no)** + document the deviation |
| 6 | Deductions stored positive (sign from `category`) or negative as your `api.md` shows? | **Positive + `line_kind`-driven sign**, `amount_signed` generated column |
| 7 | Timezones: `timestamptz` everywhere (IST for display) or "naive IST" policy? | **`timestamptz`** + `TZ=Asia/Kolkata` + documented rule |
| 8 | ORM: raw `pg` + repositories, or Knex/Drizzle/Prisma? | **raw `pg`** (fastest in a sandbox, no generate step, zero Nix/native risk) — Prisma would also need a `prisma generate` + engine download step in a restricted network |
| 9 | JS or TypeScript? | **JS + JSDoc** for the API (your stack list said React/Node, no TS; fastest), TS only if you're comfortable — the engine would benefit from types |
| 10 | Frontend state: TanStack Query + Zustand (recommended) vs Redux Toolkit? | **TanStack Query + Zustand** |
| 11 | Queue: BullMQ (needs ioredis + 2 queues) or your hand-rolled `task_queue` polling loop? | **BullMQ + `task_queue` ledger** (both: Redis executes, Postgres is truth) |
| 12 | Email provider for the live demo: Ethereal (public preview inbox, no creds) / Mailtrap / real Gmail? | **Ethereal**, with `MAIL_DRIVER=file` fallback so it can't fail offline |
| 13 | Company/branding for the PDF (name, address, logo, F&I details)? | "PeoplePay360 Technologies Pvt Ltd, Ahmedabad, Gujarat" placeholder in `company_settings` |
| 14 | Multi-company / multi-currency support now? | **No** — roadmap only |
| 15 | Do you want an **audit-log UI + old/new diff** view (Admin) in scope? | **Yes**, it's ~2 h and it's explicitly in your flows doc |

## 🟡 Nice-to-have scope checkers (say "yes" to any you want scheduled)

1. `payslip_inputs` (one-off bonus/recovery typed on a payslip) — Odoo parity, ~2 h.
2 Bank payment sheet CSV + payrun ZIP of PDFs — ~3 h, strongest "real tool" signal.
3. Payslip verification hash + `GET /api/verify/:hash` public endpoint + QR on the PDF — ~3 h, memorable.
4. Employer-cost (PF+ESI employer share) chart — ~2 h once rules exist.
5. Rule dependency graph view in the config screen (shows `depends_on` edges) — ~2 h, very demo-worthy.
6. `pg_cron`- or worker-repeatable "leave balance accrual / expiry" job — ~2 h, nice architecture bullet.
7. Salary-declaration & TDS projection screen (even illustrative) — ~4 h, statutory credibility.
8. Mobile-ish responsive portal polish — 1 h if the rest is done.

## What I'll do next, in order, unless you redirect

1. Generate the repo skeleton in this workspace: workspaces + `dev.nix` + `docker-compose.yml` +
   `.env.example` + `db/migrations/001…016.sql` (schema v2 with all 🔴 fixes) + `migrate.js` + seed
   scaffolding + healthcheck + money/date/permission modules + tests for them. (≈ Phase 0 + 1)
2. Then Phase 2 (auth/RBAC/audit) with the RBAC matrix test as the acceptance gate.
3. Then the payroll engine (`backend/src/lib/payroll`) with the Feb-2026 worked example as a failing test first.
4. Then everything else per `09`.

Tell me only: **Q1 environment, Q2 renderer, Q3 schema scope, Q4 time budget** — the rest I'll take my
defaults and flag them in the README's "decisions" section so you can veto later without re-reading docs.
