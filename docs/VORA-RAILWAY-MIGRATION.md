# VORA — Railway migration plan

Version 0.1 · 29 September 2026 · Status: **audit and plan only — no implementation has changed.**

- **Branch:** `railway-migration` in a separate working copy, created from the CP-3 Cloudflare
  Free state (`vora-cp3-cloudflare-free.zip`). It is committed locally and never pushed.
- **Untouched:** the CP-2.1 and CP-3 working copies, the frozen ZIPs, and every Cloudflare, Resend
  and Railway account.
- **Not done:** nothing was deployed, purchased or created, no data was migrated, and no secret was
  read or rotated.

**Evidence levels used in this document.**

| Label | Meaning |
|---|---|
| **VERIFIED LOCALLY** | Run in this sandbox; the command and result are in Appendix D |
| **DOCUMENTED** | Taken from the vendor's current documentation (checked 29 Sep 2026, sources in Appendix C), with its confidence |
| **NOT VERIFIED** | Cannot be tested here. Everything that needs a Railway or Cloudflare account is NOT VERIFIED until staging proves it. |

---

## 0. Verdict

1. **Railway can run VORA as one ordinary Node.js service.** Cloudflare stays in front for DNS,
   TLS, WAF, caching, Turnstile, R2 storage and (for staging) Access. Workers stops being the
   application runtime; no Worker is needed for VORA.
2. **Authentication gets stronger operationally, not weaker.** The Durable Object workaround goes
   away and Argon2id returns to normal server-side hashing, using Node's built-in `crypto.argon2`
   with *identical* parameters and hash format.
   - Local test (VERIFIED LOCALLY, Node 24.21.0): byte-for-byte identical output to today's
     library on 20 of 20 test vectors.
   - About 8× faster (30 ms against 249 ms per hash).
   - It runs off the main thread.
3. **The database should NOT move to PostgreSQL now.**
   - Keep SQLite — the engine D1 already is — as a file on a Railway volume, accessed with libSQL.
   - Replicate it continuously to R2 with Litestream, plus Railway's scheduled volume backups.
   - This keeps the schema, the 9 triggers, every CHECK constraint and the batch semantics exactly
     as they are.
   - PostgreSQL would add about 5–8 working days and real semantic risk for no launch-time benefit
     (§6).
4. **The shape of the change:**
   - A thin "platform adapter" gives the application the same small set of services it gets from
     Workers today: database, storage, rate limiter, background tasks, scheduler.
   - So the kernel, routes, services and almost every test stay unchanged.
   - The Cloudflare-specific surface is 27 items, all listed in §2.
5. **Complexity: Medium** — about **12–17 working days** to a verified staging environment (§14).
6. **Decisions you need to make before any build** (§12.4):
   - **D20** — the Railway plan (Hobby is a purchase; the Free plan cannot serve a custom domain).
   - **D21** — the region. There is no Australian region; Singapore is the nearest.
   - **D22** — staging protection.
   - **D23** — retiring the Cloudflare-only tests on this branch.
   - **D12** (existing) — Mark4 data.

**The price of the simpler database:** a volume ties VORA to **one instance**, and Railway documents
a short downtime on every redeploy of a service with a volume. That is acceptable for launch
traffic; the triggers for revisiting it are in §6.3.

---

## 1. What was inspected

- **Code:**
  - `workers/app.ts`, `wrangler.jsonc` (all three environments), `vite.config.ts`,
    `react-router.config.ts`, `package.json` scripts;
  - every file under `app/.server` that touches a binding, `request.cf`, Cloudflare headers or
    `waitUntil` (grep inventory, Appendix D);
  - `app/entry.server.tsx`;
  - the three migrations and their journal;
  - `scripts/*`: 6 run Wrangler directly (`seed`, `maintenance`, `dev-users`, `backup-export`,
    `restore-rehearsal`, `https-server`); 3 more depend on its configuration or build output
    (`predeploy-check`, `e2e-secrets`, `e2e-servers` via `vite preview`); 9 npm scripts call it;
  - the test harness (`vitest.integration.config.ts`, `tests/support/*`), all 43 test and spec files, and
    the Playwright and HTTPS configurations.
- **Facts:** Railway, Node.js, Cloudflare, R2, Drizzle, libSQL, Litestream, Hono and React Router
  documentation (Appendix C).
- **Local experiments:**
  - Argon2id compatibility and speed on Node 24.21.0;
  - React 19.3's Node server build exports `renderToReadableStream`.

---

## 2. Every Cloudflare-specific component and what replaces it

| # | Component | Where | Railway replacement | Size |
|---|---|---|---|---|
| 1 | Workers entry (`fetch`, `scheduled`, DO export) | `workers/app.ts` | Node server entry: `@hono/node-server` request listener calling the **same** kernel with an execution-context object, plus scheduler and shutdown handling | M |
| 2 | Cloudflare Vite plugin, `wrangler types`, `worker-configuration.d.ts`, `tsconfig.cloudflare.json` | `vite.config.ts`, `package.json`, root | Standard React Router Node build (Vite SSR input = the server entry); own environment types | S |
| 3 | `wrangler.jsonc` (vars, bindings, crons, routes, secret declarations) | root | Railway variables (sealed for secrets), a root `Dockerfile`, and Railway's `.railway/railway.ts` or dashboard settings | S |
| 4 | D1 binding `DB`, `drizzle-orm/d1`, `D1Database` types | `app/.server/db/client.ts`, `config/env.ts` | `@libsql/client` on a volume file + `drizzle-orm/libsql`. `db.batch()` stays (atomic in libSQL too). `env.DB` becomes a small D1-shaped facade over the same connection (`prepare/bind/first/all/run/batch`), which the health check and the tests use directly; `createDb(env.DB)` takes the facade's libSQL client. | S–M |
| 5 | D1 result metadata `meta.changes` | 11 sites: `auth/sessions.ts` (2), `jobs/scheduled.ts` (9) | `rowsAffected`, through one small helper so the code stays driver-neutral | S |
| 6 | D1 migrations through Wrangler; `d1_migrations` ledger | `package.json`, `services/health.ts`, restore scripts | Migration runner at start-up (volumes are only mounted at runtime), using the same three SQL files | M |
| 7 | **SQLite foreign keys** — D1 enforces them; plain SQLite does not by default | whole schema (76 references) | `PRAGMA foreign_keys=ON` on every connection, plus a test (§6.4). **Critical — silent integrity loss otherwise.** | S |
| 8 | R2 bindings `MEDIA`, `PRIVATE` | `services/health.ts` today (the media library comes later) | R2 over its S3 API behind a storage adapter with the same methods (`head/get/put/delete/list`) | S |
| 9 | KV `DEV_MAILBOX` (dev/test only) | `email/transport.ts`, `api/routes.ts` (`/api/dev/mailbox`) | A dev/test mailbox table or in-memory store with the same interface. The route keeps answering 404 in staging/production (unchanged). | S |
| 10 | Workers Rate Limiting (`RL_AUTH` 20/60 s, `RL_FORMS` 6, `RL_API` 120, `RL_AI` 12) | `services/rate-limit.ts` | In-process sliding-window limiter with the same `limit({ key })` call — exact, because there is one instance | S |
| 11 | PasswordHasher Durable Object + DO mode | `auth/password-hasher.ts`, `auth/password-hashing.ts`, `workers/app.ts` | Removed. Native `crypto.argon2` in-process, with the same parameters and PHC format, and the same fail-closed behaviour (§5) | M |
| 12 | `ExecutionContext.waitUntil` | `kernel/app.ts`, `auth/sessions.ts`, `auth/password-reset.ts`, `email/outbox.ts`, `jobs/scheduled.ts`, `workers/app.ts` (the `scheduled` handler) | A background-task tracker passed as the execution context (`app.fetch(req, env, ctx)` accepts one), drained on SIGTERM | S |
| 13 | Cron Triggers `*/5 * * * *`, `17 3 * * *` | `wrangler.jsonc`, `jobs/scheduled.ts` | In-process UTC scheduler calling the existing `runScheduled` (§8) | S |
| 14 | `request.cf` (country, region, city, ASN) | `lib/request-meta.ts` | Cloudflare headers forwarded to the origin (`CF-IPCountry`, the visitor-location managed transform, ASN through a Transform Rule), trusted only when the origin-auth header is valid | S |
| 15 | `CF-Connecting-IP` as the only trusted IP | `lib/request-meta.ts` | Unchanged header, now trusted **only** behind the origin-auth check (§4.4). A direct hit on Railway is refused. | S |
| 16 | `cf-ray` as the request ID | `kernel/app.ts` | Unchanged (Cloudflare still sends it); used only behind origin auth, otherwise a random ID | XS |
| 17 | Request URL = the public URL | `kernel/app.ts` (`isSameOriginRequest`), anything using `new URL(request.url)` | The adapter rebuilds the request URL from `APP_ORIGIN`. It never uses `Host` or `X-Forwarded-Proto`; otherwise every POST would fail the CSRF check (`http://` vs `https://`). | S |
| 18 | Workers Logs (`console.log(object)`) | `observability/logger.ts` | One-line JSON with `message` and `level` (what Railway parses); the redaction is unchanged | XS |
| 19 | Workers Static Assets + `public/_headers` | build output, `public/_headers` | The Node server serves `build/client`: hashed assets `immutable` for a year, `nosniff` on everything; Cloudflare caches at the edge | S |
| 20 | Worker source-map upload | `wrangler.jsonc` | `node --enable-source-maps` with the server maps kept inside the image (never public) | XS |
| 21 | Deploy scripts and guards H1–H4 | `package.json`, `scripts/predeploy-check.ts` | Railway deploys from the image. The guards are restated for Railway (§13.3): boot-time validation (H1, H3), build + scan before deploy (H2); H4 no longer applies. | M |
| 22 | Database scripts through `wrangler d1 execute/export` | `seed.ts`, `maintenance.ts`, `dev-users.ts`, `backup-export.ts`, `restore-prepare.ts`, `restore-rehearsal.ts` | The same scripts against a libSQL file. Backup = Litestream replica + Railway volume backups; export = `litestream restore` to a local file. | M |
| 23 | Integration harness in workerd (`@cloudflare/vitest-plugin`, `cloudflare:test`, Miniflare) | `vitest.integration.config.ts`, `tests/support/*` (5 files import `cloudflare:*` directly; `test-worker.ts` re-exports the Durable Object) | A Node Vitest run with a small runtime module aliased as `cloudflare:test` / `cloudflare:workers`, so the **test files stay byte-for-byte unchanged** (§13) | M |
| 24 | E2E servers (`vite preview` over Wrangler state; HTTPS through `wrangler dev`) | `scripts/e2e-servers.mjs`, `scripts/https-server.mjs`, `e2e:prepare` | Three production Node servers on separate database files; HTTPS through `node:https` with a local self-signed certificate | S |
| 25 | Cloudflare-Free adaptations | `EMAIL_RETRY_BATCH = 10`, DO config tests, Free-limit test | Back to the CP-2.1 batch of 25 (the Free subrequest cap no longer applies). The tests are retired only with your approval (D23), with replacements. | XS |
| 26 | Turnstile | `services/turnstile.ts`, contact/auth forms, CSP | **Unchanged** — Turnstile works on any origin | — |
| 27 | Cloudflare Access (planned for staging) | runbook | Still Cloudflare, plus validation of the Access JWT at the origin (§5.3) | S |

