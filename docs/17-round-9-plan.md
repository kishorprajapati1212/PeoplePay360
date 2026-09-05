# 17 · Round 9 — the schedule that could not save, a payroll with nobody in it, approve buttons that never appeared, and a link that says how long it lives

Four items, each written down **before** touching anything, with the file and line that shows what is really
wrong. Read the middle column as "what the code says today"; nothing here is remembered from an earlier round.

---

## A · "the working schedule updating show this error … also not done crud on it"

The error the user pasted, translated:

```
days.0.day … days.6.day : Expected number, received nan     ← `dow` = z.coerce.number() got a day NAME
days.5.start / .end, days.6.start / .end : Use HH:MM         ← Sat and Sun are weekly offs: they send start:'' end:''
```

| What the code says | File |
|---|---|
| `scheduleDay` = `{ day: dow, start: timeStr.optional(), end: timeStr.optional(), … }` and `timeStr` is `z.string().regex(HH:MM, 'Use HH:MM')` — `.optional()` accepts a **missing** key but not `''`, so an off-day that sends `start: ''` is refused with a clock-format error. | `backend/src/validators/common.js:25`, `hr.schema.js:8` |
| `dow = z.coerce.number().int().min(1).max(7)` — `Number('mon')` is `NaN`, and zod calls that "received nan". The page maps names → numbers (`dayNumberOf`), so this only bites a client that still sends names — which is what an older build in the browser does, and what any other caller (curl, an import) will hit. A validator that says "nan" instead of accepting `MON` is not a helpful boundary. | `common.js:27`, `frontend/src/pages/org/WorkingSchedulesPage.jsx:32` |
| The service already normalises properly — `normaliseDays` treats a day with no times as a rest day and stores `start:null` — the refusal happens **above** it, in the schema. | `backend/src/services/org.service.js:41-53` |
| "not done crud on it": the page has New + Edit. `DELETE /org/working-schedules/:id` exists and refuses with `SCHEDULE_IN_USE` + `{employees, contracts}` counts, `org.schedules.remove` is in the client, **and no button calls either**. There is also no way to switch a schedule off without opening the dialog. | `org.routes.js:13`, `org.service.js:55`, `endpoints.js:49` |

**To do**

1. `scheduleDay` gets a small, readable preprocessing step: day names (`mon`…`sun`, any case) → 1…7, and an empty
   string in any field → "not sent". A worked day still needs both times — the service says so, and now the form
   marks those boxes required for a day that is ticked on.
2. The page stops sending `''` for a weekly off (it sends only `{ day, rest: true }`), and the time inputs are
   disabled *and* cleared for an off day, so what is on screen is what goes out.
3. Real CRUD on the page: **Delete** in the row, which shows the API's own sentence plus a *Deactivate instead*
   button when people are still on it, and an **Active/Inactive** toggle in the row for the case where deleting is
   rightly refused. Both reuse `schedule:write` and `useAction`, nothing new.

---

## B · "the payrun is not show correctly like there is show the 4 assign but when i am doing it show none is eligible … create 100 to 200 seeder data and only make those physically possible and sensible"

| What the code says | File |
|---|---|
| "4 assigned" is the structure dropdown label: `s.name (num(s.employees) assigned)`. | `frontend/src/pages/payroll/PayrunsPage.jsx:33` |
| The candidate query needs `e.status='ACTIVE'`, `c.status <> 'DRAFT'`, **and `c.salary_structure_id = <picked structure>`** with `c.start_date <= period_end and (c.end_date is null or c.end_date >= period_start)`. Any one of those misses and the list is empty. | `backend/src/repositories/employee.repo.js:80-100` |
| When it is empty the page says "Nobody is eligible … three things cause this" — three guesses for the user, and the API already knows which one it is. | `PayrunsPage.jsx:185-186` |
| The demo company is **13 employees**, 4 of them on `STD`, and the runs stop at September 2026 because the dates are hard-coded (`RUNS`, `ATTENDANCE_MONTHS`). A month later the whole demo is in the past, and the next month has nobody eligible for anything. | `backend/db/seed/data.js:155,196,207` |

**To do**

