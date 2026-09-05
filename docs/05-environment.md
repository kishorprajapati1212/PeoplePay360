# 05 — environment research (kept for the record: Docker is what we use)

> **Update after this doc was written:** the project runs on **Docker** — `docker-compose.yml` at the repo
> root brings up Postgres 16, Redis 7, the API, the worker and Vite, with the schema migrated and the demo
> data seeded. `.idx/dev.nix` was never added. The Nix/IDX findings below are still worth reading because
> they explain *why* certain choices were made (e.g. the Redis unix-socket rule, the missing `pg_trgm`
> extension, no Chromium in the image), but nothing here is binding for setup any more.

**Read this before you write a single line of connection config.** The IDE the user is on
(Project IDX) is now **Firebase Studio**, and its environment model (Nix + `dev.nix`) changes several
"obvious" choices a local `apt`-based setup would let you make.

## 0. ⚠️ The one thing you must decide first

Google's Firebase Studio docs currently carry this banner (fetched 2026-09-05):

> "**Firebase Studio is sunsetting on March 22, 2027.** As of **June 22, 2026, new workspace creation
> and user signup are disabled.** You can continue to work in and migrate your existing workspaces to
> Google AI Studio or Google Antigravity."

Consequences for you:

- If you **already have** a working IDX/Firebase Studio workspace → keep using it; everything below applies.
- If you **cannot create a new workspace** (likely today, since signup is disabled) you need a
  fallback. Ranked by how little rework it causes:
  1. **GitHub Codespaces** — same "cloud VS Code + devcontainer" idea; `docker compose up` works,
     Postgres/Redis as containers, preview ports forwarded the same way. Zero app changes.
  2. **Local VS Code + Dev Containers** (`docker-compose.yml` for pg+redis) — most reliable for a
     demo (no network flakiness), and the `devcontainer.json` is a nice repo artefact.
  3. **Google AI Studio** (Agents mode) / **Antigravity** — Google's designated migration path.
  4. **Split it**: app in the cloud IDE, Postgres on Neon/Supabase free tier, Redis on Upstash free
     tier → *this actually makes the demo more robust* (nothing dies when the workspace rebuilds), at
     the cost of internet dependency. Keep `DATABASE_URL`/`REDIS_URL` env-driven so switching is free.

**Design rule that makes all four identical:** every external dependency is reached via env vars
(`DATABASE_URL`, `REDIS_URL` **or** `REDIS_PATH`, `PORT`, `UPLOAD_DIR`, `SMTP_*`) and nothing in code
hardcodes a socket path. Then `.idx/dev.nix` is just one of several ways to provide them.

## 1. What the environment actually is

- Cloud Linux VM per workspace, VS Code (Code OSS) in the browser, files persist in the workspace
  directory (`/home/user/project` typically). Root home dir is where you install things.
- **Nix manages system packages** via `.idx/dev.nix` — the documented, reproducible way to add
  binaries. `apt-get` is *not* the documented path; anything you apt-install can vanish when the
  environment rebuilds, and I could not verify from the official docs whether `apt` is even present
  on the current image. Treat `packages = [ pkgs.… ]` in `dev.nix` as the only reliable installer.
- Built-in `services` (official, from the `dev.nix` reference): `docker`, `mongodb`, `mysql`,
  **`postgres`**, **`redis`**, `pubsub`, `spanner`. So Postgres **and** Redis are first-class — no
  Dockerfile needed for your two infra pieces.
- `idx.previews.previews.<name>` = `{ command, cwd, env, manager, activity }` where
  **`manager` is one of `"web" | "flutter" | "android" | "gradle"`** (there is no `"process"` manager
  in the current schema). `command` receives `$PORT`. So: web apps go in `previews`, background
  processes go in `idx.workspace.onStart`.
- `idx.workspace.onCreate` runs once at workspace creation; `onStart` runs on **every** workspace
  open — that's where you put `npm run dev`-ish watchers, migrations, and the worker.
- `env` in `dev.nix` is exported to all shells **and** the preview servers.
- Workspace preview: only ports registered as previews are reachable from the browser UI, so the app
  must be single-origin from the browser's point of view (see §5).

## 2. Recommended `.idx/dev.nix` (drop-in)