Size: XS < ½ day · S ≈ ½–1 day · M ≈ 1–3 days.

---

## 3. What stays unchanged

- **HTTP kernel logic:**
  - security headers and CSP (the Turnstile sources stay);
  - CSRF logic (fed a correct URL by the adapter);
  - maintenance mode;
  - legacy redirects;
  - the API routes and the webhook signature check.
- **All React Router routes, components, `root.tsx` and `entry.server.tsx`.**
  `renderToReadableStream` is exported by React 19.3's Node build (VERIFIED LOCALLY).
- **Authentication:**
  - sessions (SHA-256-stored tokens, the `__Host-vora_session` cookie with flags derived from
    `APP_ORIGIN`);
  - email one-time codes, recovery codes, password reset, invitations, first-Owner setup, RBAC and
    step-up;
  - password policy, breach check and the timing dummy.
- **Services:** enquiries, settings and flags, audit, security events, the email outbox and its
  retries, the Resend transport and webhooks, Turnstile verification, the Gemini provider and its
  limits and circuit breaker.
- **Database:**
  - the Drizzle schema (`sqlite-core`);
  - the three migration SQL files, including the 9 triggers;
  - the seeds and the Zod configuration validation (a few new variables are added).
- **Everything in `shared/`, `app/styles`, `app/components`, `app/routes`.**
- **Test bodies:** all 13 unit files, all 14 integration files and all 8 Playwright spec files.
  Only the harness underneath changes. The exceptions are the Cloudflare-configuration tests
  (§13.3).

---

## 4. Runtime

### 4.1 Node.js version

- **Pin Node 24.21.0** (latest 24.x, released 2026-09-08 — DOCUMENTED, HIGH).
- **Minimum 24.19.0:**
  - `crypto.argon2` exists from 24.7.0 and was marked stable in 24.19.0.
  - It needs OpenSSL ≥ 3.2; the official Node 24 builds ship OpenSSL 3.5.x (24.21.0 has 3.5.8 —
    VERIFIED LOCALLY).
  - A distribution-built Node linked to an older system OpenSSL would throw
    `ERR_CRYPTO_ARGON2_NOT_SUPPORTED`. That is why the image is built from the official `node:`
    base image and the server self-tests Argon2 at start-up (§5.1).
- **`package.json` `engines.node`:** `>=22.22.0` today (React Router 8 needs ≥ 22.22) → becomes
  `>=24.19.0`.
- **Lifecycle:** Node 24 moves to Maintenance LTS on 2026-10-20 and reaches end of life on
  2028-04-30. Node 26 becomes LTS on 2026-10-28. Plan a Node 26 upgrade as routine maintenance
  in 2027.

### 4.2 Server shape

```
server/main.ts  (bundled by the Vite SSR build, so the ~ and @shared aliases resolve)
 1. read + validate configuration from process.env     (existing Zod schema, plus new vars)
 2. open SQLite:  file:/data/vora.db   PRAGMA foreign_keys=ON · journal_mode=WAL · busy_timeout
 3. run pending migrations                              (same SQL files; stop on any error)
 4. Argon2id self-test                                  (known-answer hash; refuse to start if absent)
 5. build the platform env object                       DB · MEDIA · PRIVATE · RL_* · (DEV_MAILBOX in dev)
 6. createKernel({ renderPage: React Router handler })  ← unchanged kernel
 7. http server:  static files from build/client → otherwise
                  kernel.fetch(rebuiltRequest, env, backgroundTasks)
 8. scheduler:    */5 → email retry · 17 3 * * * → daily job   (UTC, no overlap)
 9. SIGTERM:      stop accepting · stop scheduler · finish requests + background tasks
                  (bounded) · close the database · exit 0
```

- **Start command:** `node --enable-source-maps build/server/main.js`, run **directly** (not
  through npm, which swallows SIGTERM — DOCUMENTED, Railway).
- **Litestream:** it supervises the process: `litestream replicate -exec "node …"` (§6.9).

### 4.3 SSR

React Router 8.4 server rendering is unchanged:

- `createRequestHandler` from `react-router` works with any Fetch-API server;
- the kernel already hands React Router a `RouterContextProvider`, which v8 requires;
- `renderToReadableStream` is available in React 19.3's Node build (VERIFIED LOCALLY).

**Dev server:** Vite in middleware mode inside the Node server — React Router's documented
custom-server pattern. It replaces the Cloudflare plugin's workerd dev runtime.

### 4.4 Behind two proxies: URL, scheme and client IP

The request path is visitor → Cloudflare → Railway edge → the app (plain HTTP on `$PORT`).

- **Public URL.** The adapter builds `request.url` from `APP_ORIGIN` plus the path and query. It
  never uses `Host` or `X-Forwarded-Proto`. The CSRF check (`Origin === url.origin`), redirects
  and cookies therefore behave exactly as on Workers.
- **Origin authentication.**
  - A Cloudflare Transform Rule adds a secret header (e.g. `X-Vora-Origin-Auth`) to every
    request.
  - The app compares it in constant time with `ORIGIN_AUTH_SECRET` and refuses anything else
    (403).
  - Only Railway's deploy health check path is exempt, and it reveals nothing.
  - **Why it's needed:**
    - Railway documents no way to force traffic through Cloudflare (DOCUMENTED, MEDIUM).
    - Authenticated Origin Pulls can't work, because Railway's edge terminates TLS.
    - Without this check, anyone could reach the app directly and forge `CF-Connecting-IP`.
- **Client IP:**
  - `CF-Connecting-IP`, trusted only after origin authentication passes.
  - `X-Forwarded-For` is still never used for security decisions (unchanged policy).
  - Railway also sets `X-Real-IP` and, per Railway staff, rewrites `X-Forwarded-For` from
    `CF-Connecting-IP` for Cloudflare traffic (MEDIUM). VORA doesn't depend on that behaviour.
- **Location and network:**
  - `CF-IPCountry` (IP Geolocation, Free) and the "Add visitor location headers" managed
    transform (`cf-ipcity`, `cf-region` …);
  - the ASN through a second Transform Rule header set to `to_string(ip.src.asnum)` — there is no
    managed ASN header (DOCUMENTED, HIGH).
  - These feed the same `RequestMeta` fields (country, region, city, ASN) used by the suspicious
    sign-in signals, so detection keeps its inputs.
