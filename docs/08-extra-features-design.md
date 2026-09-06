# 08 — Design of the two extra features (half-month payslips · self-serve download)

These are yours, not the spec's — so they must be **correct and demoable**, not decorative. Both are
designed so they fall out of the same engine the core requires.

---

# Part 1 — HR generates half-month / custom-period payslips

## 1.1 Why this is cheap if (and only if) the engine is period-driven

Do **not** build a "half-month mode". Build the rule once:

> `computePayslip(employee, structure, period_start, period_end)` — everything (expected days,
> paid days, LOP, overtime, proration, statutory caps, YTD) is derived from **that date range**.

Then:
- Monthly run = `2026-02-01 → 2026-02-28`
- First half = `2026-02-01 → 2026-02-15`
- Second half = `2026-02-16 → 2026-02-28`
- Company's odd cycle = `2026-01-10 → 2026-02-09`
- Bonus-only = same period, structure with one rule
- Full & final = `2026-03-01 → date_of_exit`

One function, six products. This is the sentence to say to the judges.

## 1.2 Data model (already specified in `06` #10; recap)

```sql
ALTER TABLE payruns  ADD COLUMN pay_frequency pay_frequency NOT NULL DEFAULT 'MONTHLY';
   -- extend enum: MONTHLY | BI_MONTHLY | WEEKLY  (+ HALF_MONTH_FIRST, HALF_MONTH_SECOND as *kinds*, not frequencies)
ALTER TABLE payslips ADD COLUMN period_key   text NOT NULL,        -- '2026-02' | '2026-02-H1' | '2026-02-H2' | '2026-02-C10-09'
  ADD COLUMN payslip_kind text NOT NULL DEFAULT 'MONTHLY',         -- MONTHLY|HALF_FIRST|HALF_SECOND|CUSTOM|ADVANCE|ARREAR|BONUS|FULL_FINAL
  ADD COLUMN month_anchor date,                                     -- first day of the *calendar month* the slice belongs to
  ADD COLUMN reconciled_from uuid REFERENCES payslips(id),          -- the H1 slip this H2 offsets
  ADD UNIQUE (payrun_id, employee_id);
```