```nix
{ pkgs, ... }: {
  channel = "stable-24.11";

  packages = [
    pkgs.nodejs_22            # matches engines; also fine: nodejs_20
    pkgs.openssl              # node + bcrypt/pg native builds sometimes need headers/CLI
    pkgs.git
    pkgs.procps               # pgrep/pkill used by scripts/dev.sh
    pkgs.lsof                 # "is 4000 listening?" during debugging
    # --- ONLY if you go down the Chromium/Puppeteer path (§6) ---
    # pkgs.chromium
    # pkgs.fontconfig
    # pkgs.dejavavu_fonts
  ];

  env = {
    NODE_ENV            = "development";
    DATABASE_URL        = "postgresql://postgres@localhost:5432/peoplepay360";
    REDIS_PATH          = "/tmp/redis/redis.sock";   # ← IDX default (TCP off), see §4
    PORT                = "4000";
    UPLOAD_DIR          = "/home/user/project/peoplepay360/storage/uploads";
    PDF_RENDERER        = "pdfkit";                    # "puppeteer" if chromium present
    PUPPETEER_SKIP_DOWNLOAD = "1";                     # never try to fetch Chromium at install
  };

  services = {
    postgres = { enable = true; enableTcp = true; extensions = [ "pg_cron" ]; };  # 24.11 default: PG16
    redis    = { enable = true; port = 6379; };   # port → real TCP listener (also keep the socket)
  };

  idx = {
    extensions = [ "dbaeumer.vscode-eslint" "esbenp.prettier-vscode" "rangav.vscode-thunder-client" ];

    workspace = {
      onCreate = {
        npm-install  = "cd /home/user/project/peoplepay360 && npm install --no-audit --prefer-offline";
        create-db    = "psql -U postgres -h localhost -c 'CREATE DATABASE peoplepay360' || true";
        migrate-seed = "cd /home/user/project/peoplepay360 && npm run db:reset";
        "default.openFiles" = [ "docs/00-INDEX.md" "README.md" ];
      };
      onStart = {
        api    = "cd /home/user/project/peoplepay360 && npm run dev -w apps/api";
        worker = "cd /home/user/project/peoplepay360 && npm run dev -w apps/worker";
      };
    };

    previews = {
      enable = true;
      previews = {
        web = {
          command = [ "npm" "run" "dev" "-w" "frontend" "--" "--port" "$PORT" "--host" "0.0.0.0" ];
          manager = "web";
          cwd     = "peoplepay360";
          env = { VITE_API_TARGET = "http://127.0.0.1:4000"; };
        };
      };
    };
  };
}
```

Notes on the above:

- `extensions = ["pg_cron"]` is optional — the supported-extension list in the `dev.nix` reference
  includes `pg_cron`, `pgvector`, `postgis`, `plv8`, `pgtap`, `pgaudit`, `temporal_tables`… but
  **not** `pg_trgm`. So: don't plan on trigram search. Use `ILIKE` (fine for ≤5k rows) or a
  `tsvector` GIN index (built-in, no extension). `pgaudit`/`pgtap` are interesting if you want to
  flex (DB-level auditing / in-DB tests) — mention them in the writeup, don't depend on them.
- `default.openFiles` in `onCreate` is valid per the reference (the type is
  `path or string or ({ openFiles = [ string ]; })`).
- If `enableTcp` were left off, Postgres is socket-only: use `host=/var/run/postgresql` in the
  connection string.

## 3. Postgres in this environment — practical facts

- With `services.postgres.enable = true` the workspace starts a cluster for you; the superuser is
  `postgres`, and it's typically trust-auth locally (no password) — **do not rely on that for prod**,
  and do not commit a password in `.env`.
- Verify in a terminal (I can't run it for you): `psql -U postgres -h localhost -l` should list
  databases; then `psql -U postgres -h localhost -c "CREATE DATABASE peoplepay360"`.
- `pg_isready` / `pg_ctl status` come with `pkgs.postgresql` for debugging.
- **Data persistence caveat:** the service's data dir lives outside your project tree (usually
  `/var/lib/postgresql`-style). On a workspace *rebuild* (e.g. after you edit `dev.nix`), that data
  may be gone. So: (a) keep every schema change in `db/migrations/*.sql`, never only in a psql
  session, and (b) `npm run db:reset` must be a one-command, idempotent path to a demo-ready database.
  Treat that as a hard requirement of the project, not a convenience — you will rebuild the env.
- If the service ever misbehaves, the documented-in-community fallback is to manage your own cluster:
  `packages = [ pkgs.postgresql_16 ]`, `mkdir -p ~/pgdata && initdb --pgdata=~/pgdata -U postgres`,
  `pg_ctl -D ~/pgdata -o "-k /tmp -p 5432" start`, and pre-create the socket dir
  (`mkdir -p /run/postgresql` is the known fix for `FATAL: could not create lock file
  "/run/postgresql/.s.PGSQL.5432.lock"`). Inside the workspace data then lives in your home dir, which
  is a plus. Prefer `services.postgres` first; use this only as escape hatch.
