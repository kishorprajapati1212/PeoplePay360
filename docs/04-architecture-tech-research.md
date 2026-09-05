# 04 — Architecture & technology research (Node/Express/React/PG/Redis)

Everything here is a **decision record**: what to use, why, and the exact shape of the code.

---

## 1. Process topology

```
                 ┌──────────────────────────────────────────────┐
  browser ──────►│ frontend   Vite + React  :5173 (preview)    │
                 │   /api proxy ──► apps/api                    │
                 └───────────────┬──────────────────────────────┘
                                 │ fetch (same origin, relative URLs)
                 ┌───────────────▼──────────────────────────────┐
                 │ apps/api   Express  :4000                    │
                 │  routes → middleware(RBAC,zod,audit) →       │
                 │  services → repositories (pg Pool)           │
                 │  queue producer (BullMQ Queue.add)           │
                 │  SSE: GET /api/payruns/:id/stream            │
                 └──────┬──────────────────────────┬────────────┘
                        │ SQL                       │ BRPOP/LPOP + pubsub
              ┌─────────▼────────┐        ┌─────────▼─────────────────────┐
              │ PostgreSQL       │        │ Redis  (IDX/FB Studio service)│
              │ :5432 or socket  │        │ /tmp/redis/redis.sock (default)│
              └─────────▲────────┘        └─────────▲─────────────────────┘
                        │                            │
                 ┌──────┴────────────────────────────┴────────────────────┐
                 │ apps/worker  node (2 processes)                        │
                 │  • PdfWorker   concurrency 2  → writes /var/uploads    │
                 │  • EmailWorker concurrency 1  → nodemailer pool        │
                 │  • Reconciler  every 60s: task_queue ⇄ queue counts    │
                 │  • Heartbeat:  SETEX worker:alive 0 20                 │
                 └─────────────────────────────────────────────────────────┘
```

Why the worker is a **separate process, not a thread**: PDF/email are CPU/IO-blocking and can take
seconds each; in the same process as Express they stall the API healthcheck and (with a browser
renderer) can OOM the whole app during the demo. Separate process is also the honest architectural
answer the judges are looking for ("transfer to worker").

`node:worker_threads` is a *fallback* only if the environment refuses a second long-running process.

---

## 2. Repository layout (monorepo, npm workspaces — works in Project IDX/Firebase Studio)

```
peoplepay360/
├── .idx/dev.nix                  # ← see 05-project-idx-environment.md
├── package.json                  # npm workspaces: apps/*, backend/src/lib/*
├── .env.example
├── scripts/
│   ├── dev.sh                    # concurrently api+worker+web (used by onStart too)
│   ├── setup-db.sh               # createdb + migrate + seed
│   └── smoke.sh                  # curl the whole happy path (headless demo fallback)
├── db/
│   ├── migrations/001_enums.sql … 021_payslip_documents.sql   # plain ordered .sql
│   ├── migrate.js                # 40-line runner: schema_migrations table, txn per file
│   ├── seeds/001_master.js … 006_history.js                    # idempotent, engine-generated payslips
│   └── views.sql                 # vw_attendance_recon, vw_ytd (optional)
├── backend/src/lib/
│   ├── shared/       # zod schemas, constants, permissions map, money.js, dates.js
│   ├── payroll/      # PURE engine: context builder, rule evaluator, day math, invariants
│   ├── formula/      # tokenizer+parser (or expr-eval-fork wrapper), allowlist, depends_on extractor
│   ├── pdf/          # renderPayslipPdf(payslip) → Buffer; pure-JS default, puppeteer-core optional
│   └── mailer/       # transport factory, template (html+text), sendWithRetry, quota guard
├── apps/api/
│   ├── src/server.js  app.js  config.js  logger.js
│   ├── src/db/{pool.js,tx.js,types.js}
│   ├── src/middleware/{auth.js,rbac.js,validate.js,audit.js,error.js,rateLimit.js,requestId.js}
│   ├── src/routes/{auth,employees,contracts,schedules,attendance,timeoff,salary,payruns,payslips,me,dashboard,admin,stream}.js
│   ├── src/repositories/*.js      # all SQL lives here, no SQL in controllers
│   ├── src/services/{payrun.service,delivery.service,auth.service,…}
│   └── src/queue/{queues.js,producer.js,events.js,reconcile.js}
├── apps/worker/
│   ├── src/index.js  pdf.job.js  email.job.js  reclaim.js  health.js
└── frontend/
    ├── vite.config.js             # proxy /api → 127.0.0.1:4000, ws:false
    └── src/{main.jsx,router.jsx,api/client.js,api/sse.js,auth/,rbac/,components/,pages/}
```

