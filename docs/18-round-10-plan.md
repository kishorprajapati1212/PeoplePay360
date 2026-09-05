# 18 · Round 10 — mail from two boxes, and which variable Docker reads

The ask, in the words it arrived in:

> i think we can use nodemailer which take only the email password and email name only so can you made like that
> becuse i does not want to add so much env file there and if i start as docker then which variable i have to change

Two questions, then: **make the address and the password the whole configuration**, and **say which variable to
change when it runs in containers**. The second one has a one-line answer that nobody had written down before: the
variables `docker-compose.yml` sets are the only ones you cannot change from `backend/.env`.

---

## A · "only the email password and email name"

| What the code said before | File |
|---|---|
| `EMAIL_NAME` + `EMAIL_PASSWORD` were already enough — but only for one provider, matched by a regex on the address: `if (/gmail\.com$/i.test(name)) driver = 'gmail'`. | `backend/src/lib/mailer/index.js` (before this round) |
| Any other address with no host fell straight back to the preview driver, with a note telling you to add `SMTP_HOST`. So Outlook, Zoho, Yahoo, iCloud — all of which publish one server — needed three boxes filled by hand. | same |
| The settings screen led with *SMTP host*, *SMTP port*, *Implicit TLS*, then the account and the password — four fields for a Gmail user who needs two, and the hints said to fill all four. | `frontend/src/pages/settings/CompanyPage.jsx` |
| The test mail quoted `process.env.SMTP_HOST` in its own body, which is empty whenever the credentials came from the database row — the mail said "host: not set" while it had just dialed `smtp.gmail.com`. | `backend/src/services/mail.service.js` |
| The API never required the host: inside `companyBody`, `smtp_host` / `smtp_port` / `smtp_secure` / `smtp_user` / `smtp_password` are optional text or numbers, and `withoutSecret` strips the password from every read. So this round was inference and presentation, not validation. | `backend/src/validators/payroll.schema.js:48,64-65`, `backend/src/repositories/company.repo.js:19` |

**Done**

1. `backend/src/lib/mailer/providers.js` is the new table: Google, Microsoft, Zoho, Yahoo, Apple, Fastmail, QQ Mail —
   each with the domains it answers for, its host, port, TLS mode, whether it needs an app-specific password, and the
   sentence that explains that password. `providerFor(address)` is the only matcher.
