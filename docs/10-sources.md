# 10 — Research sources & verification status

Consulted 2026-09-05. Primary = official docs/vendor docs. Secondary = blog/forum (useful signal,
verify before relying on it). "Checked in code" = I asserted behaviour from knowledge and you should
prove it in your own environment with the given one-liner.

## A. Project IDX / Firebase Studio environment

| Claim | Source | Confidence |
| --- | --- | --- |
| Project IDX was rebranded **Firebase Studio** (April 2025); docs moved to `firebase.google.com/docs/studio` | secondary (ruh.ai guide) + official docs URLs reachable | High |
| **Firebase Studio sunsets 2027-03-22; new workspace creation and user signup disabled as of 2026-06-22**; migrate to Google AI Studio / Antigravity | **primary**: https://firebase.google.com/docs/studio/customize-workspace and `/devnix-reference` (site-wide banner) | **Verified — this is the single most important finding for you** |
| Environment configured by `.idx/dev.nix` (Nix); `apt` is **not** the documented install path | primary: `customize-workspace` ("This is different from how you might typically install system packages using OS-specific package managers such as APT") | Verified |
| Supported `services`: `docker`, `mongodb`, `mysql`, **`postgres`**, **`redis`**, `pubsub`, `spanner` | primary: `customize-workspace` §Add common services | Verified |
| `services.postgres.enable`, `enableTcp` (default **true**), `package` (default `pkgs.postgresql`), `extensions` | primary: https://firebase.google.com/docs/studio/devnix-reference | Verified |
| **Redis: TCP disabled by default; listens only on `/tmp/redis/redis.sock`** — `services.redis.port` must be set for TCP | primary: `devnix-reference` §services.redis.port (verbatim) | **Verified — the gotcha in `05` §4** |
| Postgres extension list includes `pg_cron`, `pgvector`, `postgis`, `plv8`, `pgtap`, `pgaudit`, `temporal_tables`, `rum`, `pg_uuidv7` — and **does not include `pg_trgm` or `btree_gist`** | primary: `devnix-reference` §services.postgres.extensions (enumerated type) | Verified → drives `06` #10 & #21 |
| `idx.previews.previews.<name>` = `{command, cwd, env, manager, activity}`; **`manager` ∈ web\|flutter\|android\|gradle** (no `process`); `$PORT` is substituted | primary: `devnix-reference` §idx.previews | Verified → workers must go in `idx.workspace.onStart` |
| `env` is exported to shells **and** preview servers; `onCreate` runs once, `onStart` runs every workspace open | primary: `devnix-reference` §env, §idx.workspace | Verified |
| Manual-`initdb` fallback + `FATAL: could not create lock file "/run/postgresql/.s.PGSQL.5432.lock"` fix | secondary: Firebase Studio community forum thread #174 | Medium — escape hatch only |
| Official Postgres template exists (`idx.google.com/new/postgres`) | secondary: same forum, staff reply | Low-medium (URL may now 404 given the sunset) |
| Workspace files downloadable via File → Open Folder → Zip and Download | primary: `customize-workspace` §Download your files | Verified (relevant for backing up before a rebuild) |

## B. Queue / worker architecture

| Claim | Source | Confidence |
| --- | --- | --- |
| BullMQ: `attempts` + `backoff {type:'exponential',delay}`, `removeOnComplete/RemoveOnFail {count,age}`, `limiter`, `concurrency`, `job.updateProgress`, `QueueEvents` (waiting/active/completed/failed/progress/delayed/stalled/drained) | https://oneuptime.com/blog/post/2026-01-06-nodejs-job-queue-bullmq-redis · /2026-01-21-bullmq-job-events-listeners | High |
| `maxRetriesPerRequest: null` and `enableReadyCheck:false` are required/recommended for BullMQ's ioredis connections | same + GitHub README | **Verified** (used in `04` §5.1) |
| Graceful shutdown = pause workers → `worker.close()` → close redis; kill without it leaves jobs stuck `active` (stalled) | https://oneuptime.com/blog/post/2026-01-21-bullmq-graceful-shutdown + r/node thread | High |
| Gotchas: Redis memory grows if completed jobs aren't trimmed; default concurrency 1; **BullMQ has no native DLQ** — wire it in `worker.on('failed')`; add jitter to backoff | secondary: r/node "Migrating from cron to Bull queues, lessons learned" | Medium — matches my knowledge; reflected in `04` §5.3 |
| Parent/child flows exist in OSS BullMQ (`FlowProducer`) | https://github.com/taskforcesh/bullmq feature table + npm readme | Verified (we deliberately don't use it — see `04` §5.2) |

## C. PDF generation