- **Local development and tests:** no Cloudflare. The adapter takes the socket address and
  `APP_ORIGIN`, and origin authentication is off unless `APP_ENV` is staging or production. It
  can never be switched off there.

### 4.5 Static assets and caching

- **`build/client/assets/*`** (hashed): `Cache-Control: public, max-age=31536000, immutable`.
- **Other public files:** a short cache.
- **Everything:** `X-Content-Type-Options: nosniff` — the only rule in today's `public/_headers`.
- **Where the kernel's headers apply:** HTML and API responses still get all the kernel's security
  headers. Static files are served before the kernel — the same split as Workers Static Assets.
- **Edge caching:** Cloudflare caches the assets automatically (by extension). HTML isn't cached
  unless a Cache Rule is added later; responses with a session are always `no-store`
  (unchanged).

### 4.6 Logging

- Railway parses **single-line JSON with `message` and `level`**; retention is 7 days on Hobby,
  there is no log drain, and output is capped at 500 lines/s (DOCUMENTED, HIGH).
- **The change:** the logger emits `JSON.stringify({ level, message: msg, msg, time, … })` on one
  line.
- **Unchanged:** key-based redaction and free-text credential scrubbing.
- Security events and audit logs also live in the database, so the 7-day log retention doesn't
  shorten the security trail.

### 4.7 Graceful shutdown

- Railway sends SIGTERM, then SIGKILL after `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`, which
  **defaults to 0** (DOCUMENTED, HIGH). Set it to **30**.
- **The server:**
  1. stops accepting connections;
  2. stops the scheduler;
  3. waits for in-flight requests and tracked background tasks (email sends, session touches,
     logs) for at most 25 s;
  4. closes the database, then exits.
- **An email cut off mid-send is not lost:** the outbox already requeues `sending` rows older
  than 10 minutes.

### 4.8 Health checks

- **`/api/health`** keeps its current behaviour (database, storage, email, jobs, configuration).
- **Railway's deploy check** should call a new **`/api/health/live`**, which checks only the
  process, the database and that migrations are complete. An R2 or Resend blip must never block a
  deploy.
- Railway runs its health check only at deploy time, from `healthcheck.railway.app`, with a
  300 s default timeout (DOCUMENTED).

### 4.9 Build

- **Recommended: a root `Dockerfile`.** Railway always uses a root Dockerfile when present
  (DOCUMENTED).
  - It starts from a pinned `node:24.21.0-bookworm-slim` digest;
  - `npm ci` from the lockfile, `react-router build`, then the server bundle;
  - the Litestream binary (pinned version and checksum);
  - it runs as a non-root user with a read-only application directory.
- **Why not Railpack:** the same image builds on your Mac, in the clean-room check and on
  Railway, which reproducibility needs.
- **Railway configuration:**
  - Railway's `railway.json`/`railway.toml` "Config as Code" is **deprecated** and stops being
    read on **2026-12-01**.
  - Settings live in the dashboard or the new `.railway/railway.ts` (DOCUMENTED, HIGH).
  - Don't create a `railway.json`.

### 4.10 Environment variables

Set in Railway per environment. **Secrets are sealed variables**: they are never shown in the UI
or returned by the CLI or API. They are entered in the dashboard's variable editor, never typed
into a shell command, and never committed.