Rule for speed: **`backend/src/lib/payroll` has zero imports from `pg`, `express`, or `fs`.** Then the
engine is testable in milliseconds and the "change formula → recompute" demo can't break for
infrastructure reasons.

`package.json` (root) scripts:

```jsonc
{
  "workspaces": ["apps/*", "backend/src/lib/*"],
  "scripts": {
    "setup":   "npm ci --prefer-offline --no-audit && npm run db:reset",
    "db:migrate": "node db/migrate.js",
    "db:seed":    "node db/seeds/run.js",
    "db:reset":   "node db/migrate.js --reset && node db/seeds/run.js",
    "dev":     "concurrently -k -n api,worker,web -c blue,magenta,green \"npm:dev -w apps/api\" \"npm:dev -w apps/worker\" \"npm:dev -w frontend\"",
    "test":    "vitest run",
    "test:payroll": "vitest run backend/src/lib/payroll",
    "lint":    "eslint . --ext .js,.jsx"
  }
}
```

`dev:api` must set `PORT=4000`, and the web preview must be the **only** exposed port (proxy handles
/api) — see `05`.

---

## 3. Data access

- `pg` (node-postgres) with a `Pool({ max: 10 })`; **parameterized queries only**, never string
  interpolation (a payroll app + SQL injection = disqualified).
- Wrap every mutating multi-table action in `withTransaction` (`BEGIN…COMMIT`, `ROLLBACK` on throw).
  Payrun compute, leave approval, allocation create, mark-paid must all be single transactions.
- **`pg` returns `NUMERIC` as strings.** Explicitly choose: keep them as strings at the repository
  boundary and convert to integer paise via `money.js`. Do **not** globally
  `types.setTypeParser(1700, parseFloat)` — that silently reintroduces float error at the driver
  level. (`DECIMAL`→string is documented `pg` behaviour precisely to avoid precision loss.)
- Add `updated_at` triggers (or set in SQL) so optimistic locking is possible later.
- Optional hard win: `pg_cron` is available as an IDX Postgres extension → could drive nightly
  "upcoming holiday / pending approvals" jobs without node-cron. Nice roadmap bullet, not needed.

`backend/src/lib/shared/money.js` (the only money API allowed in the codebase):

```js
export const toPaise = (v) => {                     // '47500.00' | 47500 | '47500.004' → int
  const s = typeof v === 'string' ? v.trim() : String(v ?? 0);
  const [i, f = ''] = s.replace(/,/g, '').split('.');
  return Math.sign(parseFloat(s) || 0) * (Math.abs(+i) * 100 + Math.round((+('0.' + f)) * 100));
};
export const fromPaise = (p) => (p / 100).toFixed(2);              // string, 2dp, safe to JSON
export const pct   = (basePaise, percent) => Math.round(basePaise * percent / 100);
export const div   = (totalPaise, days) => Math.round(totalPaise / days);   // per-day rate
export const sum   = (arr) => arr.reduce((a, b) => a + b, 0);
export const rupeesInWords = (paise) => { /* Indian numbering: lakh/crore + paise */ };
```

Rule: engine internals are **always paise integers**; only the API boundary formats
(`amount_paise` in DB ↔ `amount: number` (2dp) in JSON, plus `amount_display: "47,500.00"` and
`amount_in_words` for the PDF). Storing paise in `BIGINT` vs `NUMERIC(14,2)` — either is fine;
**pick `NUMERIC(14,2)`** because your schema already uses it and seeds/queries stay readable, but
convert to paise the moment a row enters JS.

---

## 4. Auth: JWT + bcrypt (and where Redis helps)