2. `resolveDriver` fills *only what is blank*: `host → typedHost || provider.host`, `port → typed || provider || the
   TLS-appropriate default`, `secure → typed || provider`. A host you typed wins box for box, so a relay behind a
   company domain is still expressible; and an address we do not know is said out loud ("Google, Microsoft, Zoho,
   Yahoo, Apple, Fastmail and QQ Mail are recognised from the address alone; acme-biz.example is not one of them")
   instead of quietly mailing nothing.
3. `runtime.js` no longer needs its own copy of that logic: the row contributes the address, the table contributes
   the server, in one place. Its one change is that an unticked TLS box no longer stomps the provider's TLS mode
   when no host was typed — writing `false` there used to turn Gmail's 465 into STARTTLS-by-accident.
4. `backend/.env` and `.env.example`: `EMAIL_NAME` + `EMAIL_PASSWORD` are the two live lines; host, port, TLS,
   `MAIL_DRIVER` and `MAIL_FROM` are commented out and labelled as "only for a host you typed". A committed
   `SMTP_PORT=587` used to override the address, which is exactly the kind of quiet interference to leave out.
5. The settings panel asks for two boxes and says what the second one means: the account field, the password field,
   then the three advanced ones underneath. `MailServerHint` shows, while you type, `smtp.gmail.com:465 ·
   implicit TLS — read off the address, so the two boxes above are the whole job, and it wants an App Password`.
   The list it matches against comes from `GET /api/company/mail` as `providers`, so the frontend holds no rules;
   adding a provider changes the screen by itself.
6. `GET /api/company/mail` now answers `server`, `inferred`, `needs_app_password`, `provider_note` and `providers`;
   `POST /company/mail/check` returns `server`/`inferred` too, so the green line names the host it dialed, and the
   test mail's own body does the same instead of reading `process.env`.

## B · "if i start as docker then which variable i have to change"

`docker-compose.yml` mounts `backend/.env` read-only into `api`, `worker` and `migrate`, and the loader in
`backend/src/config.js` sets a key **only when `process.env` does not already have it** — so the container's
`environment:` block wins.

| Want | Change | Restart |
|---|---|---|
| real mail | Settings → Company → two boxes, as admin | nothing — the row is cached 15 s and a save invalidates it at once |
| mail without opening the product | `EMAIL_NAME`, `EMAIL_PASSWORD` in `backend/.env` | `docker compose restart api worker` |
| links reachable from another machine | `PUBLIC_APP_URL=http://<ip>:5173` in `backend/.env` (compose does not set it) | `docker compose restart api worker` |
| bigger/smaller demo data | `SEED_EMPLOYEES`, `SEED_PAYRUN_MONTHS`, `DEMO_PASSWORD` in `backend/.env`, then `docker compose run --rm migrate node db/seed/seed.js --force` | — |
| `DATABASE_URL`, `REDIS_HOST`, `PORT`, `HOST`, `NODE_ENV`, `WEB_ORIGIN`, `CORS_ORIGINS`, `JWT_SECRET`, `WORKER_PORT` | `docker-compose.yml` — compose sets these, so the same key in `.env` is ignored | `docker compose up -d` |

That table is in README §1 as well, and the compose file's header now says the short version: no variable in
`docker-compose.yml` needs touching to send mail.

## D · The follow-up that made this round: `getaddrinfo ENOTFOUND smtp.reply.example`

Reported after A and B had shipped: *Check connection* still failed, and *every* address and password tried gave
the same answer. The message itself was the evidence — `ENOTFOUND` is DNS, not authentication, so no password could
have fixed it. Something was dialing a host that does not exist.

| What was happening | Where |
|---|---|
| `resolveDriver` ranked **any** saved host over the address (`what you typed wins`), and one host box in that form had been filled with a placeholder-looking value, so the app dialed `smtp.reply.example:465` and Google was never asked. | `backend/src/lib/mailer/index.js` |
| The box itself invited it: the field's placeholder was `smtp.relay.example`, and the commented example in `backend/.env` was the same shape — a hostname that looks like a value to keep. | `frontend/src/pages/settings/CompanyPage.jsx`, `backend/.env(.example)` |
| The advice in the error was about ports and firewalls, which is a different fault; nothing said "the host you saved is not a server". | `refusalHint` in `mail.service.js` |

**Done**

1. `isPlaceholderHost()` in `providers.js` recognises the reserved shapes (`.example`, `.example.com|net|org`,
   `.test`, `.invalid`, and hosts containing `your-domain`, `your-company`, `changeme`, `placeholder`, `fixme`) and
   **nothing else**. A real relay called `smtp.acme.com`, `smtp.zoho.com` or `localhost:1025` is taken at its word —
   the unit test asserts both directions, because over-matching here would break somebody's working setup.
2. When the saved host is one of those and the address *is* on the provider list, the host is ignored — **and so are
   the port and TLS mode typed with it**, because they belonged to that host. The plan then says
   `gmail · smtp.gmail.com:465 · implicit TLS`, and its `note` names the box, in words, so nobody hunts for a
   password problem that isn't there.
3. `mailStatus` returns `conflict`: `{ stored_host, ignored, brand, wanted_server }` when a placeholder is being
   ignored, or `{ stored_host, wanted_host, … }` when a *real* host disagrees with the address (then the host wins,
   and the panel says that is what will be dialed).
4. The panel turns `conflict` into one button — **Clear the host box and use smtp.gmail.com:465 · implicit TLS** —
   which sends `smtp_host: ''`, `smtp_port: null`, `smtp_secure: false` in a single `PATCH /company` (so the port
   validator grew `.nullable()`), invalidates the mail cache and reloads the panel. A role that cannot write company
   settings gets the same notice with "an Admin can empty that box" instead of a button it would fail to press.
5. The field's placeholder is now a sentence, not a hostname, and `.env` says explicitly not to put an example
   value in `SMTP_HOST`. The live hint says a typed host wins "unless it is an example value, which resolves to
   nothing".
6. Tests: a unit case for the rule in both directions plus the exact saved-row state from this report, and a probe
   case that finds the notice, presses the button and asserts the three keys cleared together.

## C · What was run

| Check | Result |
|---|---|
| `node scripts/test-unit.js` | 72 passed — 5 new ones: provider matching (case, trailing dot, look-alike domain, no `@`), the driver table for Gmail/Microsoft/unknown/forced, "what you typed beats the table", the saved-row path getting the same treatment as the environment, and "nothing leaves the machine unless both boxes are filled" |
| `node scripts/ui-probe/run.mjs` | 37 clean — the settings case now asserts the panel names `smtp.gmail.com:465` and says *picked from the address*; a new case asserts that an unknown domain is told which box is missing and that no server is claimed when there is none |
| `npm run build`, `npm run check`, `routes-list`, `test-docs`, `check-contrast.py` | build ok · imports ok · TOTAL 163 routes · 5/5 · 0 of 1150 colour pairs under the WCAG floor |
| the mail path, actually run | `createMailer({}).send(...)` wrote a `.eml` and reported the new note ✓. Then `createMailer({ EMAIL_NAME: 'payroll@gmail.com', EMAIL_PASSWORD: <wrong on purpose>' }).verify()` **reached smtp.gmail.com on 465 over implicit TLS** and came back `Invalid login: 535-5.7.8 Username and Password not accepted` — so the host, port and TLS mode the address implies are proven against Google itself, and the refusal is the exact string `refusalHint` is now unit-tested with. What is *not* proven here is a delivered message: that needs a real App Password, which stays on your machine. Press *Send a test mail to my address* for the last step. |