| Variable | Kind | Notes |
|---|---|---|
| `APP_ENV` | plain | `staging` / `production` |
| `APP_ORIGIN` | plain | `https://staging.vorawebsites.store` / `https://vorawebsites.store` |
| `APP_NAME`, `EMAIL_TRANSPORT`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `TEAM_NOTIFY_EMAIL`, `CAREERS_NOTIFY_EMAIL`, `TURNSTILE_SITE_KEY`, `AI_GATEWAY_BASE_URL`, `MAINTENANCE_MODE`, `LOG_LEVEL` | plain | The same values as today's `wrangler.jsonc` environments |
| `AUTH_SECRET`, `AUTH_SECRET_PREVIOUS` | **sealed** | Unchanged meaning (the current and previous HMAC secrets) |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY`, `GEMINI_API_KEY`, `SETUP_TOKEN` | **sealed** | Unchanged |
| `ORIGIN_AUTH_SECRET` | **sealed** | **New.** Must equal the Transform Rule header value; ≥ 32 random bytes |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | plain | **New, staging only:** the Access JWT validation settings |
| `DATABASE_PATH` | plain | **New:** `/data/vora.db` (on the volume) |
| `R2_ACCOUNT_ID`, `R2_BUCKET_MEDIA`, `R2_BUCKET_PRIVATE`, `R2_BUCKET_BACKUPS` | plain | **New:** the S3 endpoint and bucket names |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | **sealed** | **New:** an R2 API token scoped to *this environment's* buckets only (Object Read & Write) |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | plain | **New:** `30` |
| `UV_THREADPOOL_SIZE` | plain | **New:** `8` (Argon2 and file I/O share the libuv pool; §5.1) |
| `NODE_ENV`, `TZ` | plain | `production`, `UTC` |
| `PORT` | Railway-provided | Read, never set |

**Configuration validation stays fail-closed.** Staging and production refuse to start when:

- a required secret is missing;
- a Turnstile test key is set;
- the capture email transport is selected;
- `APP_ORIGIN` isn't https;
- `ORIGIN_AUTH_SECRET` is missing or short.

---

## 5. Authentication — the security strength is preserved

### 5.1 Argon2id returns to normal server-side hashing

| | Today (CP-3 Free) | Railway |
|---|---|---|
| Algorithm | Argon2id, `@noble/hashes` (pure JS) | Argon2id, Node `crypto.argon2` (OpenSSL, native) |
| Where | A Durable Object (to escape the Worker's 10 ms CPU limit) | In-process, on the libuv threadpool — the event loop stays free |
| Parameters | m = 19,456 KiB · t = 2 · p = 1 · 32-byte tag · 16-byte random salt | **Identical** |
| Input | Password normalised to NFKC | **Identical** |
| Stored format | `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` (PHC) | **Identical** — existing hashes verify unchanged |
| Cost per hash (this sandbox) | 249 ms (`@noble`) | **30 ms** (VERIFIED LOCALLY) |
| When hashing is unavailable | 503, fails closed, nothing recorded | 503, fails closed, nothing recorded (same tests) |

**Compatibility is proven, not assumed** (VERIFIED LOCALLY, Appendix D):

- 20 of 20 vectors — ASCII, Unicode that NFKC changes, the empty string, 256 characters, emoji —
  produced byte-identical output from `@noble/hashes` and `crypto.argon2('argon2id', …)` with
  VORA's parameters;
- eight concurrent hashes took 116 ms wall time with the default threadpool;
- the event loop kept ticking throughout.

**Implementation rules** (for the build step, not done now):

1. `hashPassword` / `verifyPassword` keep their signatures and PHC encoding. Only the key
   derivation call changes. `isPolicyHash`, `needsRehash`, `TIMING_DUMMY_HASH` and
   `burnPasswordCheck` are unchanged, so unknown-email timing parity holds.
2. `@noble/hashes` stays as a **dev** dependency. A permanent test cross-checks the native output
   against it, plus known-answer vectors.
3. **Start-up self-test:** the server hashes a fixed vector and compares it with the stored
   answer. It refuses to start if Argon2 is missing or wrong, so it can never fall back to
   anything weaker.
4. **Back-pressure:** at most 4 hashes run at once (≈ 19 MiB each), with a short queue. A full
   queue or a timeout answers 503 exactly as the Durable Object path does today: no attempt is
   recorded, and no reset link or invitation is burned. The existing fail-closed tests are
   re-pointed at this failure. The per-account and per-IP throttles still apply before hashing.
5. **Oversized input** is refused before hashing, as the Durable Object does now.
6. **Removed:**
   - `auth/password-hasher.ts` (the Durable Object);
   - the `PASSWORD_HASHER` binding and the DO branch of `auth/password-hashing.ts` (its interface
     stays, with a single native mode);
   - the DO export from the entry.

### 5.2 Everything else in authentication

| Area | Change |
|---|---|
| Sessions (random token, SHA-256 at rest, sliding and absolute expiry, `__Host-` cookie, Secure, HttpOnly, SameSite=Lax) | None. The cookie flags come from `APP_ORIGIN`, not from the request. |
| Session touch after the response | Moves from `waitUntil` to the background-task tracker |
| Two-step sign-in (email one-time code), recovery codes, step-up for privileged actions | None |
| Password reset (single-use HMAC links), invitations, first-Owner `/setup` with `SETUP_TOKEN` | None; their fail-closed tests are kept |
| Suspicious sign-in signals (IP prefix, country, ASN, user agent) | Same fields, from the Cloudflare headers behind origin authentication (§4.4) |
| CSRF (Origin / Sec-Fetch-Site, SameSite=Lax) | None — the adapter supplies the true public URL |
| Rate limits (per IP hash: auth 20/min, forms 6/min, API 120/min, AI 12/min) | Same limits, same keys (HMAC of the IP), in-process and exact. A restart clears the counters; the account throttles in the database (failed-attempt counts, lockouts) persist. |
| Turnstile | None (the server verifies with `remoteip` = the trusted IP) |
| Breach check (k-anonymity) | None (outbound `fetch`) |
| Secrets rotation | Unchanged procedure (`AUTH_SECRET_PREVIOUS`); in Railway it's a sealed-variable edit plus a redeploy |

### 5.3 Defence in depth that is *new* on Railway

- **Origin authentication** (§4.4), because the origin is now publicly routable.
- **Staging Access JWT validation.**
  - Cloudflare Access protects `staging.vorawebsites.store`.
  - The app verifies the `Cf-Access-Jwt-Assertion` header against the team's published keys and
    the application audience, and refuses otherwise.
  - Cloudflare documents this check as required for a public origin (DOCUMENTED, HIGH).
  - Access policies name specific approved email addresses only, never "Everyone" (your standing
    rule).
- **Optional edge limits:** a Cloudflare rate-limiting rule on `POST /login` and the setup and
  reset endpoints. How many rules the Free plan includes is NOT VERIFIED.

---

## 6. Database

### 6.1 What exists

**D1 is SQLite.** The schema has:

- 52 tables with 76 foreign-key references;
- **9 triggers**: append-only audit and security logs, immutable content versions, last-Owner
  guards;
- CHECK constraints using `json_valid` (19), `glob` (13), `length()` (10) and `like` (4);
- 3 migrations (a Drizzle journal with statement breakpoints).

**Atomicity comes from `db.batch()`**, because D1 has no interactive transactions.

**There is no production data in D1.** The staging and production databases were never created
(the `REPLACE_WITH_…_D1_ID` placeholders are still in `wrangler.jsonc`), so there is nothing to
move out of D1.

### 6.2 Options

| | **A · SQLite (libSQL) on a Railway volume** | B · Railway PostgreSQL | C · Turso (hosted libSQL) | D · D1 over its HTTP API |
|---|---|---|---|---|
| Schema, triggers, CHECKs | **Unchanged** | Port all 52 tables to `pg-core`; rewrite the 9 triggers in PL/pgSQL; replace `glob`, `json_valid`, `like` | Unchanged | Unchanged |
| App code | Driver swap + 11 `rowsAffected` sites | Dialect-wide review of queries and SQL fragments | Driver swap (remote URL) | Every query becomes an HTTP call |
| Tests | Unchanged (the harness supplies SQLite) | Harness rewrite (e.g. PGlite); some assertions change | Unchanged locally | — |
| Deploy downtime | **Short outage on every redeploy** (volume) | None (no volume on the web service) | None | None |
| Instances | 1 | Many | Many | Many |
| Backups | Litestream → R2 (continuous, ~1 s lag) + Railway volume backups | Volume backups + optional point-in-time recovery | Vendor-managed | Cloudflare Time Travel |
| Latency | In-process (microseconds) | Private network | Internet round trip per query | Internet round trip per query |
| New vendor or cost | None (the volume is metered) | A second always-on service | New account; free tier then paid | Keeps a Cloudflare dependency; rate limits |
| Extra effort | Baseline | **+5–8 days** | +1 day | Not viable |
| Risk | Low | **Medium–high** (semantic drift) | Low–medium | High |

### 6.3 Recommendation: A now, and don't migrate to PostgreSQL yet

**A is the lowest-risk path.** VORA keeps the exact database engine it was designed and tested
against, including the integrity triggers, the CHECK constraints and the batch semantics.

**PostgreSQL is not needed at launch.** Revisit B (or C) only when one of these becomes true:

1. you need more than one application instance, or zero-downtime deploys;
2. the database grows beyond a few GB (the Hobby volume limit is 5 GB — DOCUMENTED);
3. write concurrency becomes a bottleneck;
4. another service must share the database.

The code is written so a later switch is contained: one database module and driver-neutral
helpers.

**What PostgreSQL would take, for when you do decide:**

- 52 table definitions moved from `sqlite-core` to `pg-core`;
- epoch-millisecond `integer` columns become `bigint`, and 0/1 flags become `boolean`;
- JSON text columns become `jsonb` (or `text` with an `IS JSON` check on PostgreSQL 16+);
- `glob` CHECKs become regular expressions;
- **`like` changes meaning:** it is case-insensitive for ASCII in SQLite and case-sensitive in
  PostgreSQL;
- `NULL` sorts first in SQLite and last in PostgreSQL;
- the 9 triggers become PL/pgSQL functions;
- the seed SQL and the SQL-dump/restore tooling change;
- the integration harness changes (PGlite or a disposable PostgreSQL);
- the migrations are regenerated.

**The main risks are silent behaviour changes** (LIKE, NULL ordering, integer width), not
compile errors.

### 6.4 Client configuration (option A)

- **Client:** `@libsql/client` (0.18.x) with `url: "file:/data/vora.db"`, plus
  `drizzle-orm/libsql`. It supports `:memory:` and `file:` on Node (DOCUMENTED, HIGH).
- **PRAGMAs on the connection before first use:**
  - `foreign_keys = ON` — **mandatory.** D1 enforces foreign keys; plain SQLite does not by
    default. Without it, the `ON DELETE` rules and references in the schema would silently stop
    being enforced.
  - `journal_mode = WAL` — the client never sets it.
  - `busy_timeout` via the client's `timeout` option. Without it, lock contention fails
    immediately with `SQLITE_BUSY` (DOCUMENTED, HIGH).
  - `synchronous = NORMAL` in WAL mode.
- **Connections:** libSQL opens up to `concurrency` connections for a file database (default 20 —
  DOCUMENTED, HIGH), and PRAGMAs are per connection. Use **`concurrency: 1`**: SQLite serialises
  writes anyway, and at VORA's scale a single connection is simpler and guarantees every
  statement sees the PRAGMAs.
- **New tests:** `PRAGMA foreign_keys` returns 1, and a deliberate foreign-key violation is
  rejected.
- **`db.batch()`:** libSQL runs a batch "in an implicit transaction", rolled back if any statement
  fails (DOCUMENTED, HIGH), so `runBatch` (4 callers) and the 5 direct `db.batch` calls keep their
  atomicity. First-Owner setup relies on a batch failing on a unique marker, which libSQL
  preserves.
- **Error text:** `services/enquiries.ts` recognises a duplicate submission by matching the error
  text (`enquiries.submission_key` / `enquiries_submission_uq`, and `reference` for a reference
  collision). SQLite's own message (`UNIQUE constraint failed: enquiries.submission_key`) is the
  same under D1 and libSQL, only wrapped differently. The existing enquiry integration tests
  cover it, and they must pass unchanged on libSQL before R3 is signed off.
- **`.run()` results:** they return `rowsAffected` instead of `meta.changes`, which changes 11
  sites.

### 6.5 Migrations

- The **same three SQL files**, applied at start-up before the server listens. Railway volumes are
  mounted only at runtime, not during the build or the pre-deploy step (DOCUMENTED, HIGH).
- The runner records applied files in the existing **`d1_migrations`** ledger table, so the health
  check and the restore rehearsal's comparisons keep working. (Drizzle's own migrator uses a
  different table; either is fine, but keeping the ledger avoids touching three tools.)
- **Before applying anything**, it writes a consistent snapshot (`VACUUM INTO
  /data/pre-migrate-<timestamp>.db`) and keeps the last three.
- **Each file is applied in one transaction.** On any error the process exits non-zero: Railway's
  health check fails and the deploy doesn't go live. The previous image can be redeployed and the
  snapshot restored (runbook step).
- Migrations are created exactly as today (`drizzle-kit generate` + reviewed SQL).

### 6.6 Transactions

Batch semantics stay the rule; nothing needs interactive transactions. Where a future feature
does, libSQL supports them — but they must not span a network call.

### 6.7 Data migration

- **D1 → Railway:** none. No D1 data exists.
- **Mark4 → VORA (existing decision D12):**
  - If you want existing enquiries or portal users carried over, it is a separate, read-only job.
  - It needs an export of Mark4's SQLite file (Mark4 runs on Railway with its own volume) and a
    mapping script into VORA's schema.
  - Imported users must re-verify, and passwords are never copied in a weaker format. Mark4's
    hash format would need checking first.
  - The dry run goes to a local copy. **Mark4's service and data are never modified.**
- **Staging data** is seeded from the base seed (`scripts/seed.ts`, adapted).

### 6.8 Local and CI

- Tests use `:memory:` or temporary files: fast, isolated per test file, with the same migrations
  and seed.
- The E2E and HTTPS runs use three separate files, replacing the three Wrangler state
  directories.

### 6.9 Backups and restore

| Layer | What | Recovery point | Notes |
|---|---|---|---|
| 1 · Litestream | Continuous replication of `/data/vora.db` to a private R2 bucket per environment (`vora-backups-staging`, `vora-backups`) | About 1 s (asynchronous) | The same container runs `litestream replicate -exec "node …"`. On an empty volume it first runs `litestream restore -if-db-not-exists -if-replica-exists`. Only one replicator may run, which holds because a volume service can't overlap. |
| 2 · Railway volume backups | Daily (kept 6 days), weekly (27), monthly (89) | ≤ 24 h | Restores only within the same project and environment. **Wiping the volume deletes its backups** — which is why layer 1 exists. |
| 3 · Pre-migration snapshots | `VACUUM INTO` before each migration run | That moment | Last 3 kept on the volume |
| 4 · Rehearsal | `db:restore-rehearsal` adapted: restore the latest Litestream replica into a fresh file, then compare tables, triggers, row hashes, `quick_check`, `foreign_key_check`, and run the app on it | — | Monthly, and before production cutover. The CP-2.1 rehearsal passed 23/23 on D1. |

**R2 cost:** within R2's free allowance at this size (10 GB-month, 1 M Class A and 10 M Class B
operations; DOCUMENTED). Litestream sets R2-safe concurrency automatically.

---

## 7. Storage — R2 stays

**Yes, R2 can remain.** Nothing about R2 depends on Workers:

- it has an S3-compatible API at `https://<account>.r2.cloudflarestorage.com` (region `auto`);
- credentials come from an R2 API token;
- egress is free, including through the S3 API (DOCUMENTED, HIGH).