| Concern | Decision |
| --- | --- |
| Hash | `bcrypt`, cost **12** (≈250 ms @ 2020s CPU; 10 if the sandbox is slow — measure and note it). `bcryptjs` only if the native build fails in Nix — it's ~3× slower, so cost 10 then. |
| Password policy | min 10 chars, reject the 10k most-common list (offline check), zxcvbn optional |
| Access token | HS256 JWT, 15 min, payload `{sub, role, employee_id, jti, tv}` (`tv` = token version) |
| Refresh token | opaque random 32-byte hex, **rotating**, stored hashed in `refresh_tokens(user_id, token_hash, family_id, expires_at, revoked_at, user_agent, ip)`. Reuse of a revoked token in the same family ⇒ revoke the whole family (theft response). 30-day expiry, httpOnly cookie *or* same JSON body (JSON is simpler in a proxied cloud IDE; document the XSS tradeoff and keep `Content-Security-Policy` tight) |
| Revocation | `users.token_version` bump invalidates all access tokens instantly (check `tv`), plus Redis `jwt:blacklist:{jti}` TTL for logout of a single session |
| Secret | `JWT_SECRET` ≥ 32 bytes of base64 — put a startup check that throws if it's missing/short/`"changeme"` |
| RBAC | one permission map + `requirePermission('payroll:payslip:bulk_send')`; `role_permissions` derived from the spec matrix in `user-flows.md`. Row scoping: for `EMPLOYEE`, `ownEmployeeId = req.user.employee_id` is **injected**, and any `employee_id` in body/query is ignored. **This closes the IDOR in your current API design.** |
| Login abuse | Redis fixed-window counter `rl:login:{email|ip}` → 5/15min, plus generic 100/min/IP on `/api` |
| JWT algo | pin `algorithms:['HS256']` in `jwt.verify` (blocks `alg:none`/RS256 confusion) |
| PDF routes | accept `?t=<short-lived token>` **only** because `window.open`/`<a download>` can't set headers — mint with `jwt.sign({psl_id, sub, scope:'pdf', jti}, …, {expiresIn:'60s'})` and log the download. Alternative if you prefer purity: `fetch()` + blob (React does this; then no query tokens at all — **recommended**, keeps auth header and audit intact) |

---

## 5. Async work: Redis with **BullMQ** (not a hand-rolled list)

`schema.md` already has a `task_queue` table and the API spec describes queued PDF→email chaining.
Use BullMQ as the broker and keep `task_queue` as the ledger.

**Why BullMQ over raw `LPUSH`/BRPOP or Redis Streams**

| Need | BullMQ | Redis Streams | DIY list |
| --- | --- | --- | --- |
| automatic retry w/ exponential backoff | `attempts`, `backoff` | manual XAUTOCLAIM | manual |
| concurrency limit per queue | `concurrency` | consumer group | manual |
| rate limiting (SMTP politeness) | `limiter:{max,duration}` | manual | manual |
| parent/child chaining (email after all PDFs) | `FlowProducer` children | manual | manual |
| per-job progress + global events (→SSE) | `job.updateProgress`, `QueueEvents` | manual | pubsub by hand |
| dedupe of double-click | deterministic `jobId` | manual | manual |
| stalled-job recovery | built-in | manual | manual |
| UI for the demo | `bull-board` at `/admin/queues` | ✗ | ✗ |
| survives restart | Redis persistence + `state:'delayed'` | ✓ | ✗ |

For a hackathon the two that matter most are **retries** and **bull-board**: one keeps the demo from
falling over on a flaky SMTP, the other is a screenshot-worthy "real system" artefact.

### 5.1 Connection (the socket gotcha — see `05` for the environment reason)

```js
// backend/src/queue/connection.js
import IORedis from 'ioredis';
const base = process.env.REDIS_URL
  ? { url: process.env.REDIS_URL }
  : process.env.REDIS_PATH
    ? { path: process.env.REDIS_PATH }          // e.g. /tmp/redis/redis.sock  ← IDX default
    : { host: process.env.REDIS_HOST || '127.0.0.1', port: +(process.env.REDIS_PORT || 6379) };

export const mkConn = () => new IORedis({
  ...base,
  maxRetriesPerRequest: null,   // REQUIRED by BullMQ (blocking commands)
  enableReadyCheck: false,
  // keep idle sockets from holding the process open
});
```

### 5.2 Queues, jobs, dedupe

```js
// queue/queues.js
import { Queue } from 'bullmq';
const defaults = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { count: 500, age: 3600 },
  removeOnFail:     { count: 500, age: 86400 },
};
export const pdfQueue = new Queue('ppdf', { connection: mkConn(), defaultJobOptions: defaults });
export const mailQueue = new Queue('pmail', {
  connection: mkConn(),
  defaultJobOptions: { ...defaults, limiter: { max: 1, duration: 1200 } }, // SMTP politeness
});
```

