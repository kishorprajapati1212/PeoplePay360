# 16 · Round 8 — mail that really sends, forms whose stars are true, payslips in one click, structures that explain themselves

Written from the code, not from memory: every "what was wrong" line below is a file and a line I read in this
tree before changing anything. Four items, in the order they will be done.

---

## A · "did you not made the link sending with email … i have the email password and email"

**What I found.** The invitation flow is complete and correct end to end — `POST /users/:id/invite` issues a
single-use token, mails it, and `GET /auth/invite/:token` → `POST /auth/set-password` lets the employee choose
their own password (`backend/src/services/user.service.js:60-130`). What was never true is the *sending*:
`backend/.env` has `EMAIL_NAME=`, `EMAIL_PASSWORD=`, `SMTP_HOST=`, `MAIL_DRIVER=` all empty, so
`resolveDriver()` returns `preview` and every "mail" is a `.eml` file in `backend/storage/mail/`. My earlier note
that credentials were filled in was wrong — the file says otherwise. And `createMailer(process.env)`
(`user.service.js:90`) only ever reads the environment, so there is no way to fix that without editing `.env` and
restarting the API — which is what "make according to it" is really asking for.

**What to do, and why**

| # | change | why it is the right shape |
|---|---|---|
| A1 | migration `013_mail_transport.sql`: `mail_enabled`, `smtp_host`, `smtp_port`, `smtp_secure`, `smtp_user`, `smtp_password` on `company_settings` | mail transport is company configuration; it belongs beside `mail_from` / `mail_daily_limit`, which are already there |
| A2 | `mailerFor()` — one resolver that merges the DB row over the env and is used by the API *and* the worker | two constructions (`user.service.js:90`, `worker/jobs/email.job.js:10`) is how "it sends from the button but not from the worker" starts |
| A3 | `smtp_password` is write-only: `GET /company` never returns it, only `smtp_password_set` | a settings screen that echoes an app password back to the browser is a leak, not a convenience |
| A4 | `mail_enabled` is the switch; empty password + "save" keeps the stored one | so testing credentials cannot accidentally half-save them |
| A5 | `GET /company/mail` (status + `verify()`), `PUT /company/mail` (validated), `POST /company/mail/test {to}` | the answer to "does my Gmail app password work" has to be one click and the provider's own words, not a log file |
| A6 | Settings → Company gets an **E-mail delivery** panel: switch, host, port, SSL, user, password, from, daily cap, *Test connection*, *Send a test mail* | the user has the address and the app password; pasting them in the product is the whole ask |
| A7 | when a send falls back to `.eml`, the Users page says so *and links to that panel* | an invite that "sent" into a folder is the bug pattern from round 4, in new clothes |