1. Grow the seed to ~160 people (13 hand-written, kept as they are because the demo logins point at them, plus a
   generated majority), and make every generated attribute *possible*:
   - age at joining ≥ 18, dates of birth that put them 22-58 today, joining dates spread 2019 → this month
     (a few joined this month, so they are correctly missing from last month's run);
   - one primary contract each, open-ended for permanents, `end_date` = exit date for leavers with
     `status EXPIRED` and the employee `TERMINATED` (today the seeder forces every row ACTIVE even with an exit date,
     which is not a thing a payroll can mean);
   - wages inside a band that matches the title (intern 15-20k, executive 26-45k, senior 60-95k, lead/manager
     95-185k), so PF/ESI ceilings and the PT slab behave;
   - PAN built to the real shape from the name, 12-digit UAN, ESIC number only under the ₹21,000 insurance limit,
     IFSC from a small set of real bank prefixes, pincode inside the range that belongs to the city, phone in the
     6-9 mobile range, email unique and derived from the name;
   - manager ids that cannot cycle (a manager is always an earlier row), departments from the existing list plus
     heads from the generated people.
2. Attendance, allocations and leave follow the same people (the loops already iterate `empMap`), with this month's
   requests left **waiting** so there is something to approve — see §C.
3. Dates are derived from *today*, not written in the file: the last three full months are PAID runs, this month is
   a DRAFT run with everyone in it so Compute can be pressed and works. `SEED_EMPLOYEES` and `SEED_PAYRUN_MONTHS`
   cap the work — a 160-person month is 160 real computations through the engine, and that is what the seeder
   should be spent on, not on 12 months of it.
4. The wizard stops guessing: when a period returns nobody, the API sends back the reason it has — how many
   employees sit on that structure, how many are inactive, how many contracts do not cover these dates, how many are
   already in a run for it — and the page prints that. `STRUCTURE_EMPTY` ("no rules") stays as its own error.

Verification without a database: `db/seed/data.js` is a pure module, so the unit runner imports it and asserts the
shape — count, unique emails, ages, PAN/IFSC/UAN shapes, no contract that ends before it starts, no manager cycle,
pending requests that exist inside the current month. The inserts themselves still need Postgres.

---

## C · "there is still leave or payoff approve button not show in any user"

| What the code says | File |
|---|---|
| The enum is `request_status AS ENUM ('DRAFT','TO_APPROVE','APPROVED','REFUSED','CANCELLED')`. There is **no** `PENDING`. | `backend/db/migrations/001_enums.sql:11` |
| The approve/refuse buttons render only when `r.status === 'PENDING'`. That is never true, for any role, in any data. | `frontend/src/pages/timeoff/LeaveRequestsPage.jsx:111` |
| Same wrong word in three more places: the status filter (so choosing "Pending" filters to nothing), the employee's Cancel button, and the overview's pending list. | `LeaveRequestsPage.jsx:100`, `MyTimeOffPage.jsx:100`, `TimeOffOverviewPage.jsx:15` |
| `StatusChip` has a tone for `PENDING` but none for `TO_APPROVE`, so even the chip fell back to grey. | `frontend/src/components/ui/StatusChip.jsx:7` |
| Permission **checks** were not the problem: `timeoff:approve` and `attendance:approve_overtime` are in `HR_CORE`. But a permission is not a screen — the two payroll logins held `timeoff:approve` while `ROLE_NAV` gave them no Time Off menu at all, so for them the buttons did not exist. | `backend/src/lib/shared/permissions.js:105-114`, `:158-207` |
| The seeder only ever makes 8 requests, 4 of them waiting, for the first eight employees — so even after the word is fixed, a demo this thin looks dead. | `backend/db/seed/seed.js:~290` |
| And the payroll menus: `navFor(['HR_PAYROLL_MANAGER'])` returned only `payroll, settings`. Reaching `/time-off/requests` by URL worked (the route accepts `timeoff:approve`), which is the sign of a missing link rather than a missing right. | `backend/scripts/test-unit.js` → *a role that can approve leave can reach the approve list* |

**Done after the first pass (same complaint, second time)**

The status word, the chip and the seeded queue were fixed, and the complaint came back. Two more things were hiding in it:

1. `TIMEOFF_GROUP` is now a constant in `permissions.js`, referenced by the HR menu **and** by `NAV_OVERRIDES.payroll_user`, so any role that can approve leave is handed the menu that uses it. Payroll roles therefore see: Time Off → Requests / Types / Allocations / Dashboard, next to Payroll.
2. The payroll roles no longer *hold* the HR-admin writes their menu cannot reach (`employee:write`, `contract:write`, `schedule:write`, `holiday:write`, `department:write`, `attendance:write`, `attendance:approve_overtime`, `timeoff:type_write`, `timeoff:allocation_write`): `HR_CORE_PAYROLL = HR_CORE.filter(...)`. Reading stays, so pay still computes from real attendance. They kept `timeoff:approve`, because a leave day is a pay day.

Both directions are now a test, in `scripts/test-unit.js`: a nav link never opens a screen the role cannot use, and a write permission never sits in a role with no link to its screen.

**To do**

1. One place decides the words: `frontend/src/utils/leaveStatus.js` exports `REQUEST_STATUS` (`TO_APPROVE` etc.),
   the label for each, and `isWaiting(row)`. The four files use it; nothing compares a raw string to a status again.
2. `TO_APPROVE: 'warn'` in `StatusChip`, label "Waiting for approval" where a sentence needs it.
3. Refuse/approve stay where they are (in the row, only for a waiting request) but the page gains a line above the
   table when nothing is waiting, saying what "waiting" means and where requests come from — so an empty queue reads
   as an empty queue, not as a missing button.
4. The seeder spreads waiting requests across many people and both sides of this month, and includes an overtime
   row awaiting approval, so the OT button on `/attendance` is reachable too.

---

## D · "i have gmail and gmail password … give me place where i can put and also want to know the email is going or not and password is working or not … ttl like only 10 minute … if they update they can not do reset it"

| What the code says | File |
|---|---|
| **The invite endpoint throws.** The success sentence in `createInvite` interpolates a bare `driver` — there is no such local; the value computed above is `mailDriver`. So `POST /users/:id/invite` sends the mail, then dies building its response, and the admin sees a 500 for a send that worked. Nothing else in the app is affected, which is why every check passed. | `backend/src/services/user.service.js:84-89` |
| The link lives 72 **hours** (`INVITE_TTL_HOURS`, default 72) and the repo adds `String(ttlHours)` to `now()`; nothing in the product lets you set minutes. | `src/config.js:68`, `src/repositories/user.repo.js:95` |
| Single-use and "used" detection are already right: `accepted_at` blocks reuse, `acceptInvitation` is the atomic claim, and `completeInvite` says "This link cannot be used again." | `user.service.js:117-131` |
| Where to put Gmail: Settings → Company → **E-mail delivery** exists from last round, with *Check connection* (verifies the login) and *Send a test mail to my address* (a real send). What is missing is that the Users page — where the link is sent from — says nothing about it. | `frontend/src/pages/settings/CompanyPage.jsx`, `pages/settings/UsersPage.jsx` |

**To do**

1. Fix `driver` → `mailDriver`, and make the unit runner assert the file has no bare `driver` reference, so the
   class of bug (a message built from a name that does not exist, invisible to the build) is pinned, not just this
   instance.
2. Minutes, not hours, and set in the product: `company_settings.mail_invite_ttl_minutes` (migration `015`,
   default 10, `INVITE_TTL_MINUTES` as the env fallback, clamped 5-1440), read by `createInvite`. Every sentence that
   said "hours" now says what it is: "This link works once and stops working after 10 minutes."
3. Answer "did it go?" on the screen that sends: the invite result panel shows the driver, the recipient, and
   `expires_at` as a countdown; the row for an account that has an open link shows *link sent 4 min ago · expires in
   6 min*, and once used, *password set at …* — all from data the API already returns. Plus a link to
   Settings → System → mail log, where each send is a row (SENT / FAILED with the provider's own error).
4. Answer "is the password right?" without leaving the page: the mail panel's *Check connection* result now names
   the two failures separately — login refused (`Username and Password not accepted` → "that is what an app password
   is for") versus network (host/port) — and the Users page points at that button when a send has never worked.
5. Readability: the invite code keeps one job per function with a sentence above it, and the templates state the
   expiry in the same words the UI uses.

---

## E · What "done" means, and what stays unproven here

Done = code in place, and these green: `npm run check` (syntax + import graph + unit + route count),
`node backend/scripts/test-unit.js`, `scripts/test-docs.js`, `cd frontend && npm run build`,
`node scripts/ui-probe/run.mjs` (jsdom cases with a stubbed API, asserting the text on the screen),
`python3 scripts/check-contrast.py`. New cases this round: the schedule payload for an off day, the waiting-status
buttons with the real enum value, the invite response sentence not throwing, and the seeder data shape.

Unproven in this sandbox, always: anything needing Postgres or Redis — the seeder's inserts, a real payroll
computation, a real SMTP conversation. Those get a checklist to press on your machine, and where the code path can
be described it is described, never asserted as tested.
