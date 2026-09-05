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

* The API puts *all* raw SQL in `src/repositories/`; nothing above it opens a cursor. The front end puts *all* HTTP in `src/api/` — `client.js` (the only `fetch` in the app) and `endpoints.js` (every call, grouped the way the backend groups its routes) — so a page never builds a URL by hand.
* `src/utils` holds the three things screens keep needing (formatters, the query-string builder, the blob download) and `src/theme.js` + `src/theme.css` hold the light/dark palettes.
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

## Endpoints consumed (generated from the live router)

Every row below is what the router actually registers — `node backend/scripts/routes-list.js` prints the same list
(150 of them), and `/api` is the mount prefix. The front end keeps its half of that contract in
`frontend/src/api/endpoints.js`.

| area | endpoints |
|---|---|
| **attendance** (9) | `DELETE attendance/:id` `GET attendance` `GET attendance/exceptions` `GET attendance/export.csv` `PATCH attendance/:id` `POST attendance` `POST attendance/:id/overtime` `POST attendance/clock` `POST attendance/import` |
| **company** (5) | `DELETE company/pt-slabs/:id` `GET company` `GET company/pt-slabs` `PATCH company` `POST company/pt-slabs` |
| **org** (15) | `DELETE org/departments/:id` `DELETE org/holidays/:id` `DELETE org/working-schedules/:id` `GET org/departments` `GET org/holiday-templates` `GET org/holidays` `GET org/working-schedules` `GET org/working-schedules/:id` `PATCH org/departments/:id` `PATCH org/holidays/:id` `PATCH org/working-schedules/:id` `POST org/departments` `POST org/holidays` `POST org/holidays/generate` `POST org/working-schedules` |
| **pay runs** (17) | `DELETE payruns/:id` `GET payruns` `GET payruns/:id` `GET payruns/:id/emails` `GET payruns/:id/export.csv` `GET payruns/:id/tasks` `GET payruns/:id/warnings` `GET payruns/employees` `GET payruns/zip/:payrunId` `POST payruns` `POST payruns/:id/compute` `POST payruns/:id/generate-pdfs` `POST payruns/:id/mark-paid` `POST payruns/:id/send` `POST payruns/:id/validate` `POST payruns/:id/void` `POST payruns/preview` |
| **salary** (16) | `DELETE salary/pt-slabs/:id` `DELETE salary/rules/:id` `DELETE salary/structures/:id` `GET salary/pt-slabs` `GET salary/rules` `GET salary/rules/:id` `GET salary/structures` `GET salary/structures/:id` `GET salary/structures/:id/impact` `PATCH salary/rules/:id` `PATCH salary/structures/:id` `POST salary/preview` `POST salary/pt-slabs` `POST salary/rules` `POST salary/rules/validate` `POST salary/structures` |
| **time off** (20) | `DELETE time-off/requests/:id` `DELETE time-off/types/:id` `GET time-off/allocations` `GET time-off/balances/:employeeId` `GET time-off/overview` `GET time-off/requests` `GET time-off/requests/:id` `GET time-off/types` `GET time-off/types/:id` `PATCH time-off/allocations/:id` `PATCH time-off/requests/:id` `PATCH time-off/types/:id` `POST time-off/allocations` `POST time-off/carry-forward` `POST time-off/count-days` `POST time-off/requests` `POST time-off/requests/:id/approve` `POST time-off/requests/:id/cancel` `POST time-off/requests/:id/refuse` `POST time-off/types` |
| **auth + access** (7) | `GET auth/access-matrix` `GET auth/me` `GET auth/token-for-payslip/:id` `POST auth/change-password` `POST auth/login` `POST auth/logout` `POST auth/refresh` |
| **contracts** (8) | `GET contracts` `GET contracts/:id` `GET contracts/employee/:employeeId` `GET contracts/expiring` `PATCH contracts/:id` `POST contracts` `POST contracts/:id/renew` `POST contracts/:id/terminate` |
| **dashboard** (1) | `GET dashboard` |
| **employees** (12) | `GET employees` `GET employees/:id` `GET employees/:id/attendance` `GET employees/:id/contracts` `GET employees/:id/payslips` `GET employees/:id/summary` `GET employees/:id/time-off` `GET employees/me` `PATCH employees/:id` `POST employees` `POST employees/:id/terminate` `POST employees/import` |
| **meta** (1) | `GET meta` |
| **payslips** (11) | `GET payslips` `GET payslips/:id` `GET payslips/:id/downloads` `GET payslips/:id/history` `GET payslips/:id/pdf` `GET payslips/:id/preview-pdf` `PATCH payslips/:id/inputs` `PATCH payslips/:id/lines` `POST payslips/:id/arrear` `POST payslips/:id/compute` `POST payslips/:id/print` |
| **employee portal** (10) | `GET portal/attendance` `GET portal/balances` `GET portal/calendar` `GET portal/contracts` `GET portal/payslips` `GET portal/payslips/:id/pdf` `GET portal/summary` `GET portal/time-off` `POST portal/time-off` `POST portal/time-off/:id/cancel` |
| **reports / exports** (4) | `GET reports/attendance.csv` `GET reports/payroll-summary.csv` `GET reports/payslips.zip` `GET reports/salary-register.csv` |
| **system / queues** (6) | `GET system/audit` `GET system/audit/:type/:id` `GET system/jobs` `GET system/tasks` `POST system/reclaim` `POST system/tasks/:id/retry` |
| **users** (8) | `GET users` `GET users/:id` `PATCH users/:id` `POST users` `POST users/:id/activate` `POST users/:id/deactivate` `POST users/:id/reset-password` `POST users/:id/roles` |

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

