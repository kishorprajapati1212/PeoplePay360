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