- **Buckets per environment:** media (public assets), private (CVs, client files) and **backups**
  (new, for Litestream). None is created without your action — the Railway plan has no
  auto-provisioning at all.
- **Access:**
  - a small S3 adapter (signing with `aws4fetch`, about 3 KB, rather than the large AWS SDK);
  - it exposes the subset VORA uses: `head`, `get`, `put`, `delete`, `list`;
  - `services/health.ts` and the coming media library call it exactly like the binding.
- **Credentials:** one R2 API token per environment, scoped to that environment's three buckets,
  with Object Read & Write. Stored as sealed variables.
- **Public media:** serve through an R2 custom domain on the zone (e.g. `media.vorawebsites.store`),
  so Cloudflare caches it and the app isn't in the path. Image Transformations can resize it
  (5,000 unique transformations a month free; DOCUMENTED).
- **Private files:** never public.
  - Downloads go through the app after an authorisation check, streamed from R2, or through
    short-lived presigned URLs.
  - Uploads go through the app with size and type checks. Large files use presigned PUTs straight
    to R2, because Railway's proxy expects an upload to finish within 5 minutes and Cloudflare
    Free caps request bodies at 100 MB (DOCUMENTED).

---

## 8. Background jobs

**Today there are:**

- two Cron Triggers:
  - `*/5 * * * *` — email retry, 10 per run since the Free adaptation;
  - `17 3 * * *` — the daily retention and clean-up job;
- `waitUntil` background work;
- no queues and no separate workers.

**Every run writes a `job_runs` record, and `/api/health` flags a job that is late.**

| Option | How | Verdict |
|---|---|---|
| **In-process scheduler** (recommended) | A UTC cron library (e.g. `croner`) inside the web process calls the existing `runScheduled` with the same cron strings; an overlap guard skips a run while the previous one is active | **Recommended.** The SQLite volume can be attached to only one service, and the jobs need the database. Jobs, requests and shutdown share one lifecycle. |
| Railway cron service | A separate service started on schedule that calls `http://<web>.railway.internal:<port>/internal/jobs/<name>` with a secret | Workable, but it adds an internal endpoint, a secret and a second service. Runs must be ≥ 5 min apart (ours are) and the process must exit (DOCUMENTED). |
| Separate worker service | — | Not needed: there is no queue |

**Changes:**

- `EMAIL_RETRY_BATCH` goes back to **25**, the CP-2.1 value. It was reduced to 10 only to fit the
  Free plan's 50-subrequest limit, which doesn't exist on Railway. The outbox's retry schedule,
  dead-lettering, stuck-send recovery and sensitive-mail exclusion are unchanged.
- **Background tasks:**
  - a tracker holds each promise;
  - errors are logged, never thrown into the request;
  - shutdown drains them (§4.7);
  - the outbox design means a task lost to a crash is retried by the next cron run.

---

## 9. Email (Resend)

**Unchanged.** Resend is called over HTTPS with `RESEND_API_KEY` (sealed), through the outbox with
retries and dead-lettering. Delivery webhooks are verified with `RESEND_WEBHOOK_SECRET`.

| Mail | Path | Railway change |
|---|---|---|
| Sign-in codes, password reset, invitations, security notices | Outbox, immediate send in the background | None (`waitUntil` → tracker) |
| Enquiries: team alert (`TEAM_NOTIFY_EMAIL`) + confirmation to the sender | Outbox | None |
| Careers | `CAREERS_NOTIFY_EMAIL` exists; the application form ships later (Phase 4/5) | None |
| Partnerships, support | Handled today as general enquiries and the published addresses. There is no dedicated support or partnership sender yet. | None (a future decision, not a migration item) |
| Retries | The `*/5` job | In-process scheduler, batch 25 |
| Dev/test capture | The capture transport; the dev mailbox in KV | The same transport; the mailbox moves to a dev-only store |

The domain verification records (DKIM, SPF, DMARC) stay in Cloudflare DNS and are unaffected by
where the app runs.

---

## 10. VORA AI (Gemini)

**Unchanged:**

- **The key and switches:**
  - the server-side key (`GEMINI_API_KEY`, sealed; the security scan keeps checking that it never
    reaches the client bundle);
  - both feature flags and `ai.config` channels default to **off**;
  - permissions `ai.use`, `ai.manage` and `ai.usage.view`.
- **Limits and protections:**
  - per-day request and token limits stored in the database;
  - input caps (`maxInputChars`, `maxTurns`);
  - the provider circuit breaker;
  - log redaction;
  - anonymous-conversation retention (30 days) run by the daily job.
- **Changes:**
  - `RL_AI` (12/min) becomes the in-process limiter;
  - the circuit breaker's module state is now per process instead of per isolate, which is more
    accurate.
- **Optional:** the Cloudflare AI Gateway (`AI_GATEWAY_BASE_URL`) can still be used from Railway.

---

## 11. Cloudflare's remaining role

| Cloudflare feature | Role on Railway | Plan |
|---|---|---|
| DNS | Authoritative for `vorawebsites.store`; the app records become **proxied CNAMEs** to the Railway custom-domain targets, plus Railway's TXT verification records | Free |
| Proxy / CDN | Stays in front of everything (orange cloud): edge TLS, caching of static assets, DDoS protection | Free |
| SSL/TLS | Mode **Full** — Railway documents that Full (strict) "will not work as intended". Always Use HTTPS on; minimum TLS 1.2; HSTS stays in the app. **If Railway can't issue its certificate while proxied**, the documented fix is to switch to DNS-only until it is issued. Do that on staging first. | Free |
| WAF | Cloudflare Free managed rules on. **Bot Fight Mode stays off** until tested: it can't be skipped per path on Free and could block Resend webhooks (NOT VERIFIED). | Free |
| Transform Rules (10 on Free) | 1 · set `X-Vora-Origin-Auth` to the secret · 2 · set the ASN header from `to_string(ip.src.asnum)` · managed transform "Add visitor location headers" on | Free |
| Redirect Rules | `www` → apex (today done by the `vora-websites-mark2` proxy Worker) | Free |
| Cache Rules | Optional later: short edge caching for anonymous HTML, bypassed when a session cookie is present | Free |
| Turnstile | Unchanged | Free |
| R2 | Media, private and backup buckets (§7) | Free tier |
| Access (Zero Trust) | Protects staging, with approved email addresses only, and the origin validates the JWT | Free up to 50 users (MEDIUM — marketing page) |
| Image Transformations | Optional for media | 5,000 free/month |
| Workers | **None for VORA.** The existing `vora-websites-mark2` proxy and Mark4 stay untouched until the approved cutover and the 14-day rollback window. `vora-maintenance` stays available as an emergency page. | — |
| AI Gateway | Optional | — |

**Workers is not assumed to remain the runtime** — it doesn't.

---

## 12. Railway architecture proposal

### 12.1 Diagram