- UUIDs: `gen_random_uuid()` is built-in for PG ≥ 13, so no `pgcrypto` needed.
- `ENUM` types: adding a value needs `ALTER TYPE … ADD VALUE` — and on PG < 14 that cannot run inside a
  transaction. Your migration runner must therefore run each `.sql` file in its own transaction and
  allow `-- no-transaction` headers. Cheap to design in now; a classic mid-hackathon "why is migrate
  failing" fire.

## 4. Redis in this environment — the gotcha that costs an hour

From the `dev.nix` reference, `services.redis.port`:

> "Configures the port Redis will listen on. **By default tcp is disabled and redis only listens on
> `/tmp/redis/redis.sock`.**"

So if you write `REDIS_HOST=localhost REDIS_PORT=6379` against the default service config, `ioredis`
will fail with `ECONNREFUSED` and BullMQ will look broken. Two fixes (do both):

1. `services.redis = { enable = true; port = 6379; }` → real TCP listener, friendliest for BullMQ,
   `redis-cli`, and bull-board.
2. Make the client socket-aware (code in `04-architecture` §5.1), with
   `REDIS_PATH=/tmp/redis/redis.sock` as the default env value.

Then prove it in a terminal:

```bash
redis-cli -s /tmp/redis/redis.sock ping     # → PONG
redis-cli -p 6379 ping                      # → PONG  (after adding port=6379)
node -e "const R=require('ioredis');const c=new R({path:'/tmp/redis/redis.sock'});c.ping().then(console.log)"
```

Also: `IORedis` with `path` ignores `host/port`; keep the choice in one function. And Redis in a dev
workspace is **not** durable by default — which is precisely why `task_queue` in Postgres is the
source of truth (design decision #4 in `00-INDEX`).

## 5. Previews, ports, and why the browser must never talk to :4000 directly

- Only the previewed port is reachable from the IDE preview pane / public preview URL. A second port
  (your Express API) is *not* automatically proxied.
- Therefore: **single origin**. Vite proxies `/api` → `http://127.0.0.1:4000` inside the sandbox, and
  the browser only ever calls relative URLs (`fetch('/api/…')`). Same pattern keeps Codespaces
  (`*.app.github.dev`), local, and production (nginx) identical.

```js
// frontend/vite.config.js
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,          // ← accept the proxied *.cloudworkstations.dev / preview host
    hmr: { protocol: 'wss', clientPort: 443 },  // only if HMR socket is refused through the proxy
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:4000',
        changeOrigin: true,
        ws: false,
        // for SSE: don't let the proxy buffer the stream
        configure: (p) => p.on('proxyRes', (proxyRes, _req, res) => {
          if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
            proxyRes.headers['x-accel-buffering'] = 'no';
          }
        }),
      },
      '/storage': { target: 'http://127.0.0.1:4000', changeOrigin: true },  // optional dev only
    },
  },
  build: { sourcemap: true },
});
```

- If the preview shows a "host not allowed / refused" style error, that's the dev-server host check →
  `--host 0.0.0.0` + `allowedHosts: true` (or an array of the preview domain).
- **Absolute URLs in emails must use the public origin**, not `localhost`: `PUBLIC_APP_URL` env, and
  when unset compute it in the API from `req.headers['x-forwarded-host'] ?? req.headers.host`.
  Payslip email links built with `http://localhost:5173` are broken for anyone but you — a common
  cloud-IDE bug.
- Any link you expect a judge to click must be openable in *their* browser: prefer "download the PDF
  in-app" over "check your inbox", and always keep the portal path working (your extra feature is
  exactly this insurance).

## 6. Chromium/Puppeteer on Nix (only if you take the `PDF_RENDERER=puppeteer` path)

Facts that shape the decision:

- Chromium needs a set of system shared libraries (`libnss3`, `libgbm1`, `libatk-bridge2.0-0`,
  `libcups2`, `libasound2`, `fonts-liberation`…). On a Debian box you `apt-get install` them — **there
  is no `apt` in the documented Nix flow**, and installing them ad hoc is lost on rebuild. That's why
  the pure-JS renderer is the default in `04-architecture` §6.
- If you still want it: `packages = [ pkgs.chromium ]`, `PUPPETEER_SKIP_DOWNLOAD=true`,
  `PUPPETEER_EXECUTABLE_PATH=$(which chromium)`, and launch args
  `['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--font-render-hinting=none']`.
  Diagnose missing libs with `ldd $(which chromium) | grep "not found"`.
- Alternative worth one line in the roadmap: `pkgs.playwright-driver` /
  `PLAYWRIGHT_BROWSERS_PATH`, or `@sparticuz/chromium` (serverless-oriented). Not needed.
