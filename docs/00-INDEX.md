# PeoplePay360 — the four documents worth reading

The rest of the paperwork this project started from (technology research, the environment notes, the
review of `schema.md` / `api.md`, the phase plan, the open-questions list) has been deleted: it described a
build that was still ahead of us, and once the code exists the code is the truth. What survives is the
reading of the problem statement, the domain rules the payroll engine encodes, the screen map, and the
six decisions below, plus the built / not-built inventory.

| # | File | What it locks down |
| --- | --- | --- |
| 01 | `01-what-i-understood.md` | Plain-language reading of the problem statement, what is actually being judged, the 6 traps |
| 02 | `02-problem-statement-traceability.md` | Every requirement in the PDF → the API and table that answer it → the acceptance test |
| 03 | `03-payroll-domain-research.md` | How payroll really works: Odoo object/workflow mapping, salary-rule engine semantics, money math, proration, India statutory rules, payslip anatomy |
| 12 | `12-ui-spec-and-structure.md` | The mockup read screen-by-screen, folder-wise structure, how RBAC reaches the client, login flow, the 160-endpoint contract |
| 15 | `15-reading-the-code.md` | The five parts every screen is written in, where each shared piece lives, and the rules this repo keeps to |
| 17 | `17-round-9-plan.md` | Round 9, item by item: the schedule save that could not save, the empty payrun and the 160-person seeder, the approve buttons that a wrong status word hid, and an invitation link measured in minutes |
| 18 | `18-round-10-plan.md` | Round 10: mail from two boxes (an address and its App Password, with the server read off the domain), and which variable to change when the app runs in Docker |
| 19 | `19-round-11-plan.md` | Round 11: the invitation link run end to end against a real database, a seeder that leaves pay runs at zero, what a 14-character App Password looks like to Google, and the three bugs only a running system would tell on |
| 16 | `16-round-8-plan.md` | Round 8, item by item: mail transport in the product, stars that match the validators, payslip files, structures that explain themselves — each with what was verified in the code first |
| 13 | `13-how-a-payslip-is-computed.md` | How one rule becomes one number on a slip: the four steps, a worked month, half-month factor, per-day money, caps, statutory lines, the formula variables |
| 14 | `14-built-and-not-built.md` | The inventory: which screens are wired end to end, which API routes have no UI, what is deliberately not built and what stands in its place, and how each claim was checked |

Start with [`../README.md`](../README.md) instead if you want to run the thing: Docker one-liner, folder map,
demo logins, what the forms validate, and how to change a role. If the question is "why does this payslip say
this number", go straight to [`13-how-a-payslip-is-computed.md`](13-how-a-payslip-is-computed.md).

## Status

- [x] Problem statement read and decomposed
- [x] Payroll domain research done and encoded in `salary_rules` + the engine
- [x] Application code written: schema + seeder, 160 endpoints, worker queues, React screens
- [x] [`14-built-and-not-built.md`](14-built-and-not-built.md): the honest inventory of both halves of that line
- [x] Half-month payslips, employee self-serve PDF download, arrear/advance true-up
- [x] Access control in one file (`backend/src/lib/shared/permissions.js`) — nav, buttons and 403s read it

## Non-negotiable conclusions (the 6 decisions that shape everything)

1. **Payroll compute is period-driven, not month-driven.** The engine takes
   `(employee, period_start, period_end, structure)` and nothing else. Monthly, half-month,
   10th-to-9th, bonus-only and full-and-final runs all become the same function. This single
   choice makes the "extra feature" cost near zero instead of a fork in the payroll core.
2. **All money is integer paise in JS, `NUMERIC(14,2)` in Postgres.** Never float math, never
   `parseFloat` on `pg` output without deciding policy (`pg` returns NUMERIC as *strings*).
3. **Salary rule formulas are parsed, never `eval`'d.** Own tokenizer and a field allow-list — upstream
   `expr-eval` ≤2.x had an RCE (CVE-2025-12735), so no dependency of that family is installed.
4. **Redis = execution plane, Postgres `task_queue` = system of record.** The progress bar and "did
   employee X get their payslip?" are answered from Postgres, so a Redis flush never lies to a payroll user.
5. **Payslip PDFs are only reachable through a route that streams the file.** No `/uploads/` static
   serving. Employee download = ownership check + status check + audit row.
6. **PDF rendering must not depend on Chromium.** The pure-JS renderer is the default, so a missing
   `libnss3` can never kill a live demo.
