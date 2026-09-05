# 19 · Round 11 — the invitation link that answered 500, and what a running database showed

Three asks this round, one of which was really "prove it": an e-mail that hands over a copy-pasteable reset
link, a seeder that leaves payroll untouched, and a shape on the screen that looked round on a desktop. The
first two are done and were *run*, which is new: the sandbox now has Postgres 18.4 in it (`embedded-postgres`,
cluster in `/tmp`, nothing shipped), so migrations 001-015 applied for real and the seeder and the API were
exercised against a database instead of reasoned about.

## A · "create it with proper" - the invite link, end to end

| Where it stood | What it does now |
|---|---|
| `POST /api/users/:id/invite` built the mail body before it knew the link's lifetime, and the response quoted a `ttlMinutes` that had not been computed yet - a `ReferenceError`, i.e. a 500, on every invite. | The link is assembled first: token, row, `expires_at`, then the mail body from the same values. `send_email: false` skips the send and returns the link as the whole delivery, which is what an admin copying a URL into a chat needs. |
| The API and the worker each carried a hand-copied invitation body, so a wording change had to be made twice. | `inviteMail({ name, link, minutes, inviter, company })` in `lib/mailer/template.js` is the only place the invitation is written; both call sites import it, and a unit test refuses a second copy. |
| The link arrived inside an HTML button, which is fine in a mail client and useless in a preview file or a text-only client. | The message is `multipart/alternative`: the text part puts the raw URL on a line of its own ("copy that address into your browser if the button does not open"), and the HTML part repeats it in a `word-break: break-all` monospace block. `toEml` gained the text part it never wrote, so `backend/storage/mail/*.eml` reads like the message that would have gone out. |

The full loop was then run over HTTP against the seeded database: invite with `send_email:false` → 200 with `link`,
`token`, `expires_in_minutes: 10`, `delivery_mode: "not-requested"` → `GET /api/auth/invite/:token` → `valid: true`,
the employee's name, "This link works once, and stops working in 10 minutes" → `POST /api/auth/set-password` → 200 →
the same link a second time → `valid: false`, "This link has already been used. Ask your admin to send another." →
the employee signs in with the new password → 200. Invite *with* mail: 200, `delivery_mode: "sent-by-request"`,
`mail_sent: true`, the task row `COMPLETED`, and a `.eml` on disk carrying the same token.

## B · a seeder that leaves pay runs alone

`node db/seed/seed.js --no-payruns` (alias `--skip-payroll`, environment form `SEED_PAYRUNS=false`) skips payroll
entirely and says so in the banner, while `db/seed/data.js` takes `SEED_EMPLOYEES` (160 default, floor of 35 hand-
written people, hard cap 400). Measured on the live database:

```
employees 160 · users 164 · contracts 160 · attendance 9519 · salary rules 34
pay runs 0 · paid payslips 0 · net paid ₹0 · leave awaiting HR 31        (2.2 s)
```

One honesty fix came with it: the wrinkles pass used to print "0 overtime rows" for an unapproved-overtime row it
had not created when payroll was skipped; it now targets the last day that actually has overtime and says plainly
when there is none.

## C · the credential shape the app now states

`providers.js` gained `appPasswordShapeHint(brand, length)` - one sentence, shared by the API's *Check connection*
hint and the settings panel - and `resolveDriver` reports `providerBrand` and `passwordLength` without ever
returning the secret itself: `pass` is a non-enumerable property of the plan, so `res.json(plan)`, a spread, or a
log line skips it, and a unit test asserts the JSON has no password. Gmail's answer to the value in this report was
`535 BadCredentials` at 14 characters against the 16 it issues - the diagnosis is on the screen, not in a chat.

The environment names the same fix relies on are aliased everywhere mail config is read: `EMAIL_NAME|EMAIL_USER|
GMAIL_USER|SMTP_USER` and `EMAIL_PASSWORD|EMAIL_PASS|GMAIL_APP_PASSWORD|SMTP_PASS|SMTP_PASSWORD`. Typing the two
short forms is enough to reach `smtp.gmail.com:465 · implicit TLS`.

## D · what only a real run could show