- `headless: 'shell'` (chrome-headless-shell) is smaller but is a different rendering path; full
  Chromium headless is the safer default for print CSS (`@page`, `break-inside: avoid`, running
  headers) — relevant if we render HTML payslips.
- Keep the fallback: `renderPayslipPdf()` = `try { puppeteer } catch { pdfkit }`, decided once at boot
  and logged. Then the demo survives.

## 7. Node/npm practicalities in this sandbox

- Use `engines: { node: ">=20" }`. Native modules (`bcrypt`, `argon2`, `cpu-features`-style) need a
  working toolchain — if `npm i bcrypt` fails to build, the pure-JS `bcryptjs` is the escape hatch
  (document the cost-factor change), or switch to `argon2` only if it builds. **Test `npm i` early,
  before you build 30 features on top of it** — this is the #1 way cloud-IDE hackathon time is lost.
- Install with `--prefer-offline --no-audit`; expect first `npm ci` to be slow. Pin exact versions in
  `package-lock.json` and commit it.
- No `docker` unless `services.docker.enable = true` (rootless docker). Rootless + `postgres:16` +
  `redis:7` compose is a perfectly good alternative to `services.*` — pick one, don't mix (two Postgres
  clusters on 5432 = confusing errors).
- Long-running processes: `onStart` + a terminal are the right tool; a background `nohup` dies with
  the terminal. Add `scripts/dev.sh` that `pkill`s old listeners first (`lsof -ti:4000 | xargs -r kill`)
  because "port already in use" after a restart is a guaranteed experience in these IDEs.
- `node --trace-warnings`, and set `NODE_OPTIONS=--max-old-space-size=1536` for the worker if you use
  Chromium (memory is the constrained resource in a dev workspace).
- Timezone: set `TZ=Asia/Kolkata` in `env` (or at least be explicit that `process.env.TZ` is set in
  `backend/src/config.js`) — "date" columns and weekday math depend on it, and the sandbox may be UTC.
  See `06-schema-review-and-gaps.md` finding #14 for why this is a correctness issue, not cosmetics.
- Disk: workspace quotas are modest; Chromium (~100 MB extra in `node_modules` if it downloads) plus
  a 6-month seed of generated PDFs can add up. `PUPPETEER_SKIP_DOWNLOAD=1` and
  `npm run pdf:clear` in the reset script.

## 8. `.env.example` (the interface between "my laptop" and "the IDE")

```dotenv
# core
NODE_ENV=development
TZ=Asia/Kolkata
PORT=4000
PUBLIC_APP_URL=                      # set to the preview URL for correct email links
WEB_ORIGIN=http://localhost:5173
# infra (socket OR host/port — code honours whichever is set)
DATABASE_URL=postgresql://postgres@localhost:5432/peoplepay360
REDIS_PATH=/tmp/redis/redis.sock
REDIS_HOST=
REDIS_PORT=6379
# security
JWT_SECRET=                          # REQUIRED, ≥32 bytes; app must refuse to boot without it
JWT_ACCESS_TTL=15m
REFRESH_TTL_DAYS=30
BCRYPT_ROUNDS=12
# mail
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM="PeoplePay360 Payroll <payroll@example.com>"
MAIL_DAILY_LIMIT=60
MAIL_DRIVER=ethereal                 # ethereal | smtp | file (file = write .eml to storage/outbox, always works offline)
# pdf
PDF_RENDERER=pdfkit                  # pdfkit | puppeteer
PUPPETEER_SKIP_DOWNLOAD=1
PUPPETEER_EXECUTABLE_PATH=
UPLOAD_DIR=./storage/uploads
```

`MAIL_DRIVER=file` is a deliberate addition: it writes each "email" as an `.eml` file into
`storage/outbox/` and marks the delivery SENT. Demo-day insurance if the sandbox blocks port 587
(egress from cloud IDEs to SMTP can be blocked — I have not verified this one for Firebase Studio,
so build the fallback rather than assume).

## 9. Commands to keep in a `Makefile`/npm scripts so the environment is disposable

```
npm run setup        # install + createdb + migrate + seed
npm run dev          # api + worker + web (concurrently)
npm run db:reset     # rebuild schema + demo data from scratch
npm run test         # vitest run
bash scripts/smoke.sh# headless end-to-end proof (login→compute→send→pdf)
npm run db:backup    # pg_dump -Fc > backups/pp360.dump
npm run db:restore   # pg_restore --clean --if-exists
```

`pg_dump`/`pg_restore` matter in this environment: because a rebuild can lose the service's data dir,
dumping to `backups/` inside the project is your insurance policy — and dumping **before** the demo
means you can restore a known-perfect state in 20 seconds if someone misclicks on stage.