| Claim | Source | Confidence |
| --- | --- | Confidence |
| Headless-Chrome PDF: `puppeteer-core` + `executablePath`, args `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --font-render-hinting=none`, reuse one browser, `waitUntil:'networkidle0'` for fonts | https://oneuptime.com/blog/post/2026-02-08-how-to-set-up-docker-for-pdf-generation-with-headless-chrome | High |
| Chrome needs shared libs (`libnss3`, `libgbm1`, `libasound2`, `libcups2`…) and they cannot be vendored; Nix boxes have no `apt` to add them | stackoverflow #64361897, gist iicc1/8986b7a…, Vercel community #2533, Broadcom KB (cflinux3) | High (and it's why `pdfkit` is our default) |
| `PUPPETEER_SKIP_DOWNLOAD=true` + `PUPPETEER_EXECUTABLE_PATH=$(which chromium)` when the OS provides the browser | Dockerfile in the oneuptime article + stackoverflow nix answer | Verified |
| Puppeteer ≈ **100 MB** deps vs `@react-pdf/renderer` ≈ 2 MB; 2–5 s vs <500 ms per document; non-Latin/`₹` needs explicit font registration; `@react-pdf` has no CSS grid | https://dev.to/iurii_rogulia/pdf-generation-on-the-server-puppeteer-vs-react-pdfrenderer-a-production-comparison-44cg | High (numbers are order-of-magnitude) |
| `chrome-headless-shell` is leaner but riskier for **print CSS** (`@page`, `break-inside`, running headers, page counters, font fallbacks); full Chromium is the safer PDF path | https://pdf4.dev/blog/chrome-headless-shell-vs-puppeteer-chromium-pdf | Medium-high |

## D. Bulk email

| Claim | Source | Confidence |
| --- | --- | --- |
| Google **permanently disabled "Less Secure App" access on 2022-05-30**; use **OAuth2** (recommended) or **App Password with 2-Step Verification** | **primary**: https://nodemailer.com/guides/using-gmail | Verified |
| Limits: personal Gmail **500 recipients / rolling 24 h**, Workspace **2,000**; **each recipient counts** (To+Cc = 2); over-limit → `550 5.4.5 Daily user sending limit exceeded` | same | Verified → drives the quota guard in `04` §7 |
| Gmail rewrites `From:`; expect spam placement on bulk from personal accounts | nodemailer guide + plainenglish 2025 article | Medium |
| Practical bulk hygiene: connection pool, batching, delays between sends | serveravatar.com nodemailer guide | Low-medium (generic advice; we use `limiter` instead) |

## E. Money, formulas, DB types

| Claim | Source | Confidence |
| --- | --- | --- |
| **`pg` maps `numeric`/`decimal`/`money`/`bigint`/`float` to strings** in Node — deliberately, to avoid precision loss; wrapping in `parseFloat`/`Number` reintroduces it | https://medium.com/geekculture/money-operations-with-node-js-and-postgresql-91d1f06ff263 + https://github.com/brianc/node-pg-types/issues/28 | **Verified** → `04` §3 rule |
| `types.setTypeParser(1700, parseFloat)` is the common workaround (OID 1700 = numeric) | node-pg-types issue #28 | Verified as a *fact*; we reject it as a *practice* for payroll |
| Integer-minor-units (paise/cents) is the recommended storage+math strategy for money | same article | High |
| `expr-eval` ≤ 2.x has **CVE-2025-12735**: code injection via crafted context in `Parser.evaluate()` → **RCE**; fixed in **`expr-eval-fork@3.0.0`** (adds function allowlist + custom-function registration) | https://www.sentinelone.com/vulnerability-database/cve-2025-12735/ · https://www.scworld.com/brief/rce-possible-with-expr-eval-javascript-library-vulnerability (citing CERT/CC + BleepingComputer) | **Verified** → `04` §"formula" and `03` §5 scope design |
| `eval`/`new Function` on user input in JS = code injection; use restricted parsers (`math.js` allowlist, jexl) + timeouts | https://www.sourcery.ai/vulnerabilities/eval-injection-javascript | High |

## F. Payroll domain (Odoo behaviour we're cloning)