```
                        Visitors (mostly Australia)
                                    │ HTTPS
                                    ▼
 ┌──────────────────────────── Cloudflare (Free) ─────────────────────────────┐
 │ DNS · edge TLS · WAF · DDoS · cache (static assets) · Turnstile             │
 │ Access (staging only) · Redirect www→apex                                   │
 │ Transform Rules → X-Vora-Origin-Auth (secret) · ASN header · location hdrs  │
 └────────────────────────────────────┬────────────────────────────────────────┘
                                      │ HTTPS, SSL mode "Full"
                                      ▼
                      Railway edge (TLS, routes the custom domain)
                                      │ HTTP :$PORT
 ┌────────────── Railway project "vora" · environment staging | production ───────────────┐
 │ Service "web" · region Singapore · 1 replica (volume) · Dockerfile · Node 24.21        │
 │                                                                                        │
 │   litestream replicate -exec ──▶ node build/server/main.js                             │
 │        │                           ├─ origin-auth + Access-JWT check (staging)         │
 │        │                           ├─ static files (build/client)                      │
 │        │                           ├─ Hono kernel ─▶ React Router SSR · API · webhooks │
 │        │                           ├─ in-process: rate limiter · background tasks      │
 │        │                           ├─ scheduler: */5 email retry · 03:17 UTC daily     │
 │        │                           └─ Argon2id: node:crypto on the libuv threadpool    │
 │        ▼                                                                               │
 │   Volume /data ── vora.db (SQLite / libSQL, WAL, foreign_keys=ON) · pre-migrate snaps  │
 └────────┬───────────────────────────────┬──────────────────────┬──────────────────────┘
          │ S3 API                        │ HTTPS                 │ HTTPS
          ▼                               ▼                       ▼
   Cloudflare R2                     Resend API             Gemini API (off by default)
   media · private · backups         (email)                (server-side key only)
```

### 12.2 Services

| Service | Needed? | Why |
|---|---|---|
| **Web** (1 per environment) | **Yes** | Runs everything. One replica — volumes don't allow replicas (DOCUMENTED). |
| Database service | **No** | SQLite runs inside the web service (§6) |
| Worker service | **No** | No queues; background work is in-process |
| Cron service | **No** | The in-process scheduler (§8); a cron service couldn't reach the volume |
| Redis / cache | **No** | The single instance makes in-process rate limiting exact |

**Project and environments:**

- one new Railway project, `vora`, with two environments: `staging` and `production`;
- **separate from the Mark4 project, which is never modified.**

**Domains:**

- `staging.vorawebsites.store` → the staging service;
- the apex and `www` → the production service, **only at the approved cutover**. Until then they
  keep pointing at the Mark4 path.
- Railway services get no `*.up.railway.app` domain unless one is generated (DOCUMENTED). Don't
  generate one, so the only public entrance is the Cloudflare-proxied custom domain.

**Region: Singapore** (`asia-southeast1`). Railway has no Australian region; the Melbourne point of
presence only receives traffic (DOCUMENTED, HIGH).

- Cloudflare serves static and cached content from Australian edges.
- Dynamic requests add the Australia↔Singapore round trip — roughly 90–110 ms. That figure is an
  estimate and NOT VERIFIED; measure it on staging.

### 12.3 Cost (estimate)

**Railway prices** (DOCUMENTED, HIGH):

| Item | Price |
|---|---|
| Hobby plan | **$5/month, which includes $5 of usage** |
| RAM | $10 per GB-month |
| CPU | $20 per vCPU-month |
| Volume | $0.15 per GB-month |
| Egress | $0.05 per GB |

**A lightly used always-on Node service**, averaging about 0.05 vCPU and 300 MB, would be about
$1 (CPU) + $3 (RAM) + cents of volume ≈ **$4 a month per environment**. Staging plus production
≈ $8, so about **$8–12/month in total** including the $5 plan fee.

- **This is an estimate, NOT VERIFIED** — actual usage decides it.
- **Set Railway's hard spending limit** (minimum $10; it takes services offline when reached) and
  an email alert *before* the first deploy.
- If Mark4's Railway account is already on Hobby and VORA shares that workspace, the plan fee may
  already be paid. Check Railway → Settings → Plan (NOT VERIFIED).
- **Cloudflare** stays on Free.
- **R2 and Resend** stay within their free tiers at launch volumes.

### 12.4 Decisions for you (nothing is bought or created until you answer)

| # | Decision | Recommendation |
|---|---|---|
| **D20** | Railway plan for VORA (a **purchase**, if not already on Hobby) | Hobby, with a hard limit around $20/month and an alert at $10 |
| **D21** | Region | Singapore (the only Asia-Pacific region); revisit if Railway adds Australia |
| **D22** | Staging protection | Cloudflare Access with named email addresses + origin JWT validation + origin-auth header |
| **D23** | Cloudflare-only tests on this branch (§13.3) | Retire them **on the Railway branch only**, each replaced by an equivalent Railway guard. They stay intact on the CP-3 branch. |
| **D24** | Database | Option A (SQLite on a volume + Litestream to R2); PostgreSQL deferred (§6.3) |
| D12 | Mark4 data (existing decision) | Unchanged question: migrate enquiries and users or not |

---

## 13. Testing

### 13.1 The existing suites and what happens to them

The baseline is CP-3 Free, recorded in `docs/VERIFICATION-LOG.md`:

- typecheck, lint;
- 200 unit/tooling tests;
- 124 integration tests in workerd;
- E2E Chromium 83/83 and HTTPS production mode 7/7;
- a mutation check (7/7 regressions caught);
- builds and dry runs;
- the CP-2.1 restore rehearsal (23/23).

| Suite | Files · `it()` blocks (runtime counts are higher where cases are generated in loops) | Runs on today | On Railway | Test files changed? |
|---|---|---|---|---|
| Unit | 13 · 134 | Node (Vitest) | Node (Vitest) | **No** — except `password-hashing.test.ts`, whose routing cases target the Durable Object: they become the same assertions against the native path (D23) |
| Integration | 14 · 124 | workerd (`@cloudflare/vitest-plugin`) | **Node Vitest**, with the runtime module aliased as `cloudflare:test` / `cloudflare:workers`. It provides `env` (SQLite, storage, limiters, mailbox) and `createExecutionContext` / `waitOnExecutionContext`, and `setup-integration.ts` applies the same migrations and seed. | **No** — test bodies byte-identical. `password-hasher.test.ts` (DO-specific) is retired under D23; its fail-closed scenarios move to the native path. `tests/support/test-worker.ts` loses its Durable Object re-export (a support file, not a test). |
| Tooling | 8 · 58 | Node | Node | `security-scan`, `e2e-matrix`: no. `deploy-config`, `deploy-guards`, `wrangler-deploy-guards`, `free-plan-config`, `predeploy-check`, `restore-prepare`: Wrangler/Cloudflare-specific — retired only under D23 with the replacements in §13.3 |
| E2E | 7 specs · 44 cases (83 runs over two projects) | Chromium; WebKit/Firefox on demand | Unchanged specs; `e2e-servers.mjs` starts three production Node servers on separate database files | **No** (spec files unchanged) |
| E2E HTTPS | 1 · 7 | `wrangler dev` with a local certificate | Node HTTPS with a local self-signed certificate, `APP_ENV=production`, an https `APP_ORIGIN` | **No** (spec unchanged) |
| Restore rehearsal | script | Wrangler local export/import | Litestream replica → fresh file → the same 23 checks | Script adapted |
| Mutation check | 7 regressions | — | Re-run: the same 7, plus new ones for FK enforcement, origin auth and the Argon2 self-test | — |

### 13.2 New tests (the Railway-specific risks)

1. **Argon2:** native vs `@noble` cross-check (random vectors), known-answer vectors, PHC round
   trip, existing hashes verify, the start-up self-test refuses a broken implementation, the
   concurrency cap answers 503 without recording an attempt.
2. **SQLite:** `PRAGMA foreign_keys = 1` on the app's connection; a foreign-key violation is
   rejected; WAL is on; `batch()` rolls back as a whole.
3. **Proxy trust:**
   - without the origin-auth header → 403 (staging/production);
   - with a forged `CF-Connecting-IP` but no auth → ignored;
   - a POST with `Origin: https://…` passes CSRF when the socket is plain HTTP (the URL is rebuilt
     from `APP_ORIGIN`);
   - `Host` and `X-Forwarded-Proto` can't change the URL.
4. **Access JWT (staging):** valid → allowed; wrong audience, expired or unsigned → refused.
5. **Logger:** exactly one line of JSON per entry, with `message` and `level`; secrets still
   redacted.
6. **Shutdown:** SIGTERM drains an in-flight request and a pending background task, then exits 0.
7. **Scheduler:** both cron strings fire `runScheduled` with the right job; no overlapping runs.
8. **Rate limiter:** limits and windows match the binding configuration (20/6/120/12 per 60 s);
   memory stays bounded.
9. **Storage adapter:** requests are signed correctly against a local S3 mock; no bucket-creation
   call exists.