## Two audiences, one screen (and the employee's PDF)

`/attendance` and `/payslips` are deliberately shared. The guard in `AppShell` accepts a **list** of permissions
(`PAGE_PERMISSIONS['/attendance'] = ['attendance:read', 'attendance:read_own']`), and the screen then asks which
one it got: with `attendance:read` it lists everyone and offers the correction dialog, with only `attendance:read_own`
it loads `/api/portal/attendance` (already limited to that person by the API) and hides every write button. No
"employee mode" flag exists in the frontend — it is derived, so a role change in the permissions file moves the UI.

The payslip PDF is the same story: `POST /api/auth/token-for-payslip/:id` mints a 5-minute `?t=` link, and the
controller picks the **path** from the caller's permissions — `/api/payslips/:id/pdf` for payroll and admin,
`/api/portal/payslips/:id/pdf` for the employee. Both then stream the stored file from `backend/storage/pdfs/`,
and every download is written to `payslip_downloads` so HR can see who fetched what.

## Themes

`html.dark` (default, the mockup's navy) and `html.light` are two variable blocks in `src/theme.css`;
`tailwind.config.js` points every colour utility at those variables, so no page, table or chip mentions the theme.
`src/theme.js` owns the toggle (localStorage key `pp360.theme`), and `index.html` re-applies the saved choice before
the first paint so a reload never flashes the wrong one. The dashboard charts are the only exception — Recharts takes
literal colours, so they read `useTheme().palette`.

## Rendering and payload contracts (what was fixed, and why it stays fixed)

**A dialog is never inside the page that opened it.** `components/ui/Modal.jsx` renders through
`createPortal(…, document.body)` at `z-[80]`. Before that it lived in the DOM subtree of the opener, and the sticky
top bar (`z-20`) had created a stacking context — so a dialog opened from there sat *under* the page it came from.
Anything that must cover the app belongs to `body`, and `AppShell` keeps a lower `z-30` drawer / `z-20` scrim pair.

**A bad panel cannot white-screen a screen.** `components/ui/ErrorBoundary.jsx` wraps `<Outlet/>` and is keyed by
`location.pathname`, so a throw in one panel prints a "This panel could not be drawn" card with *Try again* /
*Reload*, and navigating clears it.

**List envelopes are normalised once, not per page.** The API answers in three shapes — a bare array,
`{ rows }`, or `{ rows, total, page }` — and `pg` hands back aggregates as strings. `utils/query.js` exports
`toRows(x)` (array · `x.rows` · `x.items` · `x.data` · `[]`) and `totalOf(x, fallback)`; every page maps through
them and `DataTable` calls `toRows` on its `rows` prop, so `(x || []).map is not a function` cannot come back.

**Screens send what the route validates.** Two buttons used to POST an empty body and always 400: Users → *Reset pw*
(`passwordBody` needs `password`) and Contracts → *End* (`terminateBody` needs `date_of_exit`). Both now open a
small dialog that collects the field, and the client-side minimum (10 characters) matches the service, so a
disabled button — not a server error — is what tells you a password is too short.

**There is no self-service password screen.** The problem statement has no such flow, so the change-password dialog
and its `api.changePassword` helper were removed; `POST /api/auth/change-password` still exists for an admin with a
token, and login has never gated on `must_change_password`, so nobody can be locked out by it.