**Gmail specifics** (documented in README §"Making mail actually go out"): a Google account needs an **App
Password** (2-Step Verification must be on) — a login password is rejected with `Username and Password not
accepted`, which the test button will show verbatim; `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, SSL **off**
(STARTTLS); a personal account is capped near 500 recipients a day, which is what `mail_daily_limit` enforces
before a batch is queued, not after the provider has blocked the domain.

---

## B · "some time field say \* and some does not has but even when click on submit it will show error"

**What I found.** Two separate defects, both real.

1. **The refuse half of leave approval was broken.** The API's decision body is
   `decideBody = { status, approved_days?, refuse_reason? }` (`backend/src/validators/hr.schema.js:42-43`) and
   `decide()` refuses a REFUSED decision with no reason (`timeoff.service.js:122`). The screen sends
   `{ remark }` (`frontend/src/pages/timeoff/LeaveRequestsPage.jsx:37-40`) — zod strips unknown keys, so
   `refuse_reason` arrives empty and the server answers `REASON_REQUIRED` while the approver is staring at a
   reason they typed. Approving "worked" only because `status` defaults to APPROVED; the remark was silently
   discarded, and `time_off_requests` had no column for an approver's note at all.
2. **Stars come from three different places.** `Field` renders `*` only when `required` is passed
   (`controls.jsx:13`); `CrudPage` fields carry their own `required`; hand-written dialogs pass it ad hoc. So a
   form can show no star on something the validator requires (`trimmed(80)` = required, no `.optional()`) and
   then answer a submit with a 400 toast — the "error appears anyway" complaint.

**What to do, and why**

| # | change | why |
|---|---|---|
| B1 | migration `014_leave_decision_remark.sql` adds `decision_remark text`; `decideBody` accepts `remark`, stores it, and keeps writing `refuse_reason` for refusal so existing readers are unaffected | the note has to live somewhere before the UI can promise to store it |
| B2 | the decision dialog sends `{ remark, approved_days }`; the reason box is marked required **for refuse** and errors inline before the request | one dialog, and the star matches what the API will refuse |
| B3 | approve offers **Approve only some of it** (0.5-day steps, never more than was asked); the sentence under it says how many days will be recorded | `approved_days` exists in the API and no screen could reach it — a partial approval is a normal Indian HR act |
| B4 | the employee's own list shows *Note from HR* when a decision carries one | a decision you cannot read is a decision that gets re-asked by phone |
| B5 | `utils/form.js` → `missingFields(values, spec)`, and each hand-written form's save refuses with a `NeededNotice` naming the empty fields; the star is put on exactly the fields the validator requires | shared sentence, per-field truth; a page cannot forget half of it |
| B6 | the probe asserts a refuse with no reason never reaches the API, and that a filled one posts `refuse_reason` | this class of bug is invisible to a build; it is visible to a rendered dialog |

Screens swept for B5: employee account/contract, users + invite, time-off types, allocations, leave raise and
decision, departments, schedules, holidays, attendance import, payrun wizard, salary structure and rule, company
settings.

---

## C · "the payslip generation it is not working"

**What I found.** `POST /payruns/:id/generate-pdfs` → `queuePdfs()` (`payrun.service.js:195-209`) puts one
BullMQ job per slip on the Redis `pdf` queue and **nothing else**: `schedule()` (`backend/src/queue/queues.js:26`)
has no fallback, so with the worker not running the button reports success and no PDF ever appears — the exact
"not working" a reviewer would report. There *is* an inline renderer used by the single-slip route
(`POST /payslips/:id/print` → `payslips.print(id)` on the client), so the capability exists one screen away.
The register page (`PayslipsPage.jsx:54`) then tells the user to "generate it from the payrun" — a second screen
to find, with a permission (`payroll:validate`) the register does not mention.

**What to do, and why**

| # | change | why |
|---|---|---|
| C1 | `generatePdfs(id, { mode })`: `auto` = queue when the worker answers, render inline for up to 40 slips when it does not; `?mode=inline` forces the request path; the response says which happened, per person | a demo box without Redis must still produce PDFs; a real run with a worker must not block a request on 1,432 renders |
| C2 | the payrun page becomes a **three-step bar** — Compute → Validate → PDFs → (Mail) — where the next step is the only primary button and each shows its count | "which of these four buttons do I press" is the actual complaint |
| C3 | after Generate, the page polls the run and prints `PDFs: 12 of 40` until it is done, with a *Stop waiting* and a plain reason if the worker is silent | progress beats a toast |
| C4 | the payslip register gets **Generate the missing PDFs** for the run it is filtered to, and a per-row *PDF* that renders on demand | no screen should send a user to another screen to finish one click |
| C5 | a worker/queue line in the same panel: `worker: last seen 4s ago · 0 jobs waiting` or `worker not answering — finishing in this request` | the difference between "broken" and "slow" |

---

## D · "salary structure table is not good enough … not anything say specifically what it is"

**What I found.** The structure dialog's rule table (`StructuresPage.jsx:62-70`) prints `Category`, `Line`, `How`,
`Pro-rata`, `On slip`, `Statutory` — six labels that are all *field names*, and `How` hides the formula behind a
`title` tooltip. Nothing states the consequence: what this line is, and how many rupees it is for this structure.
`ruleBody` requires `name`, `code`, `category` (`payroll.schema.js:5-8`), and the structure form already marks
`name` only — correct, because `code` is `optText(30)` there but required on the **rule** editor, which does not
say so.

**What to do, and why**

| # | change | why |
|---|---|---|
| D1 | a wage box above the rule table wired to `POST /salary/preview`, so every rule shows its **₹ for this wage**, with GROSS and NET totals under the table | the number is the thing payroll is arguing about; the API can already produce it |
| D2 | one plain sentence per rule (`utils/salary.js` → `explainRule`): "12% of Basic, capped at ₹15,000 · deduction · appears on the slip · pro-rata on days worked" | a label tells you the field; a sentence tells you the rule |
| D3 | columns renamed and explained through `DataTable`'s header `title`: *On the slip* → "Appears on the payslip", *Pro-rata* → "Cut for a short month", *Statutory* → "Fixed by law (PF/ESI/PT)" | the tooltip support only became real in round 7 (`DataTable` previously dropped `title`) |
| D4 | the rule editor's `name`, `code`, `category` get their stars, and `computation_type` drives which of amount / percentage / formula is required (only one may be filled) | the validator refuses a PERCENTAGE line with no `percentage`; the form must not let you get there |
| D5 | a "How this reads on a slip" preview: earnings in order, then deductions, then net — the same order `sequence` gives | a structure is a layout; showing the layout beats describing it |

---

## What this round deliberately does not do

* No OAuth2 for Gmail, no per-user mailboxes, no DKIM/SPF tooling — one SMTP login for the company, as today.
* No PDF queue replacement: BullMQ stays the preferred path; the inline renderer is a fallback with a cap, not a
  second engine.
* No formula builder beyond validating and explaining what exists — the allowlist parser in `packages/formula`
  stays the only evaluator.
* `decision_remark` is a note, not a workflow: still one approver, no comment thread, no re-approval after edit.

## Verified how

`node backend/scripts/test-unit.js`, `node backend/scripts/test-docs.js`, `node backend/scripts/routes-list.js`,
`node backend/scripts/check-api-imports.js`, `node scripts/ui-probe/run.mjs`, `python3 scripts/check-contrast.py`,
`bash scripts/check-syntax.sh`, `npm run build` in `frontend`. Anything needing Postgres (the new migrations, a
real seed, a real SMTP login) is described by its code path and is listed as unverified in the final report.

---

## E · What was delivered, item by item, and what only your machine can prove

**1 · Mail — done in code; the send needs your mailbox.** Settings → Company → E-mail delivery holds host, port,
implicit TLS, account, App Password, from-address, daily cap and *Send real mail*. It is stored on `company_settings`
(migration `013_mail_transport.sql`) and read by the API and the worker through `lib/mailer/runtime.js`, so no `.env`
edit and no restart is involved; `.env` still works as the fallback for a deployment that keeps its secret out of the
database. `GET /api/company/mail` states the live driver without opening a connection; `POST /api/company/mail/check`
is the only thing that connects — without an address it verifies the login, with one it sends a real message, and the
panel's *Send a test mail to my address* uses that. The password is write-only: `withoutSecret` in
`company.repo.js` strips it from every read, `smtp_password_set` is what the form sees, and an empty password box
keeps what is stored. The mail that goes out when you press **Send link** on the Users page is the same mail an
invitation uses, so a green test line means the real one arrives; `PUBLIC_APP_URL` still decides what the link points
at (Settings → System → How this install is reached says what it is now).

*Still unproven here:* the SMTP handshake, and `013` itself — no Postgres and no outbound mail in this sandbox.
Press these in order on your box: save the Gmail pair → *Send a test mail to my address* → Users → *Send link* on one
account → open the link in a private window → set a password → sign in.

**2 · Stars that match the validators — done.** `frontend/src/utils/form.js` (`isBlank` / `guard` /
`missingSentence`) is now the only checklist a hand-written dialog uses, and each dialog derives both its stars and
its block from the same list: Contracts, Working schedules (both dialogs), My leave (raise), HR leave (raise and
decision). `components/crud/schemaForm.jsx` runs a field's `validate` before its blank short-circuit, so
"needed unless the line is a percentage rule" is expressible, and a field that may stay empty says *Optional*
instead of carrying a star. Saving is never greyed out without a sentence: the first press marks the attempt, which
turns on the per-field notes and one line naming everything missing. The same rule holds server-side for rules
(`RULE_INPUT_MISSING` in `salary.service.js#saveRule`), so an old row with a blank deciding value cannot be saved
unchanged.