10. **Migrations at start-up:** a fresh file gets all three; a second start applies none; a failing
    migration stops start-up and leaves the snapshot.

### 13.3 The Cloudflare deploy guards, restated for Railway

The replacements need your approval under D23.

| Old guard | Railway equivalent |
|---|---|
| H1 · no Turnstile test key in staging/production (checked in `wrangler.jsonc`) | Already enforced by configuration validation at start-up (unit-tested); now the only place it can live, because the variables are in Railway |
| H2 · build → security scan → pre-deploy check → deploy | `npm run deploy:check`: build → security scan → Docker build → the image runs its own configuration self-check. Railway builds from the same Dockerfile. |
| H3 · required secrets declared, and a deploy refused without them | Start-up refuses a missing secret; Railway's deploy health check (`/api/health/live`) keeps a misconfigured deploy from going live. Tested. |
| H4 · deploy must not create R2 buckets | Not applicable: nothing provisions buckets. A test asserts that the storage adapter has no create-bucket call. |
| DO bound in every environment; Free-plan limits; ≤ 2 crons | Not applicable. Replaced by: Argon2 self-test, scheduler test, `EMAIL_RETRY_BATCH` test (value 25) |
| `deploy-config`: no secrets in plain vars, separate resources per environment, no live domain before cutover | A checked-in `docs/railway/variables.md` template plus a test that the example environment file has names only, and that staging and production use different database paths and bucket names |

### 13.4 Clean-room reproducibility

- **The same check as CP-2.1/CP-3:** a fresh clone and `npm ci` from the lockfile, then typecheck,
  lint, unit, integration, build, E2E (Chromium) and E2E HTTPS.
- **Plus:** `docker build` of the production image, and a run of the image with a fresh volume
  directory.
- **What needs your Mac:** Docker, and the WebKit/Firefox browser matrix. The exact commands will
  be given at that checkpoint.
- **What can't be verified here:**
  - anything on Railway: build, deploy, the volume, draining, logs;
  - anything on Cloudflare: headers, Transform Rules, Access, certificate issuance;
  - Litestream against real R2.

  All of it is **NOT VERIFIED** until staging proves it.

---

## 14. Estimated complexity

| Work package | Days |
|---|---|
| Platform adapter + Node server entry (request rebuild, static files, execution context, shutdown) | 2–3 |
| Native Argon2 + removal of the Durable Object + tests (§5, §13.2-1) | 1–1.5 |
| Database: libSQL, PRAGMAs, migrations at start-up, snapshots, `rowsAffected`, scripts (seed, maintenance, dev users, restore) | 2–3 |
| R2 S3 adapter + dev mailbox store | 0.5–1 |
| Scheduler, background tasks, logger, health `live` | 1–1.5 |
| Origin auth, trusted headers, Access JWT validation | 1 |
| Test harness port (integration runtime module, E2E servers, HTTPS server), D23 replacements | 2–3 |
| Dockerfile, Litestream, backups, restore rehearsal, clean-room run | 1.5–2 |
| Staging bring-up with you (Railway project, variables, domain, Cloudflare rules, Access) and staging verification | 1–2 |
| **Total to a verified staging** | **12–17 working days — Medium** |
| PostgreSQL instead of SQLite (not recommended now) | +5–8 |
| Production cutover (separate approval): DNS switch, 14-day rollback window, Mark4 kept intact | 0.5–1 plus monitoring |

---