```js
// queue/producer.js — one place that enqueues + writes the ledger, in ONE transaction
export async function queueDelivery(client, payrunId, payslipIds, { resend = false } = {}) {
  for (const id of payslipIds) {
    const dedupeKey = `pdf:${id}:v${payslipVersion}`;           // idempotency anchor
    const { rows } = await client.query(
      `INSERT INTO task_queue(task_type, entity_type, entity_id, dedupe_key, payload, status)
       VALUES ('GENERATE_PDF','PAYSLIP',$1,$2,$3,'PENDING')
       ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`, [id, dedupeKey, { payrunId }]);
    if (!rows.length && !resend) continue;                      // already queued → skip
    await pdfQueue.add('generate-pdf', { payslipId: id, taskQueueId: rows[0]?.id },
                       { jobId: dedupeKey });                  // same jobId = second add is a no-op
  }
}
```

- `jobId = dedupeKey` + `UNIQUE(dedupe_key)` partial index on non-terminal rows ⇒ double-clicking
  **Send Payslips** cannot double-mail. This is the single most important payroll-safety property of
  the async layer.
- Chaining: at the end of the PDF job, `mailQueue.add('send-email', …)` (simple and demo-legible).
  Only reach for `FlowProducer` parent/child if you want "one mail per employee that bundles every
  document of the payrun"; document it as a roadmap item rather than paying its complexity now.
- Progress is computed **from Postgres** (`task_queue` grouped by type/status), not from Redis
  counters → survives Redis flush, and the same query powers both `/status` and the admin table.

### 5.3 Worker (with graceful shutdown + reclaim)

```js
// backend/src/worker/pdf.job.js
export const pdfWorker = new Worker('ppdf', async (job, done) => {
  const { payslipId } = job.data;
  await db.query(`UPDATE task_queue SET status='PROCESSING', processed_at=now() WHERE id=$1`, [job.data.taskQueueId]);
  job.updateProgress(20);
  const slip = await loadPayslipForPdf(payslipId);            // includes lines + trace + ytd
  job.updateProgress(60);
  const buf  = await renderPayslipPdf(slip);                   // pure-JS default; chromium if present
  const path = `uploads/payslips/${slip.period_key}-${slip.employee_code}.pdf`;
  await fs.writeFile(abs(path), buf);
  job.updateProgress(90);
  await db.query(
    `INSERT INTO payslip_documents(payslip_id,kind,storage_path,bytes,sha256,generated_at)
     VALUES ($1,'PAYSLIP',$2,$3,$4,now())
     ON CONFLICT (payslip_id,kind) DO UPDATE SET storage_path=EXCLUDED.storage_path,
       bytes=EXCLUDED.bytes, sha256=EXCLUDED.sha256, generated_at=now()`,
    [payslipId, path, buf.length, sha256(buf)]);
  await db.query(`UPDATE payslips SET pdf_url=$2, pdf_hash=sha256($3), pdf_generated_at=now() WHERE id=$1`, [payslipId, path, buf]);
  await db.query(`UPDATE task_queue SET status='COMPLETED', completed_at=now() WHERE id=$1`, [job.data.taskQueueId]);
  return { path, bytes: buf.length };
}, { connection: mkConn(), concurrency: 2 });

pdfWorker.on('failed', async (job, err) => { /* ledger → FAILED + error_message; final attempt → DLQ flag */ });
process.on('SIGTERM', async () => { await pdfWorker.close(); await redis.quit(); process.exit(0); });
```

Worker hygiene checklist (each item is a real failure mode in a cloud IDE):
- `concurrency: 2` for PDF, **1** for email (SMTP throttles and 421s at you).
- `worker.run('once')`-style guard: never launch the browser per job; keep one browser, one page/job.
- On boot: `reclaimStalled()` — set `task_queue` rows stuck in `PROCESSING` older than 5 min back to
  `PENDING` (killed dev process is the norm in IDX, not the exception).
- Timeouts: `AbortController`/`Promise.race` 30s per PDF, 20s per SMTP send, so a hung job can't
  block the queue forever.
- Memory: with Chromium, cap total pages per browser at ~10 then restart it (leak insurance).
- Health: `GET /api/system/queue` returns `{pdf:{waiting,active,failed}, mail:{...}, worker_alive:boolean}`
  from Redis **plus** `SELECT status,count(*) FROM task_queue GROUP BY 1` — the diff is your demo of
  "we understand at-least-once delivery".

### 5.4 Progress to the UI: SSE first, polling fallback

```js
// backend/src/routes/stream.js
router.get('/payruns/:id/stream', requirePerm('payroll:payrun:read'), async (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const tick = async () => send('progress', await deliveryService.snapshot(req.params.id));
  await tick();
  const iv = setInterval(tick, 1000);
  const hb = setInterval(() => res.write(': hb\n\n'), 15000);   // defeats idle-proxy disconnects
  req.on('close', () => { clearInterval(iv); clearInterval(hb); });
});
```

