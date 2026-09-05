# 15 · Reading the code

You asked for the code to be easy to follow, and the honest answer is that consistency is what makes it so — not
comments. This page is the short version of "where do I look, and what will I find there".

## The one shape every screen uses

`frontend/src/pages/**` are all written in the same five parts, top to bottom. If you can read one, you can read
all of them:

```
1 · imports            what this screen is built from (api, hooks, ui controls)
2 · useApi(...)          the GET that fills the page            → list
3 · useMemo(...)         what the list is turned into           → options, totals, filtered rows
4 · useState(...) + handlers   the dialog's fields and its save
5 · return <PageHeader/> <Panel> <DataTable/> <Modal/>         the markup, reading order = visual order
```

Nothing else. A page does not compute payroll, does not talk to Postgres, and does not decide permissions —
it renders what the API said and refuses to render what the API says the role may not do.

Two habits that keep step 3 honest:

* **Derived values are `useMemo`s, never state.** `const chosenBalance = cards.find(...)` is a lookup; storing it
  in `useState` would need an effect to keep it in sync, and effects are where pages get hard to read.
* **The problem sentence is computed once.** `raiseProblem`, `carryProblem`, `formError` — a string or `null`.
  The footer disables on it and the field shows it, so a message cannot exist in one place and not the other.

## Where the shared pieces live

| you want to change | it lives in | notes |
|---|---|---|
| a control (input, select, checkbox, switch) | `components/ui/controls.jsx` | `Field` owns the label, hint and error line, so no page writes its own |
| the table: toolbar, columns, pager, empty state | `components/data/DataTable.jsx` | `title` on a column becomes a hover explanation on the header |
| a dialog | `components/ui/Modal.jsx` | scrolls its own body, traps focus, closes on Esc |
| an explanation box (`info` / `warn` / `good`) | `components/ui/Feedback.jsx` → `Notice` | used instead of inventing a coloured `<p>` |
| what a leave type costs | `utils/leave.js` | one sentence, read by the employee's dialog and the approver's |
| money, dates, percentages | `utils/format.js` | never `toFixed` inside markup |
| fetching, loading and busy flags | `hooks/useApi.js` | `useApi` for the page's data, `useAction` for a button that does something |
| which buttons a role sees | `frontend/src/rbac/Can.jsx` + `backend/src/lib/shared/permissions.js` | the server's table is the source of truth; the front end mirrors it |
| which screen a role opens on | `landingFor()` in `frontend/src/App.jsx` | checked against that role's menu, so it cannot land on a refusal |
| colour, spacing, the `.input` / `.btn-*` classes | `frontend/src/index.css` | one stylesheet, both themes; `scripts/check-contrast.py` measures it |

Backend, the same idea: `routes → validators → service → repository`. A route never opens a transaction, a
repository never business-decides, and anything slow (PDFs, bulk mail) goes to the worker with the row it should
update, so the request can answer.

## Reading a screen you have never seen

1. Find the `useApi` call — that is the API path, and `backend/src/routes/*.js` is the matching file.
2. Read the columns array — it is literally the table, and each `render` says where the value came from.
3. Read the footer button's handler — that is the only thing that writes, and what it sends is the request body.

## Status words and small buttons

Two bugs from round 9 both came from a screen inventing a value or re-sending too much, so the rules are written here.

**A status is data, not a vibe.** `request_status` in `001_enums.sql` is `DRAFT | TO_APPROVE | APPROVED | REFUSED |
CANCELLED` — there is no `PENDING`. Four screens compared a row to `'PENDING'`, which is why "the approve button does
not show for any user" was true for every user on every row while the permissions were correct the whole time.
Anything that asks whether a request is waiting now asks `frontend/src/utils/leaveStatus.js` (`isWaiting`,
`isCancellable`, `STATUS_LABEL`, `STATUS_OPTIONS`), and `scripts/test-unit.js` reads the migration itself and refuses
the invented word in those files.

**A button that changes one thing sends one field.** *Deactivate* on a working schedule is
`PATCH /org/working-schedules/:id/active` with `{ is_active }`, because the full-row PATCH beside it requires the
whole `days` array — a small button would have had to rebuild seven rows from a list endpoint, and any day that list
left out would have come back as a weekly off. When the only endpoint available takes the whole object, add the small
endpoint rather than sending a body you did not read.

## Mail: two boxes, and where the answer comes from

`Settings → Company → E-mail delivery` asks for a mail address and a password. That is deliberate, and the code
that makes it true is three small files:

| File | What it owns |
|---|---|
| `backend/src/lib/mailer/providers.js` | The table: which domains we know, the SMTP host, port and TLS mode that belongs to them, and whether the provider demands an app-specific password. Adding a provider means adding an entry here and nowhere else — the settings screen reads the list from the API. |
| `backend/src/lib/mailer/index.js` → `resolveDriver` | The one decision: **what you typed wins, the table fills only what you left blank**. It returns `driver`, `server`, `inferred` and a `note` that explains a refusal. Nothing else in the product picks a port. |
| `backend/src/lib/mailer/runtime.js` → `resolveMailConfig` | The precedence between the environment and the saved row — row over env, key by key — and the rule that `mail_enabled: false` means preview whatever the credentials say. |

Read the note, not just the driver: an address from a domain that is not on the list arrives as `preview` **with a
sentence naming the missing box**, because guessing a host for an unknown company would be worse than admitting it.
`GET /api/company/mail` and `POST /api/company/mail/check` both return `server` + `inferred`, so the screen, the
test mail and `docker compose logs worker` all name the same host — one source, three places to look.

`backend/.env` carries only `EMAIL_NAME` and `EMAIL_PASSWORD` as live mail keys; the host/port/TLS variables are
commented, because an uncommented `SMTP_PORT=587` quietly outranks a Gmail address that wants 465.

## Rules this repo keeps to

* No numeric code in the UI (`230` is not a status, `TOO_MANY_REQUESTS` is).
* A refusal explains itself. `cannotUnsend` and `deactivate` instead of delete are the pattern: the API says why,
  and the screen repeats it.
* One role per account; a person's powers come from `permissionsFor(role)`, so "what can X do" has one answer.
* Anything the user cannot explain gets a sentence in the interface — and if the sentence would be "nothing, it is
  decorative", the element goes. That is how the departments `Parent` column died, and why the attendance
  `Overtime approval` column stayed with a hover explanation.
* The probe (`scripts/ui-probe`) asserts words on the screen, not CSS classes, so a rename never breaks it and a
  missing sentence never passes it.
