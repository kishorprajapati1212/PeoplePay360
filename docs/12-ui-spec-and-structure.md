# 12 · UI spec, folder structure and how RBAC reaches the screens

*(added after the first React pass; supersedes any `apps/web` wording elsewhere)*

## The mockup, read literally

`HRMS OXP - 24 hours.png` is a low-fidelity Excalidraw wireframe of 15 screens. Every one of them exists in the app now:

| sketch | screen | route |
|---|---|---|
| 1 · Login card | `LoginPage` | `/login` |
| 2 · sidebar + KPI row + chart + list | `DashboardPage` | `/dashboard` |
| 3 · Employee profile (tabs, salary summary, actions) | `EmployeeDetailPage` | `/employees/:id` |
| 4 · employee table with toolbar + New employee | `EmployeesPage` | `/employees` |
| 5 · "My Profile" (read-only + editable contact) | `MyPortalPage` | `/me` |
| 6 · Department list | `DepartmentsPage` | `/org/departments` |
| 7 · working-hours grid | `SchedulesPage` | `/org/schedules` |
| 8 · holiday list | `HolidaysPage` | `/org/holidays` |
| 9 · attendance grid per day | `AttendancePage` | `/attendance` |
| 10 · attendance entry dialog | `AttendanceDialog` (in `AttendancePage`) | modal |
| 11 · leave request list with approve/reject | `LeaveRequestsPage` | `/time-off/requests` |
| 12 · leave summary (balances + types) | `LeaveBalancesPage` | `/time-off/balances` |
| 13 · create pay run (2 steps: pick → confirm) | `PayrunWizard` | `/payruns` → New |
| 14 · salary structure (component + formula) | `StructuresPage` | `/salary/structures` |
| 15 · payslip detail | `PayslipDetailPage` | `/payslips/:id` |

The sketch has no colours, no spacing and no icon set — so those came from the working brief rather than the drawing: a dark navy rail, a white top bar with breadcrumbs and a live "run clock", 11px section labels above bordered rows (their boxes are literally labelled "Label" over "Row"), chips and dashed placeholders where the mockup drew them. What the sketch *did* dictate and what is respected: the left rail + breadcrumb top bar, the KPI row on top of a list, one dialog per row-level action, tabs for an employee's history, a two-step pay-run wizard, and a payslip that shows earnings and deductions side by side with Net in a footer.

Screens the sketch does not have, which the API already exposed and the flow needs: contracts, overtime, pay-run detail, payslip list + "my payslips", salary rules, time-off types and allocations, users, access matrix, company settings, system/queues, and 404.

## Folder-wise on purpose

The brief asks for a repository where you can find a thing by its *kind*. Both sides mirror each other:

```
backend/src/<layer>/<resource>.js         frontend/src/<layer>/<resource>.jsx
  repositories/payroll/payslip.js            pages/payroll/PayslipsPage.jsx
  services/payroll/payslip.js                api/payroll.js
  controllers/payroll.js                     components/crud/CrudPage.jsx
  routes/payroll.js                          rbac/menus.js   ← reads the API
  domain/payroll.schema.js                   hooks/useCan.js  ← reads the API
```

* The API puts *all* raw SQL in `src/repositories/`; nothing above it opens a cursor. The front end puts *all* HTTP in `src/api/`; nothing below it calls `fetch`.
* `src/components/ui` is the design system (inputs, chips, modal, tabs, chart). `src/components/data` knows about tables, filters and charts. `src/components/crud` is the generic list/editor (`CrudPage`) that most admin screens are, so those screens are 20 lines of config rather than 200 lines of JSX.
* Pages are grouped by *area*, one folder each, because that is how a human navigates this product: `employees/ org/ attendance/ timeoff/ salary/ payroll/ settings/ portal/`.

## RBAC: one file, two consumers

`backend/src/lib/shared/permissions.js` is the only place roles, permissions, scopes, denies and nav entries are written:

```
PERMISSIONS        catalogue: "employee:read", "payroll:run:approve", …
ROLE_PERMISSIONS   role → permission list (ADMIN = ['*'])
DENIES             negative overrides (HR_USER cannot approve >3 days, no VOID, …)
SCOPE              role → row visibility ('own' | 'all')
ROLE_NAV           what the sidebar looks like for a role
NAV_OVERRIDES      per-role tweaks (employee sees /me, payroll sees /payslips)
```

`GET /api/auth/me` returns `permissions[]`, `menus[]`, `roles[]`, `roleLabels`, `scope` and the linked `employee`. The frontend therefore contains **no copy of the role table**:

* `rbac/menus.js` just maps `me.menus` (from the API) to `{label, to, match, section}` — it only picks the icon and which page module the `to` maps to.
* `<Authorized>` and `useCan` read `me.permissions`; every create/edit/delete button and menu row in every page is wrapped in one of them.
* `App.jsx` keeps a `PAGE_PERMISSIONS` map so a deep link to a page you cannot use shows the inline "not allowed" state instead of a broken screen.