SSE over WebSocket here because: 1-directional progress, no extra dep on the client, works through
the IDE preview proxy, and auto-reconnects. Keep `GET /payruns/:id/status` too — it's what your
`api.md` promises, it's what curl in the smoke test uses, and it's the fallback when a proxy eats
streaming responses.

---

## 6. PDF generation: pick pure-JS first

| Option | Deps | Speed | Fidelity | Risk in a cloud IDE |
| --- | --- | --- | --- | --- |
| **pdfkit** (pure JS) | no system binary | ~100 ms | you draw the layout (no CSS) | **low** ← default |
| `@react-pdf/renderer` | no system binary, JSX | ~300 ms | flexbox-ish, no CSS grid | low; needs font registration for `₹` |
| `puppeteer-core` + system chromium | browser binary + shared libs (`libnss3`, `libgbm1`…) + fonts | 2–5 s incl. launch | real CSS/print | **medium/high** on Nix: no `apt`, must add `pkgs.chromium`, `PUPPETEER_EXECUTABLE_PATH`, `--no-sandbox`; ~100 MB extra |
| wkhtmltopdf | external binary | fast | legacy WebKit CSS | Nix has it, but it's old; skip |
| Client-side print (`window.print()`) | none | instant | CSS `@media print` | fine as a *secondary* "Print" button; can't be emailed |

Decision (also what `03` §8 layout implies — a fixed table, not a design showcase):

1. `backend/src/lib/pdf` renders with **pdfkit** using a layout function over the payslip object.
   Deterministic, tiny, no browser, prints identically in the demo and in the mail.
2. Ship `DejaVuSans.ttf` (+ `DejaVuSans-Bold.ttf`) in the package so `₹` renders regardless of nix fonts.
3. Add an env-flagged upgrade path: `PDF_RENDERER=puppeteer` + `PUPPETEER_EXECUTABLE_PATH` if you
   have time and the binary resolves; `renderPayslipPdf` probes once at boot and
   **auto-falls-back to pdfkit** if launch fails (log a warning). Never let the queue die on Chromium.
4. Also expose `GET /api/payslips/:id/html` — the same data as a print-ready HTML page for the
   browser's own "Save as PDF" (useful when a judge's laptop blocks downloads and as a visual editor).

Storage: filesystem `UPLOAD_DIR=/home/user/peoplepay360/storage/uploads/payslips`, filename
`{payrun_period}-{employee_code}-v{n}.pdf`; DB keeps `storage_path`, `sha256`, `bytes`,
`version`, `generated_at`. Keep it on disk (not bytea) — simple, and the ZIP/self-serve features get
streaming for free. Note in the writeup: "in production this is S3/GCS with the DB holding the key".

---

## 7. Bulk email

| Item | Decision |
| --- | --- |
| Transport | `nodemailer.createTransport({ pool: true, maxConnections: 1, ...})`; provider chosen by env: `smtp.ethereal.email` (dev/demo, has a public inbox URL you can show on stage), Mailtrap, or Gmail SMTP |
| Gmail reality | "Less secure apps" has been disabled since 2022-05-30 → must use **App Password** (2FA on) or **OAuth2**. Personal accounts: **500 recipients per rolling 24 h**, Workspace **2,000** — and each recipient counts, so 1 mail with 2 Cc = 2. Exceeding it returns `550 5.4.5 Daily user sending limit exceeded` → we must **treat quota as a permanent-ish failure and stop the batch**, not retry-slam it. |
| Quota guard | Redis counter `mail:sent:{yyyy-mm-dd}` + `MAIL_DAILY_LIMIT`; on exceed → pause queue (`queue.pause()`) and surface "quota exhausted, X sent, Y pending" in the UI |
| Addressing | **one message per employee**, `To:` only them, never a shared Bcc list (privacy: payslips are PII) |
| Attachment | from disk, `filename: "Payslip_Feb2026_EMP001.pdf"`, `contentType: application/pdf` |
| Idempotency | `email_deliveries(payslip_id, document_version, to, message_id, status, attempts, error, sent_at)` with `UNIQUE(payslip_id, document_version)`; skip rows already `SENT` unless `resend=true` (which creates a new row with `attempt_of` pointing at the first — audit-visible resend) |
| Failure policy | classify: DNS/socket/421/450 → retryable; 550/553/quota/auth → non-retryable (mark `BOUNCED`, warn HR "employee email invalid"); keep the *last* `error_message` on the ledger for the UI |
| Template | text + HTML, `{{first_name}}`, period, net amount, "not shared with anyone else", a link to the portal for the same PDF (drives the self-serve feature), masked a/c |
| Delivered-ness | print the Ethereal preview URL in the worker log → in the demo, open it in a browser tab and **show the real email with the real attachment**. Huge demo win, zero cost |
| Retry failed | `POST /payruns/:id/emails/retry-failed` (manager only) → re-enqueues only FAILED/BOUNCED rows |