**The leave-approval question, answered plainly:** the payload bug (`refuse_reason` where the API reads `remark`) was
fixed last round; this round added what was genuinely missing — a refusal that asks for its reason before it can be
pressed, and *Approve fewer days than were asked for*, since `approved_days` has always been accepted and no screen
could send it. The employee sees the note under *Note from HR*.

**3 · Payslips — done in code; the render itself needs the database.** `POST /payruns/:id/generate-pdfs` used to write
a queue row and call that success. It now queues, and when the queue throws or nothing is listening it renders up to
`PDF_INLINE_LIMIT` (40) slips in the request, answering with per-person counts — `{queued, inline, generated,
failed[], waiting, already, queue_error, how}`. Mark-paid keeps the old strict behaviour (`mode:'queue'`) because at
that moment files are wanted *and* the mail must stay fast. The run page has a **Payslip PDFs** panel: how many slips
have a file, a bar, *Create the k missing PDFs*, *Re-render all* (for a changed footer or layout), a 1.5 s poll that
ends when every slip has `pdf_generated_at` — with *stop watching* — and the outcome sentence in the API's own words.
The step shows at `COMPUTED` as well, with a line about re-rendering after a recompute. The payslips register gained
the same action for the run in its filter, because its messages told you to go generate them somewhere else. A single
slip's download and the ZIP already rendered on demand, and still do.

