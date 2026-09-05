# PeoplePay360 — Research & Context Pack

> Read this folder top-to-bottom before writing any app code. Every doc here exists so the
> implementation phase can be mechanical instead of exploratory.
> Built from: `uploads/PeoplePay360 HR & Payroll.pdf` (11 pages, the official problem statement),
> `uploads/schema.md`, `uploads/api.md`, `uploads/user-flows.md` + external research (see `10-sources.md`).

## Files

| # | File | What it locks down |
| --- | --- | --- |
| 01 | `01-what-i-understood.md` | Plain-language reading of the problem statement, what is actually being judged, the 6 traps |
| 02 | `02-problem-statement-traceability.md` | Every requirement in the PDF → API + table + phase + acceptance test |
| 03 | `03-payroll-domain-research.md` | How payroll really works: Odoo object/workflow mapping, salary-rule engine semantics, money math, proration, India statutory rules, payslip anatomy |
| 04 | `04-architecture-tech-research.md` | Process topology (API / worker / web), Redis+BullMQ design, PDF pipeline, bulk email, SSE progress, auth/JWT/bcrypt, money as integers, formula sandbox, testing |
| 05 | `05-environment.md` | environment research: the Redis unix-socket gotcha, Chromium/PDF on Nix, preview/port rules — kept for the record, **Docker (`docker-compose.yml`) is now the supported environment** |
| 06 | `06-schema-review-and-gaps.md` | 20 concrete defects/missing tables in your `schema.md`, with fixes and DDL |
| 07 | `07-api-review-and-gaps.md` | Missing endpoints, 4 security holes, inconsistent sample data in your `api.md` |
| 08 | `08-extra-features-design.md` | Half-month payslips + employee self-serve PDF download, fully designed (algorithm, edge cases, worked numbers, tests) |
| 09 | `09-build-plan-phases.md` | Phase 0→9 build order, seeds design, demo script, cut-list |
| 10 | `10-sources.md` | Where each external claim came from |
| 11 | `11-open-questions.md` | decisions that are still yours to make |
| 12 | `12-ui-spec-and-structure.md` | the mockup read screen-by-screen, folder-wise structure, how RBAC reaches the client, login flow, endpoint contract |

## Status

- [x] Problem statement read and decomposed
- [x] Domain + tech research done
- [x] Your 3 design docs reviewed → defects found
- [x] Extra features (half-month payslip, self-serve download) designed
- [x] Repo skeleton generated — `backend/` + `frontend/`, plain Node, no workspaces
- [x] Application code written: schema + seeder, 150 endpoints, worker queues, and the React screens
- [ ] Open items live in `11-open-questions.md` (several were answered by the Docker decision)

## Non-negotiable conclusions (the 6 decisions that shape everything)

1. **Payroll compute is period-driven, not month-driven.** The engine takes
   `(employee, period_start, period_end, structure)` and nothing else. Monthly, half-month,
   10th-to-9th, bonus-only and full-and-final runs all become the same function. This single
   choice makes your "extra feature" cost near zero instead of a fork in the payroll core.
2. **All money is integer paise in JS, `NUMERIC(14,2)` in Postgres.** Never float math, never
   `parseFloat` on `pg` output without deciding policy (`pg` returns NUMERIC as *strings*).
3. **Salary rule formulas are parsed, never `eval`'d.** Own tokenizer or
   `expr-eval-fork@3.0.0`+ (upstream `expr-eval` had an RCE, CVE-2025-12735).
4. **Redis = execution plane, Postgres `task_queue` = system of record.** Progress bar and
   "did employee X get their payslip?" are answered from Postgres, so a Redis flush never lies
   to a payroll user.
5. **Payslip PDFs are only reachable through an authorized route that streams the file.**
   No `/uploads/` static serving. Employee download = ownership check + status check + audit row.
6. **PDF rendering must not depend on Chromium.** Pure-JS renderer is the default;
   `puppeteer-core` is an opt-in upgrade if a browser binary exists. A missing `libnss3` must
   never kill a live demo.