---

## 8. Frontend (React)

- **Vite + React Router 6**, `createBrowserRouter` with a `roleLoader` guard per route;
  `AppShell` nav built from the permission map (so RBAC is *visible* — judges can log in as each role
  and watch the menu shrink).
- Server state: **TanStack Query** (`queryKey` per resource+filters, `staleTime` 30s,
  `useMutation` + `invalidateQueries` everywhere). Client state: tiny Zustand store for auth +
  current filters. Avoid Redux — no time budget.
- Forms: `react-hook-form` + `@hookform/resolvers/zod` with **the same zod schemas the API uses**
  (put them in `backend/src/lib/shared` and import from both sides — one source of truth is a great
  "engineering quality" talking point).
- Tables: plain `<table>` + a `DataTable` component (sort, page, filter chips) — don't buy AG Grid.
- Charts: `recharts` (Bar for salary-by-department, Line for monthly trend, Donut for attendance mix).
- Progress: `usePayrunProgress(id)` = SSE hook with polling fallback; the wizard's Step 2 eligibility
  table is server-filtered, not client-filtered (a real design difference: "eligible" is a business rule).
- Money/date rendering in one module (`fmt.inr(4750000)` → `₹47,500.00`, `fmt.period`) so Indian
  digit grouping (lakh separators) is consistent — `Intl.NumberFormat('en-IN')` does it natively.
- No external CDN assets (the IDE preview/offline view breaks) — inline critical CSS, self-host fonts,
  ship the company logo as an inline SVG/data URI.

---

## 9. Reliability & security checklist to satisfy during build

- `helmet`, `cors({origin: env.WEB_ORIGIN, credentials:true})`, body limit `1mb`, global async error
  handler that never leaks SQL to the client, `pino` + request id in `X-Request-Id` (echo + logs).
- zod on every route (`.strict()`), so unknown fields 400 instead of silently ignoring.
- Static upload directory **not** publicly served (auth-gated stream route only) — see `07` §2.
- Audit middleware: one row per mutating request (`entity_type/id/action/old/new/actor/ip/ua`),
  implemented as a helper called from services (not a blanket middleware) so `old_values` is real.
- Idempotency keys on `POST /payruns` (+ `/send`, `/mark-paid`): header `Idempotency-Key` stored in
  Redis 24h → duplicate click returns the original response. Payroll apps must be click-safe.
- `GET /healthz` (api) and `GET /healthz` (worker: redis+pg ping, queue depth, uptime) — also used by
  the demo smoke script to prove the pipeline is alive before a judge asks.
- Graceful boot order: migrate → seed (if empty) → start api → start worker. And a `--reset` for the
  "run seed on demo day" requirement in the PDF (Admin can reseed = explicitly allowed by your flows doc).

## 10. Testing strategy (small, but real)

| Layer | What | Tool |
| --- | --- | --- |
| Unit (highest value) | `backend/src/lib/payroll`: day math (Feb 2026 = 20 days, leap Feb 2024 = 21 Mon–Fri days, 6-day = 24), proration, rule sequencing errors, negative net, H1+H2 reconcile, YTD, `round2` linearity | `vitest` (fast, zero config with `--run`) |
| Unit | `backend/src/lib/formula`: rejects `constructor`, `this`, `process`, `require`, `=>`, `;`; accepts `basic * 0.40` etc. | vitest |
| Contract | repositories against a real throwaway schema (`peoplepay360_test`) via `createdb` in CI-less env | `node --test`/vitest |
| API | supertest happy paths + the whole RBAC matrix (assert 403 per cell) | supertest |
| E2E smoke | `scripts/smoke.sh`: login as each role → create employee → contract → compute → validate → mark paid → send → poll status → `curl -o x.pdf` and `file x.pdf` says PDF | bash |
| Golden PDF | snapshot of extracted text of one payslip (avoid pixel diffs) | `pdf-parse` + expect |

Minimum bar before demo: engine tests green, RBAC matrix test green, `smoke.sh` green.