1. **`markTask` was broken for every task in the system.** `update task_queue set status = $2, ... case when $2 =
   'COMPLETED' ...` makes Postgres deduce `queue_status` from one use of the parameter and `text` from the other:
   `error: inconsistent types deduced for parameter $2`. Every payslip mail, PDF job and worker retry passes through
   it, so an invite that requested mail returned 500 while the link it 500'd about was already stored. The house
   convention already in `payslip.repo` and `timeoff.repo` fixes it: `status = $2::queue_status`, comparisons on
   `$2::text`. All five statuses were then driven against the database and each timestamp behaved (`PROCESSING`
   bumps `attempts` and sets `processed_at`, `COMPLETED` sets `completed_at`, `FAILED`/`DEAD` set `failed_at`).
2. **A placeholder host left the stored port behind.** A `company_settings` row with no host and the column default
   `smtp_port = 587` produced the server line `smtp.gmail.com:587 · implicit TLS` - a pair no server answers on.
   `resolveDriver` now lets the provider table own host, port and TLS *together* when no host was typed; a port and
   a TLS box you filled in still travel with the host you named (`smtp.gmail.com:587 · STARTTLS` remains reachable
   on purpose, and is unit-tested both ways).
3. **The unit runner never awaited a test that returned a promise.** Such a test printed ✓, the summary said "all N
   passed", and the failure arrived afterwards as an unhandled rejection. `t()` now collects promises and the
   summary waits for them - which is how (1) got caught rather than celebrated as passing.

## D2 · the round shape on a desktop

Asked which element looked wrong, the answer was *the bars*. `rounded-full` on an 8px rail makes each end a
semicircle, and on a wide window a mostly-empty rail reads as two circles with a line between them. Both bars -
`StatusBreakdown` on the dashboards and the compute-progress bar on a pay run - now use `rounded-sm` (2px), the
track gained `overflow-hidden` and the fill lost its own radius, since a clipped child does not need a second one.
Nothing else in `frontend/src` draws a fully round shape that is not meant to be one: the ten `rounded-full`
hits are now spinner, avatars, step badge, legend dots, and these four - which are gone, so the count is six.

The rule is checked in two halves: `all 38 probe cases clean` includes a case that renders `StatusBreakdown` and
asserts every rail carries `rounded-sm` and no fill carries a radius, and `scripts/ui-probe/run.mjs` gained a
`SOURCE_RULES` block - same output, same exit code - that greens `a bar is a bar` by reading the two files,
because a browser bundle has no `fs` and the pay run bar is three state transitions behind a computed run.

## E · What was run

| Check | Result |
|---|---|
| Postgres 18.4 in the sandbox (`embedded-postgres`, port 55432) | `initdb` + start; `node db/migrate.js` → 15 applied, 15 total - the first time `015_invite_ttl_minutes.sql` has ever executed anywhere |
| `node db/seed/seed.js --no-payruns` | the counts in §B, ~2 s |
| API against it, Redis deliberately refused (`REDIS_PORT=6399`) | booted degraded, served every call below; the queue path fell back to in-request sends as designed |
| the invite loop over HTTP | §A, every step 200/200/404-as-refused as expected |
| first pay run created in the UI's own sequence | `GET /payruns/employees` → 97 eligible on *OXP Standard Salaried* for Sep 2026, `page_size` 25 paging, `why_empty` null; 2020-01 on the intern structure → `total 0` and "29 contract(s) sit on "Intern & Contract Stipend" ... 29 have a contract that does not cover 2020-01-01 → 2020-01-31"; create (40 employees) → `compute` → run `COMPUTED`, 40 payslips, gross 20,42,164.29 / net 19,54,870.01, `PAID` payslips overall 0 |
| `POST /company/mail/check` with the reported credential | Gmail's own `535 BadCredentials`, with the 16-vs-14-character sentence first in the hint |
| gates | unit 78 (5 new: shape hint, aliases, no secret in the plan, createInvite's declaration order, the `.eml`'s text part) · `node --test test` 2/2 · routes TOTAL 163 · `check-api-imports` OK · `test-docs` 5/5 · ui-probe 38 clean (one new: the bars)  · contrast 0 of 1158 under the floor · `check-syntax` 195 files OK · `npm run build` ok |

## F · still unproven in this sandbox

A message that *arrives* (the credential on record is the wrong length, by design - nothing was mailed anywhere),
and a PDF rendered by a real Chromium. Everything else listed above was executed.