Practical consequences: adding a permission to a role in that one file changes the API *and* the UI on the next `/me` response; a user cannot see a button they cannot use; and the guard is only cosmetic — the API re-checks `requirePerm` + scope on every call, which is why `access-matrix` can be rendered straight from the data.

## Login flow as built

1. `POST /api/auth/login` (work email + password, bcrypt check, IP rate limit 10/15 min) → `{access_token, expires_in: 1200}` + a **refresh token in an httpOnly, SameSite=Lax cookie** (`pp360_rt`, 7 days, rotated and hashed in `refresh_tokens`).
2. The access token goes to `localStorage` under `pp360.auth.v1` with its expiry, so an F5 keeps you in; `api/http.js` attaches `Authorization: Bearer …` to every call.
3. On a 401 (or an expired token) `auth/session.js` calls `/api/auth/refresh` **once**, serialised through a single promise so a page with twelve parallel calls refreshes once; failure clears state and bounces to `/login?next=…`.
4. `logout` calls `/api/auth/logout` (cookie cleared, row revoked) and drops local state.
5. Downloads that the browser starts itself (PDF, CSV, ZIP) cannot set a header, so the frontend either fetches through `utils/download.js` (blob + `a[download]`) or mints a short-lived `/api/auth/token-for-payslip/:id` URL and opens that — `middleware/auth.js` accepts `?t=` with a `download` scope.

## Endpoints consumed (the contract the frontend was written against)

| area | calls |
|---|---|
| auth | `/api/auth/login` `/refresh` `/logout` `/me` `/access-matrix` `/change-password` `/token-for-payslip/:id` |
| dashboard | `/api/dashboard/summary?month=YYYY-MM` |
| employees | `/api/employees` (+`/export.csv`) `/:id` `POST` `PATCH` `DELETE` `/:id/{contracts,attendance,time-off,payslips,summary,terminate}` `/api/imports/employees{,/template,/parse,:id/commit,:id/rollback}` |
| org | `/api/org/{departments,working-schedules,holidays}` (+`/holidays/generate`, `POST/PATCH/DELETE /:id`) |
| contracts | `/api/contracts` (+`/:id`, `/confirm`, `/reassign-manager`) |
| attendance | `/api/attendance{,/grid}` `POST` `/:id` `DELETE` `/clock` `/overtime/:id/approve` |
| time-off | `/api/time-off/{types,requests,allocations}` `POST/PATCH` `/:id/{approve,refuse,cancel}` `/balance/:empId` `/overview` `/carry-forward` |
| salary | `/api/salary/{structures,rules}` (+`POST/PATCH/DELETE /:id`, `/rules/validate`, `/structures/:id/impact`) |
| payroll | `/api/payruns{,/:id}` `POST` `/compute` `/validate` `/generate-pdfs` `/mark-paid` `/send` `/void` `/:id/{employees,preview,export.csv}` `/api/payruns/zip/:id` `/api/payslips{,/:id}` `/:id/{pdf,preview-pdf,lines,inputs,arrear,compute,print,history,downloads,emails}` `PATCH /:id/lines/:lid` `POST /:id/{inputs,lines,lines/:lid}` `DELETE /:id/{lines/:lid,inputs/:iid}` |
| portal | `/api/portal/{summary,attendance,time-off,time-off/:id(DELETE),payslips,profile}` `POST /api/portal/time-off` |
| settings | `/api/company` (GET/PATCH) · `/api/users{,/:id/roles,/:id/reset-password,/:id/activate,/:id/deactivate}` |
| system | `/api/system/{audit,audit/:type/:id,jobs,tasks,tasks/:id/retry,reclaim}` |

## Shape of a CRUD screen (this is the pattern to copy)

```jsx
<CrudPage
  endpoint="/api/company-or-resource"        // list is GET, create is POST, edit is PATCH, delete is DELETE
  columns={[{key, label, type, render}]}     // type drives sorting/filter/formatting
  filters={[{key, label, kind:'select', options}]}
  schema={zodSchemaFromTheBackendDomain}     // the form and its errors come from the same validators
  canCreate={useCan('employee:write')}       // buttons appear only if the API said so
  rowActions={(row) => [...]}
/>
```

Pages that are not a plain list (employee detail, pay-run wizard, payslip detail, my portal) are hand-written JSX, but still only use `ui/` primitives and `api/` calls.

## Deliberate omissions

* No automated browser test yet — behaviour is proven through the API (`node backend/scripts/smoke.js` drives all 150 endpoints), so the UI layer is thin by design.
* `CrudPage` does not offer a page-size selector for endpoints that return a plain array (departments, schedules, structures, time-off types have no server-side paging).
* The chart on the dashboard is the only bespoke SVG; everything else is tables, chips and forms.
* Dark mode, i18n, and the per-day attendance *edit* grid in the sketch's exact 2-column form were simplified into a dialog + table.