`month_anchor` is the key column for statutory reconciliation (PT, ESI wage test, PF ceiling, "have I
already paid H1 for this month?"). Without it, every per-month rule has to re-derive the month from a
half-month range and someone will get it wrong.

`payslip_lines.line_kind`:

```sql
CREATE TYPE line_kind AS ENUM ('EARNING','DEDUCTION','ADJUSTMENT','REPORT');
ALTER TABLE payslip_lines ADD COLUMN line_kind line_kind NOT NULL DEFAULT 'EARNING',
  ADD COLUMN amount_signed numeric(14,2) GENERATED ALWAYS AS (
      CASE WHEN line_kind = 'DEDUCTION'   THEN -amount
           WHEN line_kind = 'ADJUSTMENT'  THEN amount          -- carries its own sign
           ELSE amount END) STORED,
  ADD COLUMN is_adjustment boolean NOT NULL DEFAULT false;
```

Totals function (supersedes the `06` §9 snippet by handling ADJUSTMENT and REPORT):

```sql
UPDATE payslips p SET
  gross_amount     = (SELECT COALESCE(SUM(amount),0) FROM payslip_lines
                      WHERE payslip_id=p.id AND line_kind='EARNING'),
  total_deductions = (SELECT COALESCE(SUM(amount),0) FROM payslip_lines
                      WHERE payslip_id=p.id AND line_kind='DEDUCTION'),
  net_amount       = (SELECT COALESCE(SUM(CASE line_kind WHEN 'DEDUCTION' THEN -amount ELSE amount END),0)
                      FROM payslip_lines WHERE payslip_id=p.id AND line_kind <> 'REPORT')
WHERE p.id = p_payslip;
```
`REPORT` = GROSS/NET echo lines → printed, never summed (see `03` §2).

## 1.3 Two compute modes — expose the choice in the wizard (it is a real policy choice)

| Mode | What H1 pays | When used |
| --- | --- | --- |
| **A. Advance (50%)** | `month_amount × 0.5`, attendance ignored, no deductions except the ones policy says to take (often none, or PF+PT in H2) | fastest; how many Indian SMEs do "1st-half advance" |
| **B. Pro-rata actual** *(default)* | `per_day_rate × paid_days(H1)`, allowances prorated, OT/leave/LOP of that slice included | accurate; the one to demo (shows the engine working) |
| C. Fixed half amount | a rule set of its own (`HALF_SALARY` structure with one FIXED rule) | for shops/contract staff |

`payruns.compute_mode IN ('ADVANCE_50','PRO_RATA','FIXED')`. Mode B is what makes the feature *prove*
the payroll engine; mode A is a 10-line branch that makes it *practical*. Build both, default B.

## 1.4 The algorithm (month-equivalent minus already-paid)

```
computeHalf(employee, H):                                   # H = HALF_FIRST | HALF_SECOND
  month      = first_day_of(H.period_start)                 # month_anchor
  expMonth   = expectedDays(month_start, month_end)         # schedule − holidays − joining/exiting
  expSlice   = expectedDays(H.period_start, H.period_end)
  paidSlice  = paidDays(H.period_start, H.period_end)       # present + paid-leave (+ holidays)
  lopSlice   = expSlice − paidSlice                          # clamp ≥ 0

  # 1. Month-equivalent values (what the whole month WOULD pay, using data as of now)
  monthLines = engine(employee, structure, month_start, month_end, {pro_rata_off: true})
  monthGross = Σ earnings(monthLines);  monthDed = Σ deductions(monthLines)
  monthNet   = monthGross − monthDed

  # 2. Slice-level computation (the honest, attendance-driven one)
  factor     = expSlice / expMonth                            # 10/20 = 0.5 for Feb 2026
  sliceLines = engine(employee, structure, H.period_start, H.period_end, {pro_rata: factor})

  # 3. Reconciliation
  if H == HALF_FIRST:
      alreadyPaid = 0
  else:
      h1 = payslip for (employee, month, HALF_FIRST, status in (COMPUTED, PAID))
      alreadyPaid = h1.net_amount
      if h1 and h1.status == 'DRAFT': error 'HALF_FIRST_NOT_FINALISED'     # don't offset against a draft
  netPayable = sliceNet − alreadyPaid                       # sliceNet = Σ(sliceLines)
  if netPayable < 0 and H == HALF_SECOND:
      if policy.carry_arrears: netPayable = 0; create ARREAR line for next month (reason + amount)
      else: block payrun validation with NEGATIVE_NET (ERROR)

  # 4. Emit an ADJUSTMENT line so the payslip explains itself
  if alreadyPaid > 0:
      lines.push({ name:'Less: Salary paid for 1–15 Feb 2026', line_kind:'ADJUSTMENT',
                   amount: -alreadyPaid, is_adjustment:true, ref_payslip_id: h1.id })
```

Notes that matter:

- Step 1 (month-equivalent) is used **only** for the caps/tests in §1.5, not for the payable amount —
  otherwise half-month payslips would ignore attendance, defeating the point.
- Offsetting against `alreadyPaid` (actual paid) rather than "recompute H2 as month − H1-formula" means
  later corrections to H1 data can never strand money. If H1 was wrong, issue an **arrear**, never edit
  a PAID slip (Odoo does the same via additional sheets/arrears).
- If no H1 exists at all (company skipped it) → `HALF_SECOND` computes normally and `alreadyPaid=0`;
  the *validation* step warns `H1_MISSING` so HR decides.

## 1.5 Statutory rules that must be evaluated **per calendar month**, not per payslip

This is where half-month implementations go wrong. Every per-month test must use `month_anchor` and
the union of all payslips for that month:

| Item | Wrong (per-slice) | Right (per-month) |
| --- | --- | --- |
| **Professional Tax** (e.g. Gujarat ₹200/mo, ₹2,500/yr) | ₹200 in H1 *and* ₹200 in H2 → ₹400 | Compute `min(monthly_PT, annual_cap_used)` across the month; apply in H1 or H2 by policy, cap the pair. Implement `pt_remaining = annual_cap − pt_taken_this_fy`, then `LEAST(per_month, pt_remaining)`. |
| **ESI wage limit** (₹21,000/month gross test) | H1 gross 18,000 → enrolled; H2 gross 18,000 → enrolled; and a month-equivalent 36,000 employee gets wrongly enrolled → **wrong** | Test on **month-equivalent gross** (§1.4 step 1), then charge the 3.25% on the slice's actual wages. |
| **PF ₹15,000 wage ceiling** | cap basic at 15,000 *per slice* → 12% × 15,000 × 2 = double the legal monthly amount | Cap on month-equivalent basic, compute monthly PF once, then split by `factor`. |
| **TDS (s.192)** | project annual income from a half month → 2× over-withholding | Annualise from **month-equivalent** income; deduct across the month (H1 40% / H2 60% of month's TDS is a common split, or all in H2). |
| **Leave encashment / accrual** | accrue twice | accrue per month, once. |
| **Loan EMI / attachments** | two EMIs deducted | one per month → charge in H1 (or H2) and mark the other `SKIP`. |
| **OT multiplier thresholds** (e.g. first 2 h at 1.5×) | per-slice thresholds re-applied | keep per-period but record the slice range in the trace line so it's explainable. |

Encode this as a rule-level flag, not scattered `if`s:

```sql
ALTER TABLE salary_rules ADD COLUMN evaluation_period text NOT NULL DEFAULT 'PERIOD';
   -- 'PERIOD'      → charge on this payslip's period as-is (OT, meal voucher, LOP)
   -- 'MONTH'       → amount computed for month_anchor then × pro_rata factor (HRA, basic %)
   -- 'MONTH_ONCE'  → computed once per month and applied to the *earliest un-finalised slice*
   --                 (PT, ESI employer side, loan EMI)
   -- 'FISCAL_YEAR' → cumulative-cap rules (PT annual cap, 80C projections)
```

`MONTH_ONCE` needs one query: "has any other payslip in this month_anchor already charged this rule
code?" → `SELECT COALESCE(SUM(l.amount),0) FROM payslip_lines l JOIN payslips p ON p.id=l.payslip_id
WHERE p.employee_id=$1 AND p.month_anchor=$2 AND l.rule_code=$3 AND p.status <> 'VOID'`.
That single query + flag is the honest version of "we handled statutory half-months".

## 1.6 Worked numbers — the exact example to put in the README and to assert in tests

Feb 2026: 1 Feb = **Sunday** → Sundays 1, 8, 15, 22; Saturdays 7, 14, 21, 28 →
**20 expected working days**, split **10 + 10** at the half boundary. Employee: basic ₹50,000,
HRA 40 %, meal ₹30/paid day, OT 1.5× per-hour, PF 12 %, PT ₹200 (charged H2 only), 1 absent day and
1 paid leave in H2, 4.5 h approved OT in H2.

```
── HALF 1 · 01–15 Feb 2026 (period_key 2026-02-H1, kind HALF_FIRST, mode PRO_RATA) ──────────
Expected days 10 · Present 10 · LOP 0 · OT 0 h          factor = 10/20 = 0.50
  Basic        50,000 × 0.50                    =  25,000.00
  HRA          40% of earned basic               =  10,000.00
  Meal voucher 30 × 10 paid days                  =     300.00
  GROSS                                           =  35,300.00
  PF           12% × 25,000 (month ceiling not binding) = 3,000.00
  PT           MONTH_ONCE → already charged? no → charged in H2 by policy = 0.00
  DEDUCTIONS                                      =   3,000.00
  NET PAYABLE                                     =  32,300.00

── HALF 2 · 16–28 Feb 2026 (period_key 2026-02-H2, kind HALF_SECOND) ─────────────────────────
Expected days 10 · Present 8 · Paid leave 1 · Absent 1 (LOP) · OT 4.5 h  approved
  Basic        50,000 × (9/20)                    =  22,500.00     # paid days 9 = 8 present + 1 leave
  HRA          40% × 22,500                        =   9,000.00
  Meal voucher 30 × 9                             =     270.00
  Overtime     (50,000/20/8) × 4.5 × 1.5           =   2,109.38
  GROSS                                             =  33,879.38
  PF           12% × 22,500                         =   2,700.00
  PT           remaining-to-cap for month           =     200.00     # ₹200 total, once, in H2 ✓
  Loan EMI     MONTH_ONCE → already taken in H1? no → take now = 0.00
  DEDUCTIONS (excl. advance)                        =   2,900.00
  ADJUSTMENT  Less: paid 01–15 Feb                    − 32,300.00
  NET PAYABLE     33,879.38 − 2,900.00 − 32,300.00   =  −1,320.62  ← ⚠ NEGATIVE
```

That last line is *the* teaching moment: a naive "H1 = 50% of gross, H2 = remainder" implementation
overpays the first half (because H1 had no LOP/PT) and goes negative in H2. Our engine surfaces it as
`NEGATIVE_NET (ERROR)` and offers **"Carry ₹1,320.62 as arrear to next month"** → creates
`payslip_kind='ARREAR'` on the March payrun. Show this in the demo and you've demonstrated payroll
maturity, not just CRUD.

Sanity check on the reconciliation invariant when the month is clean (no absence, no OT, PT in H2):
```
H1 net = 25,000 + 10,000 + 300 − 3,000            = 32,300.00
Month  = 50,000 + 20,000 + 600 − 6,000 − 200      = 64,400.00
H2 net = 64,400 − 32,300                          = 32,100.00
         (= 25,000 + 10,000 + 300 − 3,000 − 200 ✓ independently reproducible from the H2 slice)
H1 + H2 = 64,400.00 = monthly net ✓  (invariant #6 from 03 §6)
```

**Do not hardcode "half = 50%".** Feb 2026 splits 10/10, but **Feb 2024 (leap) splits 11/10**
(Mon–Fri = 21): an employee paid on a fixed 50% advance is then overpaid by one day in H1 and short
in H2. `factor = expSliceDays / expMonthDays` handles it automatically; a hardcoded `0.5` is a real
payroll bug. Both months are required test cases, and it's a great thing to *say* while demoing:
"note this is not 50% — the engine counted 10 of 20 days."

## 1.7 Edge cases — implementation checklist (each = one test)

| # | Case | Required behaviour |
| --- | --- | --- |
| 1 | Joiner on Feb 10, H1 = 1–15 | expected days = 4 (10–13), not 10 → `expectedDays()` **must** clamp to `date_of_joining` |
| 2 | Exit on Feb 20, H2 = 16–28 | clamp to `date_of_exit`; F&F handled by a separate `FULL_FINAL` payrun |
| 3 | H1 payrun exists as DRAFT, HR creates H2 | allow compute; validation warns `H1_NOT_FINALISED`; do **not** offset |
| 4 | Second H1 payrun for Feb 2026 | `409 HALF_ALREADY_RUN` (from `uq_payslip_one_per_kind`) with a link to the existing slip |
| 5 | H1 PAID, then HR back-dates an absence to Feb 5 | H1 is immutable → auto-create `ARREAR` line in H2 (or next month if H2 also PAID) + audit |
| 6 | Unpaid leave spans 13 Feb–17 Feb | LOP days counted in the slice each day falls in (3 in H1: 13 only… be precise: 13,14,15,16,17 with 14/15 weekend → LOP days 13,16,17 → H1 1, H2 2) |
| 7 | Sandwich rule ON and 14–15 Feb are weekend between LOPs | rule must be evaluated on the **month** view, not the slice, or weekend days on both halves get treated inconsistently → document that sandwich logic runs pre-slice |
| 8 | OT approved after H1 was paid | `ARREAR` line "Overtime 01–15 Feb" in the next payrun; never re-open H1 |
| 9 | Half-month + holiday list changes afterwards (Republic Day 26 Jan type) | recompute H2 → expected days change → factor changes; require `?recompute_children=true` and warn |
| 10 | ESI: employee's month-equivalent gross 20,500 | enrolled (≤ 21,000); if HR only looked at H1 gross 10,250 they'd also enrol — but the *exit* case (21,500 monthly) is where per-slice logic wrongly enroles. Test both. |
| 11 | PT annual cap exhausted in a previous month | `pt_remaining = 0` → PT line omitted with trace note `CAP_REACHED` (don't print ₹0 lines by default) |
| 12 | Employee paid **both** monthly and H1+H2 for Feb | `DUPLICATE_PERIOD` at validation, `ERROR` severity (this is real money). Guard = overlapping `period_key`/range check |
| 13 | A day with no attendance row in H1 (data gap) | `ABSENT`? or `INCOMPLETE_DATA` warning — pick: **warn + treat as LOP only if coverage < threshold**, else block. Never silently pay or silently deduct. |
| 14 | Negative H2 net | §1.4 step 3 (carry or block); PDF for the *next* month must show the arrear line so the employee isn't confused by an unexpected deduction |
| 15 | YTD / Form-16 style totals | Σ over all slices (H1+H2) — a test asserting `ytd_net(month_end) == Σ nets` catches the classic "only monthly slips counted" bug |
| 16 | Dashboard "Average salary" | must group by `date_trunc('month', period_start)` per employee, else half-month runs **halve** the average. Add `payslips_generated` vs `payruns_paid` as two KPIs. |
| 17 | Pay frequency validation | `BI_MONTHLY` with a 28-day range → `422 PERIOD_FREQUENCY_MISMATCH` (max 16 days for a half). Catch it at creation, not compute. |
| 18 | Employee complaints "salary is half" | communication: the PDF prints "Monthly ₹50,000 · Half-month 01–15 Feb · Days 10 of 20 · Balance will be paid on 28 Feb"; the portal shows a **month card** with H1 + H2 + total |

## 1.8 API/UI surface for the feature

```
GET  /api/payruns/eligible-employees?structure&from&to&kind=HALF_FIRST     → blockers[]
POST /api/payruns {name, salary_structure_id, period_start, period_end,
                  pay_frequency:'BI_MONTHLY', half:'FIRST'|'SECOND'|null,
                  compute_mode:'PRO_RATA'|'ADVANCE_50'|'FIXED', employee_ids[]}
POST /api/payruns/preview?employee_id  → {lines, factor, alreadyPaid, netPayable, warnings[]}   # ONE employee, no writes
POST /api/payruns/:id/reconcile-check  → {h1_missing, duplicate_period, pt_cap, esi_flip, negative_net[]}
GET  /api/employees/:id/month-ledger?month=2026-02 → {slices[], already_paid, month_equivalent, remaining}
```
`preview` is the single most demo-worthy endpoint in the whole project: type an employee + a date
range, see the lines before any write. It's also your regression harness.

UI: wizard Step 1 gets a segmented control `Monthly | 1st Half (1–15) | 2nd Half (16–end) | Custom
range`; choosing a half auto-fills the dates and shows "Expected days in this slice: 10 (of 20)";
Step 2's eligibility table gains a `H1 done ✓` badge; the payrun header shows a **"This is a half-month
run · H2 will offset ₹32,300.00"** banner. Payslip list groups by month.

---

# Part 2 — Employee downloads payslip directly from the portal

## 2.1 The two responsibilities (say this in the pitch)

> "Email is a **notification**. The portal is the **system of record**. If SMTP is down, the network is
> down, or a Gmail quota is exhausted at 3 p.m. on payday, employees still get their payslip."

That framing also *de-risks your own demo*: the portal path is the one you click when the bulk mail
fails.

## 2.2 Flow (with the 202 pattern for a not-yet-generated PDF)

```
Portal "Payslips" card → GET /api/me/payslips?year=2026
   (row = {id, period_label:'February 2026', kind:'HALF_FIRST', net, released:true, pdf_state})

click [Download PDF] → GET /api/me/payslips/:id/pdf
   ├─ 403 not owner, or slip not released                → "Contact HR" (no leak of existence: 404 vs 403 → 404)
   ├─ document exists && hash valid && version current   → 200 application/pdf  (Content-Disposition: attachment;
   │                                                                          filename="Payslip_EMP001_2026-02-H1.pdf")
   └─ missing / stale (document_version changed, lines edited)
        → enqueue GENERATE_PDF (priority=1, jobId=pdf:{id}:v{n}) + write task_queue row
        → 202 {state:'GENERATING', poll_after_ms:800, status_url:'/api/me/payslips/:id/pdf'}
             frontend: <DownloadButton> shows spinner + SSE/poll → auto-retry GET → save

GET /api/me/payslips/:id/pdf?inline=1     → same checks, disposition:inline (in-app preview)
POST /api/me/payslips/zip {year}          → 202 + job (12 PDFs + an index.txt) → GET /api/me/payslips/zip/:jobId
```

## 2.3 Model

```sql
CREATE TABLE payslip_documents (
  id uuid PK, payslip_id uuid→payslips ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'PAYSLIP',              -- PAYSLIP | ARREAR | F_AND_F | ANNUAL_SUMMARY
  version int NOT NULL,                              -- matches payslips.document_version
  storage_path text NOT NULL, bytes int NOT NULL, sha256 text NOT NULL,
  renderer text NOT NULL,                            -- 'pdfkit' | 'puppeteer' (debuggable)
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payslip_id, kind, version)
);
CREATE TABLE payslip_downloads (
  id uuid PK, payslip_id uuid NOT NULL, actor_user_id uuid NOT NULL,
  actor_role user_role NOT NULL, via text NOT NULL,   -- PORTAL | EMAIL_LINK | HR_PRINT | ZIP
  ip inet, user_agent text, document_version int, sha256 text, created_at timestamptz DEFAULT now()
);
ALTER TABLE payslips ADD COLUMN released_at timestamptz;  -- see 07 §F.3
```
`sha256` gives you: cache validation, "was this file modified after we sent it?", a printable
verification code (see §3.3), and free de-dup of regenerated PDFs.

## 2.4 Access-control rules (write these as tests, they are the reviewable part)

1. `/api/me/*` derives `employee_id` from the JWT — never from params/body (closes `07` A1).
2. `GET /api/payslips/:id` for an `EMPLOYEE` → allowed **iff** `payslip.employee_id === token.employee_id`
   **and** (`status='PAID'` or `released_at IS NOT NULL`). Otherwise **404**, not 403 — don't confirm
   other people's IDs exist.
3. Drafts/COMPUTED-but-unreleased must never appear in `/api/me/payslips` and must never be emailed.
   Enforce at the **query** level (`WHERE … released`), not in the UI, so a forgotten `v-if` can't leak.
4. `payslips` PDFs are **watermarked** unless PAID: `pdfkit` draws a 40° `PREVIEW — NOT RELEASED`
   diagonal. Cheap, and it means an accidental share can't be mistaken for a salary certificate.
5. Rate limit `10/min` per user on the PDF route (and log `429`s to audit).
6. Never accept `?url=` or a path; `storage_path` comes only from the DB row (no path traversal —
   `..%2F` on a filesystem-backed download is the classic).
7. Bank-share link (stretch, §3.4): token `sha256(random)` stored hashed, `expires_at ≤ 7 days`,
   `max_uses`, `revoked_at`, scope = **one document only**, no name in URL, served at
   `GET /api/share/:token`. Log every fetch. This is the only place a token-in-URL is acceptable —
   say why in the README.

## 2.5 What "download" implies beyond the button (where teams lose time)

- **File naming**: `Payslip_<EmpCode>_<FY>_<period_key>.pdf` (HR/loan officers file by name; do not
  use raw UUIDs).
- **Year filter + month cards** in the portal, with H1/H2 grouped under the month and a month total.
- **"Latest payslip" hero card** on the portal home (`/api/me/summary`) — the first thing an employee
  wants is "how much did I get this month", so lead with it.
- **YTD panel** (gross/ded/net) with a toggle to FY (April–March) — reuse `ytd_*` (see `06` §16).
- **Explainability**: tapping the amount opens the same line table HR sees (earnings/deductions/OT),
  *minus* the internal trace. That kills most "why is my salary less" tickets and directly answers the
  PDF's "understandable payslips" line.
- **Mobile**: portal is one column at 375 px; PDF preview uses `inline=1`. No external CSS/CDN (the
  IDE preview won't fetch it).
- **Retention**: `payslip_documents` older than N years are kept (payroll records are long-lived) —
  document a retention policy row in `company_settings` and an `ARCHIVED` storage class as roadmap.

## 2.6 Failure modes → behaviour (the queue's job, reused for on-demand)

| Failure | Behaviour |
| --- | --- |
| Chromium missing / launch crash | `renderPayslipPdf` falls back to pdfkit at boot, logs `renderer=pdfkit (fallback)`; user still gets a PDF |
| Worker not running (dev restart) | `task_queue` row stays PENDING; UI shows "queued, waiting for worker"; `/api/system/queue` names the problem. `reclaimStalled()` on boot |
| Generation throws | job retries 3× w/ backoff → after exhaustion `email_status/pdf_state='FAILED'`, `error_message` shown to HR (never a bare 500 to the employee) |
| File deleted from disk but DB row exists | `fs.stat` check → `PDF_MISSING` → auto-re-queue with new `version` (self-healing; test it) |
| Employee hits download 30× | rate-limited; single job due to `jobId = pdf:{id}:v{n}` dedupe |
| HR edits a slip after sending the email | `document_version` bumps → portal shows "updated version available"; email's attachment is stale — hence the portal link in the mail body |

---

# Part 3 — Five more extras ranked by (impact ÷ effort)

| Rank | Feature | Effort | Why it wins marks |
| --- | --- | --- | --- |
| 1 | **Salary-rule dry-run tester** — `POST /api/salary-rules/validate` + a "Try on Rahul Sharma (Feb 2026)" button showing per-line values and `depends_on`/cycle errors | 3 h | Makes the config screens *provably functional* (explicit PDF guideline). Also your safety net against the formula-RCE + forward-reference bugs |
| 2 | **Payslip inputs** (one-off bonus / recovery on a payslip) + `payslip_inputs` table + rules reading `inputs.BONUS` | 4 h | Odoo parity; proves the engine has real variable input, not just fixed rules |
| 3 | **Bank payment sheet CSV + PDF bundle ZIP** per payrun (`POST /api/payruns/:id/export`) | 3 h | The artifact a payroll team actually uses; "here's the UTR-ready CSV" is a great closing demo slide |
| 4 | **Employer-cost view** (PF + ESI employer share per dept, one extra chart + `payslips.employer_cost`) | 4 h | Dashboard depth beyond the required KPIs, and cheap because statutory rules already exist as rules |
| 5 | **Payslip verification** — hash printed on the PDF + `GET /api/verify/:hash` (public, rate-limited, returns only valid/period/net + a QR code) | 3 h | Memorable, security-flavoured, and it's literally 20 lines. QR = `pkgs.qrcode` → PNG data URI (no CDN) |

Honourable mentions for the **roadmap slide** (say it, don't build it): arrears/retro engine beyond
halves, Form 16 + investment declarations & proofs, payroll journals/GL posting, accruals & F&F,
PF/ESI challan exports, biometric device ingest, approval chains for salary changes, i18n (Gujarati
labels — you're in Ahmedabad, a one-line toggle on the PDF is a nice local touch), mobile app,
multi-currency.

## Pitch it as: "the extra features are not screens, they're consequences of the data model"

`month_anchor` + `line_kind='ADJUSTMENT'` + `evaluation_period` ⇒ half-months work correctly.
`document_version` + `sha256` + `released_at` + one audited route ⇒ self-service works safely.
That sentence is worth more than either feature alone.