*Unproven here:* the actual PDF bytes, since `payslip.service.renderPdf` → `documentPdf` → `payslips.upsertDocument`
needs Postgres. Check on your box: compute → validate → *Create the missing PDFs* → the bar reaches 100% → Settings →
System → Mail log shows one message per person when you send them.

**4 · Structures — done, and it found a dead button.** The list now says what a row is: *Lines*, *Assigned to* (a
count whose tooltip names the contracts), *Used in runs*, *Wage on those contracts* (*varies between* when they
disagree). Wiring the row click showed why the table felt like a dead end: `CrudPage` had no row handler at all, so
the structure dialog — the only place the rules were readable — could not be opened from the list. `DataTable` already
had `onRowClick`; `CrudPage` gained `onRow`, guarded so a click on a button, link, input or dropdown option opens
nothing. The dialog prints one sentence per rule from `utils/salary.js#explainRule` (the same function the Rules page
imports now; the duplicate inside `RulesPage` is gone, and so is that page's local `RulesTable` sub-table, which the dialog replaces — neither is referenced anywhere), and *Show the amounts* calls
the real engine (`POST /api/salary/preview`) for an editable wage and days worked, showing each rule's own
`computation_log` line and Gross / Deductions / Net under the table.

**What the new tests caught in my own shared code:** `guard()` had its blank test inverted — it complained about
filled fields and waved through empty ones — and a spec entry written as `[key, label]` counted as "not required", so
every hand-written guard was a no-op. `npm run build` passed over both. They are pinned by cases now: a refusal with
no reason never reaches the API, and a schedule with no name is not saved.

**Gates as they stood at the end of this round:** `npm run build` ✓ · probe **31/31** · unit **58/58** ·
`check-api-imports` OK · `routes-list.js` **162** · `test-docs.js` ✓ · `check-contrast.py` ✓ (see §5 for the
commands, and the README's *What to run* for the setup sequence).