| Claim | Source | Confidence |
| --- | --- | --- |
| Structure types carry **Wage Type (Fixed/Hourly)** and **Default Scheduled Pay**: Monthly, Quarterly, Semi-annually, Annually, Weekly, Bi-weekly, **Bi-monthly**; contract "Schedule Pay" additionally offers **Semi-monthly** and Daily | **primary-ish mirror**: https://docs.advanceinsight.dev/applications/hr/payroll.html (Odoo 18) + odoo.com docs 17/16 | Verified → **Odoo itself treats half-month/semi-monthly as first-class**, so our feature is aligned with the reference product |
| Rule fields: `amount_select` Fixed / Percentage ("percentage based on" a base value) / Python; `quantity` expression (e.g. `worked_days.WORK100.number_of_days`); `condition_select` + python condition; `appears_on payslip`; "View on Employer Cost Dashboard"; child rules; inputs by code; range-based rules | https://www.braincuber.com/tutorial/salary-structure-rules-odoo-18 · https://nextghrm.com/en/odoo-is-our-core/docs-lib/28-human-resources-management/106-hr-payroll | High |
| Formula scope variables: `payslip, employee, contract, rules.<code>, categories.<CAT>, worked_days, inputs` ; `result = …`; **`categories.X` = sum of all rules in that category**; sequence drives both calculation and presentation (GROSS seq must be > allowances); float `==` comparisons bite | Odoo forum threads #6230, #71162, #122391 (odoo.com) | High — and directly justifies `03` §2's aggregation contract + the `abs(a-b)<0.0001` lesson |
| Sequence banding practice BASIC 1–10 → allowances → GROSS 100 → deductions 110–150 → NET 200; "wrong sequences cause calculation errors"; meaningful short codes; unique codes | braincuber best practices | Medium (convention, not doctrine) |
| Odoo 16+ computes payslips from **work entries** (generated from attendance/planning/time off) rather than raw attendance; unpaid leave = an *unpaid work entry type* linked to structure types → the leave↔payroll link | odoo.com docs 16/17/18 §Work entries; cybrosys Odoo 18 shift-payslip walkthrough | High — we replicate the *link* via `time_off_types.is_unpaid/payroll_code` instead of a work-entry subsystem (deliberate simplification, documented in `06` #12) |
| Batch = `hr.payslip.run`: select structure+period → "Create Payslips" (draft) → verify → journal entries → close; individual payslips `draft → confirm → paid`; paid slips are not edited (corrections = new/other payslip) | Odoo payroll docs + general product knowledge | High — matches the spec's Compute/Validate/Mark Paid |

## G. India payroll conventions

| Claim | Source | Confidence |
| --- | --- | --- |
| **No legally mandated day-divisor**; Code on Wages only requires timely/correct payment; methods in use: calendar-days, calendar-minus-Sundays, fixed 30, fixed 26, actual working days | https://salarybox.in/how-to-calculate-working-days-for-salary-in-india-2026-26-day-rule-lop-pro-rata-paid-holidays-guide · https://www.hinote.in/base-days-for-monthly-salary-calculation | High → hence `company_settings.payroll_day_basis` |
| LOP = (monthly amount ÷ divisor) × LOP days; PF on **actual earned basic**, ESI on actual gross, PT **not** prorated in most states | salarybox table + superworks pro-rata matrix | High |
| PF: 12% employee, statutory wage ceiling ₹15,000/mo (→ ₹1,800) unless employer opts to cover full basic | https://www.edps.in/blogs/payroll-calculations-in-india · fi.money guide | Medium-high — **verify current limits before quoting numbers on stage** |
| Pro-rata patterns catalogue (joiner, exit/F&F, notice recovery, leave encashment, gratuity `last_basic×15×years÷26`, statutory bonus 8.33–20%, TDS = annual tax ÷ 12 prorated over remaining months, HRA exemption u/s 10(13A)) | https://superworks.com/prorated-salary-calculator/ | Medium — used in `03` §7 as *shape*, with an explicit "verify slabs" note |
| Sandwich rule (weekly offs between LOPs becoming LOP) is a real Indian HR policy | same + hinote comments | Medium |

**Deliberately not asserted in these docs:** current income-tax slabs/rebate for FY 2026-27, exact
Gujarat PT instalment months, ESI disability-insurance rates. They change yearly, and a stale number in
a demo is worse than a config table labelled "illustrative — verify". `03` §7 tells you to encode them
as data instead.

## H. Arithmetic of the example months (I computed these, don't trust the docs — trust the test)

- **Feb 2026**: 28 days, 1 Feb = Sunday → Sundays 1/8/15/22, Saturdays 7/14/21/28 →
  **20** Mon–Fri days (matches `api.md`'s `expected_working_days: 20`) → halves = **10 + 10**.
- Mon–Sat for the same month = **24**; `6 × 4 = 24` ✓.
- **Feb 2024** (leap): Mon–Fri = **21**, Mon–Sat = **25**. Halves split **11 + 10** — unequal, which is
  precisely why a half-month engine must never assume "50% each". Required test case (verified with a
  date computation, not by eye).
- Hour rate check: 50,000 ÷ 20 ÷ 8 = 312.50 → ×1.5 ×4.5 h = **2,109.38**, so `api.md`'s 843.75 OT line
  cannot come from its own stated formula. (Verified by arithmetic.)