## 15. Risks and blockers

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **Railway plan purchase (D20)** — the Free plan can't serve a custom domain | Blocks staging on the real subdomain | Your decision; nothing is bought until then |
| 2 | **Volume ⇒ one instance and a short outage on every deploy.** Railway may also move Hobby services between hosts at any time, which is a redeploy (DOCUMENTED). | Seconds-to-a-minute outages | Deploy at quiet times; Cloudflare keeps serving cached assets; the health check stops a bad build going live; revisit §6.3 if it matters |
| 3 | No Australian region | +≈ 90–110 ms per dynamic request (NOT VERIFIED) | Edge caching for public pages; measure on staging |
| 4 | **Direct-to-origin bypass** (no Authenticated Origin Pulls behind Railway's TLS) | Forged client IPs; bypassing the WAF and Access | The origin-auth header is required in staging and production (fails closed); no `up.railway.app` domain |
| 5 | Misconfigured origin auth or Access validation | Every request refused | Enable on staging first, with a test checklist and a rollback (unset the Transform Rule and redeploy) |
| 6 | **SQLite foreign keys off by default; connection pool** | Silent integrity loss | `foreign_keys=ON`, `concurrency: 1`, tests (§6.4) |
| 6b | Duplicate-enquiry detection matches database error text | A retried form could create a second enquiry, or fail | The SQLite message is the same under libSQL; the existing enquiry tests must pass unchanged (§6.4) |
| 7 | Migration failure at start-up (no deploy overlap) | Downtime until rollback | Pre-migration snapshot, one transaction per file, rehearsed rollback, staging first |
| 8 | Litestream lag (~1 s) and a single replicator | Up to ~1 s of writes lost in a crash | Accepted for this scale. Railway backups + snapshots as further layers; never two replicators (no overlap with a volume). |
| 9 | Graceful shutdown defaults to 0 s | Cut-off requests and emails | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30`; start `node` directly; the outbox requeues stuck sends |
| 10 | Logs kept 7 days, no log drain on Hobby | Short forensic window | Security events and audit logs live in the database (1–2 year retention); an external log sink later if wanted |
| 11 | Config as Code deprecated (2026-12-01) | Settings silently ignored | Don't use `railway.json`; the dashboard or `.railway/railway.ts` |
| 12 | Certificate issuance behind the Cloudflare proxy | A short DNS-only window during issuance | Do it on staging first; the documented grey-cloud step |
| 13 | Mark4 shares the domain | Accidental disruption of the live site | Staging on a subdomain only; cutover is a separate approval; Mark4 and its Worker untouched for 14 days after |
| 14 | Client-IP header behaviour (MEDIUM confidence) | Wrong IPs | Use only `CF-Connecting-IP` behind origin auth; an echo check on staging |
| 15 | Argon2 needs the official Node build (OpenSSL ≥ 3.2) | Start-up failure on the wrong base image | Pinned `node:24.21.0` image; the self-test refuses to start rather than weaken |
| 16 | Argon2 memory (~19 MiB per hash) | Memory spikes under sign-in bursts | Concurrency cap of 4 + queue + 503; the per-IP and per-account throttles apply first |
| 17 | Bot Fight Mode blocking webhooks | Lost delivery events | Leave it off until tested (NOT VERIFIED) |
| 18 | Railway's hard limit takes services offline | Outage at the cap | Set it well above the estimate, with an alert at half of it |
| 19 | D23 not approved | The DO/Wrangler tests can't be retired on this branch | Alternative: keep `wrangler.jsonc` and the Durable Object code in the branch as unused files, so those tests still run unchanged. Skipping them is not offered. |

**No blocker is technical.** The blockers are decisions D20–D24 and D12, plus the account-side
steps only you can take.

---

## 16. Exact next implementation steps

**Nothing below has started.** Each checkpoint ends with a report and waits for your go-ahead.

| # | Checkpoint | Done by | Needs from you |
|---|---|---|---|
| **R0** | Review this plan and `VORA-DESIGN-SYSTEM.md`; answer D20–D24 (+ D12, D18, D19) | You | Decisions |
| R1 | Platform adapter + Node server + static files + shutdown; `npm run dev` on Node | Claude | — |
| R2 | Native Argon2 (same parameters) + remove the Durable Object + the new tests; the existing auth tests pass unchanged | Claude | — |
| R3 | libSQL + PRAGMAs + migrations at start-up + snapshots + `rowsAffected` + adapted scripts; database tests pass | Claude | — |
| R4 | R2 S3 adapter, dev mailbox, scheduler, background tasks, logger, `/api/health/live` | Claude | — |
| R5 | Origin auth + trusted headers + Access JWT validation + tests | Claude | — |
| R6 | Harness port: all unit, integration, E2E and HTTPS suites green on Node, with D23 replacements in place; mutation check re-run | Claude | — |
| R7 | Dockerfile + Litestream + restore rehearsal from a replica; clean-room run; package a verified ZIP | Claude (+ Docker/WebKit/Firefox on your Mac: exact commands supplied) | Run the given commands, paste the output |
| R8 | **Accounts (only after approval):** Railway project and environments, volume, sealed variables, hard limit; R2 buckets and scoped tokens; Cloudflare DNS, Transform Rules, Access, redirect; Resend unchanged | You, with a step-by-step checklist (like the CP-3 account checklist) | Dashboard steps, redacted outputs |
| R9 | Deploy staging; verify every NOT VERIFIED item (headers, IPs, Access, draining, logs, backups, latency, costs) | You + Claude | Sign-in tests on staging |
| R10 | Production cutover — **separate approval**; Mark4 kept for 14 days | Later | Go / no-go |

**STOP.** No Railway migration or website rebuild starts until the design artefact and this plan
have been reviewed.

---

## Appendix A — File-by-file change list (for the build; not applied)

| File | Change |
|---|---|
| `workers/app.ts` | Replaced by `server/main.ts` (Node entry) + `server/app.ts` (kernel wiring bundled by the Vite SSR build) |
| `vite.config.ts` | Remove `@cloudflare/vite-plugin`; SSR build input = the server entry; dev via Vite middleware |
| `package.json` | Drop `wrangler`, `@cloudflare/vite-plugin`, `@cloudflare/vitest-plugin`; add `@hono/node-server`, `@libsql/client`, `aws4fetch`, `croner`; `@noble/hashes` → dev dependency; `engines.node >=24.19.0`; scripts rewritten (dev, preview, e2e, db:*, backup, deploy:check) |
| `wrangler.jsonc`, `worker-configuration.d.ts`, `tsconfig.cloudflare.json`, `public/_headers` | Removed (subject to D23), or replaced by `docs/railway/variables.md` and static header code |
| `app/.server/config/env.ts` | The environment type becomes the platform env (DB, storage, limiters, mailbox) + new variables (`ORIGIN_AUTH_SECRET`, `DATABASE_PATH`, R2, Access); validation extended (fail closed) |
| `app/.server/context.ts` | Unchanged (it already receives `waitUntil`) |
| `app/.server/kernel/app.ts` | Unchanged — `c.executionCtx` comes from the adapter; the origin-auth and Access checks go in a new first middleware |
| `app/.server/lib/request-meta.ts` | Read `CF-IPCountry`, the location headers and the ASN header, instead of `request.cf`; trust only after origin auth |
| `app/.server/db/client.ts` | `drizzle-orm/libsql` on the facade's client; `runBatch` unchanged; an `affectedRows()` helper |
| `app/.server/auth/sessions.ts`, `app/.server/jobs/scheduled.ts` | `meta.changes` → `affectedRows()` (11 sites); `EMAIL_RETRY_BATCH` 10 → 25 |
| `app/.server/auth/password.ts` | `argon2idAsync` (@noble) → `crypto.argon2('argon2id')`; everything else unchanged |
| `app/.server/auth/password-hashing.ts` | Single native mode with the concurrency cap; fail-closed 503 unchanged |
| `app/.server/auth/password-hasher.ts` | Removed (the Durable Object) |
| `app/.server/services/rate-limit.ts` | Unchanged (`ctx.env[limiter].limit({ key })` is supplied by the in-process limiter) |
| `app/.server/services/health.ts` | Unchanged calls (`env.DB`, `env.MEDIA.head`); plus `/api/health/live` |
| `app/.server/email/transport.ts`, `app/.server/api/routes.ts` | Unchanged (the dev mailbox store keeps the KV-style interface) |
| `app/.server/observability/logger.ts` | One-line JSON with `message` |
| `server/platform/*` (new) | `sqlite.ts` (client, PRAGMAs, migrations, snapshot), `storage-r2.ts`, `rate-limiter.ts`, `background.ts`, `scheduler.ts`, `trust.ts` (origin auth, Access JWT, request rebuild), `mailbox.ts` (dev only) |
| `scripts/seed.ts`, `maintenance.ts`, `dev-users.ts`, `backup-export.ts`, `restore-*.ts`, `predeploy-check.ts`, `e2e-*.mjs`, `https-server.mjs` | Wrangler calls replaced by libSQL-file operations, Litestream and Node servers |
| `vitest.integration.config.ts`, `tests/support/*` | Node pool; aliases `cloudflare:test` / `cloudflare:workers` → `tests/support/node-runtime.ts`; the test files are unchanged |
| `Dockerfile`, `.dockerignore`, `litestream.yml` (new) | Reproducible image, Litestream to R2 |
| `docs/runbooks/*` | Railway deployment, backup/restore, secrets and cutover runbooks (replacing the Wrangler sections) |

## Appendix B — Environment variables

See §4.10. A names-only template will live at `docs/railway/variables.md`, with no values — the
same rule as `.dev.vars.example`.

## Appendix C — Sources

These were checked on 29 September 2026. Confidence is as reported by the research, per item.

- **Railway:**
  - plans and pricing: docs.railway.com/pricing/plans · /pricing/free-trial · /pricing/cost-control · railway.com/pricing
  - volumes and backups: docs.railway.com/volumes/reference · /volumes/backups
  - cron: docs.railway.com/cron-jobs
  - private networking: docs.railway.com/networking/private-networking/how-it-works
  - regions: docs.railway.com/deployments/regions · /networking/edge-networking · station.railway.com/questions/hosting-locations-in-australia-37ebabc6
  - domains and Cloudflare: docs.railway.com/networking/domains/working-with-domains · /networking/troubleshooting/ssl
  - builds and configuration: docs.railway.com/builds/dockerfiles · /infrastructure-as-code · /config-as-code/reference
  - deployments: docs.railway.com/deployments/healthchecks · /deployments/reference · /deployments/restart-policy
  - logs: docs.railway.com/observability/logs
  - variables: docs.railway.com/variables
  - proxy limits: docs.railway.com/networking/public-networking/specs-and-limits
  - PostgreSQL: docs.railway.com/databases/postgresql · /volumes/point-in-time-recovery
  - client IP: station.railway.com/questions/get-real-client-ip-behind-cloudflare-pro-5a19732f
- **Node.js:**
  - `crypto.argon2`: https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoargon2algorithm-parameters-callback
  - releases: https://nodejs.org/en/about/previous-releases
  - changelog: https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V24.md
- **Cloudflare:**
  - headers to the origin: https://developers.cloudflare.com/fundamentals/reference/http-headers/
  - managed transforms: https://developers.cloudflare.com/rules/transform/managed-transforms/reference/
  - request header rules: https://developers.cloudflare.com/rules/transform/request-header-modification/
  - protect your origin: https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/
  - SSL modes: https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/
  - Authenticated Origin Pulls: https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/
  - Images pricing: https://developers.cloudflare.com/images/pricing/
  - R2 S3 API: https://developers.cloudflare.com/r2/api/s3/api/
  - R2 tokens: https://developers.cloudflare.com/r2/api/tokens/
  - R2 pricing: https://developers.cloudflare.com/r2/pricing/
  - Turnstile server-side validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
  - Access for a public origin: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- **Libraries:**
  - Drizzle batch: https://orm.drizzle.team/docs/sqlite/batch-api
  - Drizzle with libSQL: https://orm.drizzle.team/docs/sqlite/connect-turso
  - libSQL client: https://docs.turso.tech/sdk/ts/reference
  - Litestream: https://litestream.io/guides/s3-compatible/ · https://litestream.io/reference/restore/ · https://litestream.io/guides/docker/
  - Hono Node server: https://github.com/honojs/node-server · https://hono.dev/docs/api/context
  - React Router: https://reactrouter.com/api/other-api/adapter

## Appendix D — Local verification done for this plan

| Check | How | Result |
|---|---|---|
| Argon2id: native = current library | Node 24.21.0 (official build from npm `node-linux-x64@24.21.0`, in scratch space, not the project). 20 vectors (ASCII, NFKC-changed Unicode, empty, 256 chars, emoji, random). `@noble/hashes` 2.4.0 `argon2idAsync` vs `crypto.argon2('argon2id', { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 })` | **VERIFIED LOCALLY:** 20/20 identical |
| Argon2id speed and threading | Same run | Mean 249 ms (`@noble`) vs 30 ms (native); 8 concurrent native hashes 116 ms wall (4 pool threads); event loop kept ticking during a hash |
| Node OpenSSL | `process.versions.openssl` | 3.5.8 (≥ 3.2 required) |
| React SSR on Node | `require('react-dom/server.node')` in the CP-3 dependencies (react-dom 19.3.0) | `renderToReadableStream` exported |
| Cloudflare surface | `grep` of `app/`, `workers/`, `shared/`, `scripts/`, `tests/` for bindings, `cloudflare:*`, `request.cf`, `cf-*` headers, `waitUntil`, `meta.changes`, `d1_migrations`; claims then re-checked by an independent read-only pass | 27 items (§2); 11 `meta.changes` sites; 6 scripts run Wrangler, 3 more depend on it, 9 npm scripts call it |
| Schema facts | Migration SQL | 52 tables, 9 triggers, 76 foreign-key references, CHECKs using `json_valid` 19 · `glob` 13 · `length()` 10 · `like` 4 |
| No implementation change | `git diff --stat` on `railway-migration` against the CP-3 baseline commit | Only files under `docs/` added (see the delivery report) |
