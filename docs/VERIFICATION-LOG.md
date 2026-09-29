# VORA — Verification log

Rule: **IMPLEMENTED → TESTED → VERIFIED.** A checkpoint records exactly what was run, where, the
result, and what it does and does not prove. Anything not actually run stays **NOT VERIFIED**.
No checkpoint on its own means “production ready”.

Environments: **your machine** (your runs, as you reported them) · **build sandbox** (Linux
cloud workspace used for development; no Cloudflare credentials, preinstalled Chromium 1194).

---

## CP-0 — Phase 1 foundation · 26 Sep 2026 · build sandbox

| Check | Result |
|---|---|
| `npm run typecheck` · `npm run lint` · `npm run build` | PASS |
| `npm run test:unit` | PASS — 110/110, 8 files |
| `npm run test:integration` | PASS — 111/111, 11 files |
| `npm run test:e2e` (production build in workerd, Chromium desktop + Pixel 7) | PASS — 58/58 |
| Clean-room: delivered zip, fresh `npm ci`, no `.dev.vars`, no local state → verify + E2E | PASS |

Details: `docs/02-PHASE1-REPORT.md`.

---

## CP-1 — Integration suite · 27 Sep 2026 · **your machine**

**Result as you reported it:** 11/11 test files passed · 111/111 tests passed · 0 failed ·
Vitest v4.1.11 · total duration 16.46 s · stderr output present and expected.

### Independent confirmation (build sandbox, same commit)

| Check | Finding |
|---|---|
| Re-run with JSON reporter | 111 passed · 0 failed · 0 skipped · 0 pending · 0 todo · `success: true` (59.3 s here) |
| Declared vs executed | 111 `it(...)` declarations across the 11 files = 111 executed; no generated or conditional tests |
| Skips / focus | no `.skip`, `.only`, `.todo`, `skipIf`, `runIf`, `fails`, `xit`, `xdescribe` anywhere in `tests/` |
| Suppression in config | no `retry`, `bail`, `allowOnly`, `passWithNoTests`, `silent`, `onConsoleLog`, `dangerouslyIgnoreUnhandledErrors` |
| Unhandled errors | none reported |
| Assertions that could be bypassed | the 4 early `return`s in tests each follow a hard assertion of the same condition (type narrowing only); the one `try` in the integration suite is `try/finally` (failures propagate); the unit suite's two `try/catch` blocks assert on what they catch |

### Guards added so this stays true (test tooling only — no application change)

- Vitest `expect.requireAssertions: true` (unit + integration): a test with no assertion now
  **fails**. Proven with a throwaway probe test (failed as intended, then deleted).
- Biome `noFocusedTests` and `noSkippedTests` as errors: `npm run lint` rejects `.only`/`.skip`.
  Proven with a throwaway probe (rejected, then deleted).
- Re-run with the guards: unit 110/110, integration 111/111 — PASS.

### stderr review

Normal runs log at `error` level only (`LOG_LEVEL=error` in the test bindings): **33 entries,
every one produced deliberately by a named test.** A one-off run at `warn` level (config copy,
deleted afterwards) added 18 more groups — all security events or the AI budget warning, each
again produced by a named test.

| Output | Produced by | Verdict |
|---|---|---|
| `security_event` (`auth.setup.rejected`, `auth.owner.bootstrapped` — high severity) | bootstrap test (wrong setup token, then success) | intentional |
| `security_event` warn-level: `authz.denied` ×21, `csrf.rejected`, `rate_limit.exceeded`, `auth.login.locked`, `auth.ip.blocked`, `auth.mfa.failed_limit`, `roles.changed`, `spam.detected`, `turnstile.failed`, … | the authorisation, CSRF, lockout, stuffing, 2FA, role, spam and Turnstile tests | intentional — denials are recorded as designed |
| `ai_request_failed` (unavailable ×2, malformed ×5, timeout, blocked), `ai_not_configured`, `ai_daily_budget_reached` | AI failure-mode, circuit-breaker, missing-key and budget tests | intentional (simulated provider failures) |
| `email_retry_scheduled` ×6, `email_dead` ×2, `email_send_failed` ×2 | outbox retry/dead-letter and sensitive-mail tests (scripted transport failures) | intentional |
| `configuration_invalid` ×2 | fail-closed configuration test | intentional — logs the **key name and rule only** (`AUTH_SECRET must be at least 32 characters`), never the value |
| `unhandled_error` + `request` (500) | generic-500 test (throws on purpose) | intentional |
| `api_error` + `request` (503) during maintenance | maintenance tests | intentional — see observation O-1 |
| `setting_invalid_using_default` | corrupt-setting test | intentional |
| `job_failed` | failing-job probe | intentional |
| Wrangler “Proxy environment variables detected” | build sandbox proxy | sandbox-only, not the app |
| `DEP0040 punycode` deprecation | traced to `node_modules/wrangler/wrangler-dist/cli.js` | toolchain only, never shipped in the Worker |
| “Using secrets defined in .dev.vars” | Wrangler reading config | informational; the test bindings override `.dev.vars` (verified) |

**No hidden failure-path diagnostics** in either run: no `session_touch_failed`,
`security_event_store_failed`, `ai_usage_record_failed`, `health_*_failed`,
`email_delivery_crashed`, `rate_limiter_unavailable`, `flag_evaluation_failed` or
`maintenance_state_unreadable` — i.e. no passing test is masking an infrastructure error.

### Observations (recorded, **not changed** — working behaviour, your call)

- **O-1 · Maintenance 503s are logged at `error` level** (`request` + `api_error`). Correct
  behaviour for users, but during planned maintenance every request would count as an error in
  Workers Logs and could trip alerts. Suggested: log maintenance responses at `info` with
  `maintenance: true`. Not changed, because it alters log output you asked to keep.
  → Decided and implemented in CP-2.1 (below).
- **O-2 · Error messages are logged verbatim.** Keys like `password`/`token` are redacted, but
  message *text* is not scrubbed — the generic-500 test's fake `password=hunter2` appears in its
  log line (it never reaches the client, which the test asserts). The application's own messages
  never contain secrets and provider errors are wrapped, so the risk is low; a value-pattern
  scrubber (`password=`, `Bearer `, `re_…`, `AIza…`) is recommended before launch.
  → Decided and implemented in CP-2.1 (below).
- **O-3** Warn-level security events are hidden by the tests' `LOG_LEVEL=error`; use a
  warn-level run to review them.
- **O-4** In non-interactive shells Vitest's default reporter may hide console output of passing
  tests; `--reporter=verbose` shows it.

### What CP-1 verifies

The automated integration suite: services, kernel, auth, RBAC, email outbox, enquiries, AI
guard rails, health, jobs and database constraints, running in workerd against
Miniflare-simulated D1, KV, R2 and rate limiters with the real migrations and seed.

### What CP-1 does **not** verify (still NOT VERIFIED)

Deployment · real Cloudflare bindings (D1/R2/rate limits on the network) · Resend delivery ·
Gemini connectivity · production auth configuration (HTTPS `__Host-` cookie on the real domain,
Cloudflare Access) · browser E2E **on your machine** · accessibility beyond automated checks ·
performance · the final 3D experience.

---

## CP-2 — Security verification of the production build · 27 Sep 2026 · build sandbox

**Why this phase next.** The integration suite drives services and the kernel through a stub
page renderer, so the real React Router loaders and actions, their single-fetch data URLs,
static-asset serving and the client bundles had only been touched by a few E2E flows. Security
is the highest-risk area and it can be verified locally without your accounts.

**How.** A new Playwright suite (`tests/e2e/security.spec.ts`) runs against the production build
in workerd (`vite preview`) with a throwaway database and its own users (`*.sec@vora.test`, so
sign-in codes, cooldowns and rate limits never interfere with the other suites). Every fix below
was preceded by a test that failed on the old behaviour.

| # | Check | Result |
|---|---|---|
| 1 | Authorisation matrix, page requests: 8 protected routes × 7 identities (anonymous + 6 roles) = 56 requests, exact expected outcome (200 / 403 / 302 → `/login?next=`) | PASS |
| 2 | Same guards on single-fetch data URLs (`<route>.data`): refused responses carry no other user's data and no records | PASS |
| 3 | Private pages **and their `.data` URLs** are `private, no-store` + `noindex` | **FAIL → fixed (S-1) → PASS** |
| 4 | Actions re-check permissions server-side: invite POSTed as staff/member/client → 403, anonymous → sign-in; no invitation email produced | PASS |
| 5 | CSRF: 16 state-changing endpoints × {admin session, anonymous} × {foreign `Origin`, `Sec-Fetch-Site: cross-site`} = 64 requests → 403; credentialed request with neither header → 403; admin session unaffected | PASS |
| 6 | Session fixation (planted cookie never adopted, planted token rejected); `GET /logout` does not sign out; real sign-out kills the token server-side | PASS |
| 7 | Open redirect: 7 hostile `next` values (absolute, protocol-relative, backslash, `javascript:`, CRLF…) always fall back to an internal page; a legitimate internal `next` is honoured | PASS |
| 8 | Forgot-password: identical status and visible text for known and unknown emails | PASS (timing: see S-4) |
| 9 | `/setup` closed (GET and POST 404) once an Owner exists; invalid reset/invite links reveal nothing | PASS |
| 10 | Stored XSS: hostile name, company and message rendered as text in the admin list and detail — no script execution, no injected elements, no dialogs, no un-nonced scripts | PASS |
| 11 | Security headers on 11 kinds of Worker response (page 200/404/403, redirects 302/301, API 200/404/401, robots, sitemap, `.data`) | PASS |
| 12 | Static assets carry `X-Content-Type-Options: nosniff` | **FAIL → fixed (S-3) → PASS** |
| 13 | CORS: no `Access-Control-Allow-Origin` for foreign origins (request and preflight) | PASS |
| 14 | Server files and secrets unreachable over HTTP (`/.dev.vars`, `/wrangler.json`, server bundle, `/_headers`, `/.git/config`, path traversal …) | PASS |
| 15 | Client bundles: no server-only code markers, none of the running server's secret values, no source maps | PASS |

Also in this phase:

| Check | Result |
|---|---|
| `npm run security:scan` (new): every committable file (196) + `build/client` (61 files); also works in an unzipped copy without git | PASS — no findings. The scanner itself is tested with planted credentials, the ignore rules and its command line (9 tests). `deploy:staging` / `deploy:production` now run it between build and upload and stop on any finding |
| Deployment configuration guard rails (8 tests): no secrets in vars, `workers_dev`/preview URLs off, https origins, Resend in staging/production, no dev mailbox outside local, no shared databases/buckets/rate-limit namespaces, production not yet attached to the live domain | PASS |
| `npm audit --omit=dev` (what ships) | PASS — 0 vulnerabilities |
| `npm audit` (including dev tools) | 4 moderate, all one chain: `drizzle-kit` → `@esbuild-kit/*` → old `esbuild` (its *dev-server* advisories). Dev-only, never shipped, drizzle-kit does not run that server; npm's suggested “fix” is a major downgrade of drizzle-kit. **Accepted**, revisit when drizzle-kit drops `@esbuild-kit`. |

### Findings (all fixed before this checkpoint)

- **S-1 · Medium · private data cacheable at `.data` URLs.** React Router loads page data for
  client-side navigation from `<page>.data` (`/account.data` returns the signed-in person's
  name, email and sessions). The kernel's path policy only recognised `/account`, so these
  responses had no `Cache-Control` — a shared proxy or the browser's cache could keep personal
  data. **Fix:** `pagePath()` maps data URLs to their page for all path policy
  (`app/.server/lib/paths.ts`). **Tests:** 3 unit, 1 integration, E2E #3 — the unit and
  integration tests were run against the old behaviour and failed as expected.
- **S-2 · Medium (availability) · staff could not sign in during maintenance with JavaScript on.**
  The sign-in form posts to `/login.data`, which the maintenance gate did not exempt (only
  `/login`). **Fix:** same mapping. **Tests:** unit + integration (failed before the fix).
- **S-3 · Low · static assets without `nosniff`.** Files served by Workers Static Assets never pass
  through the Worker, so the kernel's headers did not reach them. **Fix:** `public/_headers`.
  **Test:** E2E #12. *On Cloudflare itself: NOT VERIFIED until the staging smoke test.*
- **S-4 · Medium · account enumeration by timing on “forgot password”.** Known addresses created
  a token and sent the email inside the request. Measured locally over 8 alternating pairs:
  median **27.9 ms (known) vs 16.7 ms (unknown)**, every known sample slower; in production each
  known address would add a full email-provider round trip. **Fix:** the account work runs after
  the response (`requestPasswordResetInBackground`). **After:** 16.5 ms vs 20.9 ms (known no
  longer slower) and 8/8 reset emails still delivered. **Tests:** integration (the call returns
  before any account work, which then completes) + the measurements above; E2E #8 for content.

- **S-5 · tooling · the new scan could not run on a fresh copy.** Found by the clean-room run of
  the package: the scanner's `--env-file` option collides with Node's own flag, so without a local
  `.dev.vars` Node aborted — and the deploy scripts, which now run the scan, would have stopped.
  **Fix:** renamed to `--secrets-from`. **Test:** a command-line test run in a git-less temp
  folder; it fails with the old flag (exit 9) and passes with the new one.

### Totals at CP-2 (build sandbox — one consolidated run after the last change)

| Suite | Result |
|---|---|
| typecheck · lint · build | PASS |
| Unit + tooling | 130/130 (110 before + 3 path + 9 scanner + 8 deploy-config) |
| Integration | 114/114 — the **111 CP-1 tests unchanged (files byte-identical to the checkpoint) and passing** + 3 hardening tests |
| E2E | 73/73 — 58 before + 15 security (desktop 49, mobile 24) |
| Security scan | no findings |
| Clean-room: the delivered zip unpacked fresh (no git, no `.dev.vars`, no local state) → `npm ci`, `npm run verify`, `npm run test:e2e`, `npm run security:scan` | PASS — 130 · 114 · build · 73 · no findings |

### What CP-2 verifies

The access-control, CSRF, session, redirect, enumeration, XSS, header, CORS and exposure
behaviour of the **built application as served by workerd**, plus the repository, the client
bundle and the deployment configuration files.

### Still NOT VERIFIED

Everything that needs Cloudflare or real providers: deployment, real bindings, `_headers` on
Cloudflare's asset service, HTTPS-only behaviour (`__Host-` cookie, HSTS) on the real domain,
Cloudflare Access, Resend, Turnstile, Gemini, cron triggers, restores · E2E on your machine ·
other browsers (Safari/WebKit, Firefox) · manual accessibility · performance · the 3D experience.
A penetration test by an independent party is recommended before launch.

---

## CP-2.1 — Local checks and deployment safety · 27 Sep 2026 · build sandbox

**Baseline:** CP-2 (`vora-cp2-security-verified.zip`, SHA-256 `4cda2a45…dc43a`), unchanged.
Workers Paid was not purchased; nothing was created on Cloudflare and nothing was deployed.
Every Cloudflare-facing check below ran against local simulations only.

### A — Local checks

| Item | What was done | Result |
|---|---|---|
| A1 · `/setup` first-Owner flow | `tests/e2e/setup.spec.ts` on two extra preview servers with empty databases. :5174 (7 steps, in order): form open + axe; wrong token refused, nothing created; server-side password rules (email in password, mismatch); correct token → 10 distinct codes shown once, `vora_session` HttpOnly/Lax, continue → `/admin`, `/admin/users` 200; `/setup` 404 afterwards and a replayed token cannot create a second Owner; Owner signs in with password + emailed code; a recovery code works once (email notice "9 left"), is refused the second time, and another code works. :5175: the same flow with JavaScript off | **PASS 8/8** |
| — finding F-1 (fixed) | A successful setup **never showed the recovery codes**: the route's loader re-ran after the action, saw the new Owner and answered 404. With JavaScript the page switched to "This page doesn't exist"; without JavaScript the response was a 404 and the session cookie was lost too. The Owner was created, but the one-time codes were gone. **Fix** (`app/routes/auth/setup.tsx`): a request-scoped marker lets the loader skip the check in the request that completed setup, and `shouldRevalidate` stops the browser re-checking after a successful setup. **Proof:** with the fix reverted, tests 4 and the no-JavaScript test fail; with it, all pass | fixed + tested |
| A2 · export / restore rehearsal | `npm run db:restore-rehearsal`: fresh local database → real activity through the production build (Owner via `/setup`, enquiry, failed + successful sign-in) → `wrangler d1 export --local` → import into a **fresh, empty** database → compare tables, indexes, triggers and their SQL, every table's row count + SHA-256, `sqlite_sequence`, migrations; `quick_check`, `foreign_key_check`; triggers still refuse audit/security edits and removal of the last Owner; the app on the restored database: `/setup` closed, Owner signs in with password + a recovery code issued before the export, enquiry listed in `/admin/enquiries` | **PASS** — 23 passed, 0 failed, 2 informational; 53 tables, 266 rows, export 94,759 bytes; 47 s |
| — finding F-2 (procedure fixed) | The runbook's restore (§3.2) **fails on an unmodified export**: `no such table: main.users`. Exports list tables in creation order with their rows, and `0000_initial_schema.sql` creates tables that reference `users` before `users`. New `npm run db:restore-prepare` reorders the statements (tables → rows, parents first → indexes/triggers), never edits one, and refuses anything an export does not contain. Runbook §3.2 and §5 updated; §6 documents the rehearsal | fixed locally; remote NOT VERIFIED |
| A3 · production mode over HTTPS | `npm run test:e2e:https`: the build under `wrangler dev --local-protocol https --upstream-protocol https` with APP_ENV=production, an https origin, random throwaway secrets, email disabled, cf.json download off. Checks HSTS (`max-age=63072000; includeSubDomains; preload`) on pages and API, CSP with `upgrade-insecure-requests`, no `X-Robots-Tag` on public pages, `noindex` + `no-store` on private ones, `/api/dev/mailbox` and `/setup` 404, `nosniff` on assets, and the session cookie: raw `Set-Cookie` is `__Host-vora_session` with Secure, HttpOnly, SameSite=Lax, Path=/, no Domain; in the browser it is host-only and invisible to scripts; `/member` and `/member.data` are `private, no-store`; sign-out removes it; cross-site posts are refused | **PASS 7/7** (Chromium) |
| A4 · WebKit (Safari engine) and Firefox | `E2E_BROWSERS=all` adds `webkit`, `mobile-webkit` (iPhone 14) and `firefox` projects mirroring desktop/mobile (57 · 24 · 57 tests listed), plus `https-webkit`/`https-firefox` (7 each). `npm run test:e2e:browsers` runs each engine in its own invocation (fresh servers and databases) | configuration PASS (listing + tooling test); **runs NOT VERIFIED** — only Chromium exists in the sandbox; run on your Mac |

### B — Deployment safety

| Item | Change | Tests |
|---|---|---|
| H1 | Cloudflare's Turnstile test keys (5 site keys, 3 secrets, and the `[1-3]x000…` shape) are refused in staging/production by config validation (fails closed); the verifier no longer relaxes hostname/action checks for test secrets there; the pre-deploy check refuses a test site key | `turnstile-test-keys` (8), `deploy-guards`, `predeploy-check` |
| H2 | `scripts/predeploy-check.ts`, run by every `deploy:*` script after the build and security scan: wrong environment, name or routes, workers.dev/preview URLs, `REPLACE_WITH_` placeholders, localhost / `http://` references, dev mailbox or any KV, debug logging, non-Resend email, test site key, non-UUID D1 ID, secrets as vars, required-secret declaration. Prints field names only | `predeploy-check` (13) |
| H3 | `secrets.required` (AUTH_SECRET, RESEND_API_KEY, TURNSTILE_SECRET_KEY) in `env.staging` and `env.production` of `wrangler.jsonc`. Verified with **Wrangler 4.141.0** against a local mock of the Cloudflare API: a new Worker is refused before upload; an existing Worker uploads `inherit` bindings only (never secret values) and a missing secret is refused (API code 10057). Also makes type generation deterministic | `wrangler-deploy-guards` (8), `deploy-guards` (10) |
| H4 | `wrangler deploy --experimental-provision=false` in all deploy scripts. Verified with 4.141.0: without it a missing R2 bucket is created silently (control test); with it, it never is | `wrangler-deploy-guards`, `deploy-guards` |
| Runbook | `deployment.md` corrections P5 1–9 from the CP-3 readiness review; `scripts/backup-export.ts` header (wrangler login works). `CP3-READINESS.md` and `CP3-SETUP-CHECKLIST.md` unchanged | — |
| O-1 decided | The planned maintenance 503 is logged at `info` with `maintenance: true` (request line and `api_maintenance`); every other 5xx, including a 503 from a configuration or database failure, stays `error`. Reason: planned maintenance must not trip error alerts; real outages must | `log-decisions`, `observability-decisions` (workerd) |
| O-2 decided | Free-text credentials in log output (error messages, stacks) are scrubbed by value pattern: private keys, Bearer/Basic, JWTs, Resend/Google/GitHub keys, Turnstile secrets, `vora_session=`, `password=`/`secret:`, credential-like `token=`/`api_key=`, sign-in codes. Email addresses are kept (needed for delivery support) | same |

Other changes: the E2E harness starts its preview servers one after another (they otherwise race
for the same debugger port); `PW_CHROMIUM_PATH` now applies to Chromium projects only; two
`tsc -b` errors introduced earlier in CP-2.1 (a type import in `setup.tsx`, unchecked indexing in
`predeploy-check.test.ts`) were fixed before the gate — Vitest does not type-check.

### Totals at CP-2.1 (build sandbox — one consolidated run after the last code change)

| Suite | Result |
|---|---|
| typecheck · lint (194 files) · build | PASS |
| Unit + tooling | 187/187, 18 files — the 130 CP-2 tests (files unchanged) + 57 new |
| Integration | 117/117, 13 files — 114 CP-2 + 3 new |
| Original CP-1 set, run alone | 111/111, 11 files, 47.9 s |
| E2E (production build in workerd, Chromium) | 81/81 — desktop 57 (15 security, 8 setup), mobile 24 |
| E2E, production mode over HTTPS (Chromium) | 7/7 |
| Restore rehearsal | PASS — 23 passed, 0 failed, 2 informational |
| `security:scan` | no findings — 216 committable files, 61 bundle files |
| `deploy:staging:dry-run`, `deploy:production:dry-run` (this tree) | stop at the pre-deploy check with the 3 expected placeholder problems each; nothing uploaded — expected until CP-3 |
| The same dry runs on a temporary copy with fake IDs and site keys | PASS through build, scan, pre-deploy check and `wrangler deploy --dry-run` (correct bindings, no KV) |
| `npm audit --omit=dev` · `npm audit` | 0 · 4 moderate (the accepted dev-only drizzle-kit chain from CP-2; no dependency changes) |
| Existing tests | `git diff cp-2 -- tests/`: additions only — no existing test file modified, skipped or removed |
| CP-2 checkpoint | zip SHA-256 and timestamp unchanged; the CP-2.1 baseline commit is byte-identical to the zip (196 files) |
| Clean-room: the checkpoint's files unpacked fresh (no git, no `.dev.vars`, no local state) → `npm ci`, `npm run verify`, `npm run test:e2e`, `npm run test:e2e:https`, `npm run db:restore-rehearsal`, `npm run security:scan`, matrix listing | PASS — 187 · 117 · build · 81 · 7 · rehearsal 23/0/2 · no findings · 219 tests listed across the 5 projects; type generation reproduced `worker-configuration.d.ts` byte for byte |

### Still NOT VERIFIED

- **WebKit and Firefox runs** (A4) — on your Mac: `npx playwright install webkit firefox`, then
  `npm run test:e2e:browsers` and `npm run test:e2e:https:browsers`.
- **Anything on a Mac** — every CP-2.1 run was in the Linux build sandbox.
- **Everything on Cloudflare** (blocked by Workers Paid): deploys; H3/H4 against the real API
  (simulated here with a local mock); importing a prepared export into a real D1 database;
  HTTPS behaviour at the edge (HSTS, `__Host-` cookie, `_headers`) on the real domain; Access,
  Resend, Turnstile, Gemini, cron triggers.
- The `http://`-Origin CSRF case over HTTPS: `wrangler dev`'s local proxy rewrites same-host
  URLs in request headers whatever the scheme, so it is covered by the unit test only.

Expected output in the HTTPS run: about ten `✘ [ERROR] error accepting tls connection …
CERTIFICATE_UNKNOWN` lines from workerd while the browser test runs. They are handshakes
Chromium aborts against the self-signed development certificate before its certificate-error
override applies; a diagnostic session showed no request failing for that reason and no
response ≥ 400. Left visible, not suppressed.


## CP-3 Free — Cloudflare Free plan audit and adaptation · 29 Sep 2026 · build sandbox (current checkpoint)

Scope: keep VORA on Cloudflare Workers Free where it can run securely, and say plainly where it
cannot. Full report, measurements, classification and sources: `CLOUDFLARE-FREE-COMPATIBILITY.md`.
Nothing was deployed, created or purchased; the CP-2 and CP-2.1 checkpoints are untouched. The
verified skip-link fix (WebKit Tab order; your Mac: WebKit + Mobile WebKit 83, Firefox 59, HTTPS
Firefox 7) is included.

### Changes

| Item | Change | Tests |
|---|---|---|
| F-1 password hashing | Argon2id (unchanged code and parameters) runs in the `PasswordHasher` Durable Object (SQLite-backed, stateless, binding-only). The Worker accepts only exact policy-strength hashes and boolean verify results; any failure is a 503 before anything is recorded — no fallback, no weaker hash, no lockout counting. Unknown emails verify against a fixed policy-strength dummy hash (one hash of work, as for a real account) | `password-hashing` (7, unit), `password-hasher` (7, workerd); every existing integration auth test now hashes through the real object |
| F-2 single-use tokens | Reset and invitation hash before consuming their token; setup hashes before its insert and outside the "already completed" catch — an outage leaves them usable for a retry | `password-hasher` |
| F-3 sign-in outage message | `/login` answers a hashing outage with 503 and a clear message; every other error is unchanged | E2E auth suite (normal paths) |
| F-4 `limits.cpu_ms` | removed — a Free account refuses the whole deploy while it is set; 30 s is Paid's default | `free-plan-config` (5, tooling) |
| F-5 Drizzle instance reuse | one instance per D1 binding instead of one per request: −0.3 to −1 ms CPU per request (A/B, 3×60 requests per route) | full integration + E2E suites |
| F-6 email retry batch | 25 → 10 per five-minute run: at most 24 D1 queries (Free limit 50; 25 could reach 54) | `free-plan-limits` (1, unit); job delivered 10 per run against a 30-email backlog |
| Docs | this entry; `CLOUDFLARE-FREE-COMPATIBILITY.md`; deployment §0 (plan), backup (Time Travel 7 days on Free), architecture note, checklist, README | — |

`tests/support/test-worker.ts` gained one line exporting `PasswordHasher` (the integration entry
needs it because `wrangler.jsonc` binds the class); no existing test file was modified, skipped or
removed.

### Totals (build sandbox — after the last code change)

| Suite | Result |
|---|---|
| `npm run verify` — typecheck · lint (201 files) · unit + tooling · integration · build | PASS — 200/200 (187 existing + 13 new) · 124/124 (117 existing + 7 new) |
| E2E, production build in workerd (Chromium) | 83/83 — sign-in, two-step, setup (with and without JavaScript) through the Durable Object |
| E2E, production mode over HTTPS (Chromium) | 7/7 |
| Mutation check — 7 deliberate regressions (cpu_ms back, token burned before hashing ×2, setup hash inside the catch, weak hash accepted, burn via in-process dummy, outage treated as a wrong password) | 7/7 caught by the new tests |
| Staging and production builds → `wrangler deploy --dry-run --experimental-provision=false` | PASS — bindings listed include `env.PASSWORD_HASHER (PasswordHasher) Durable Object`; 1,566.86 KiB uncompressed |
| Pre-deploy check, staging and production | only the 3 expected `REPLACE_WITH_` placeholder problems each |
| `wrangler check startup` (local) | 32.6 ms active of a 1 s limit |
| `security:scan` · `npm audit --omit=dev` | no findings (224 files, 61 bundle files) · 0 vulnerabilities; no dependency changes |
| CPU measurements (local workerd) | see the report §2 and §4 |
| Clean room: the checkpoint's 224 files unpacked fresh (no git, no `.dev.vars`, no local state) → `npm ci`, `npm run verify`, `npm run test:e2e`, `npm run test:e2e:https`, `npm run security:scan` | PASS — 200 · 124 · build · 83 · 7 · no findings; type generation reproduced `worker-configuration.d.ts` byte for byte and no source file changed |
| Patch check | `vora-cp3-cloudflare-free.patch` applied to the frozen CP-2.1 zip reproduces this tree exactly |
| CP-2 / CP-2.1 checkpoints | zip SHA-256 values and timestamps unchanged |

### Still NOT VERIFIED

- **Everything on Cloudflare** — no deploys. In particular: the Durable Object's CPU allowance on a
  Free account (documented as 30 s, no Free exception listed); the Worker's real CPU per request
  (local: signed-in flows 15–50 ms without hashing, public pages 7–17 ms, first request per
  isolate ~70–80 ms — against 10 ms); whether the Rate Limiting binding is available on Free; the
  account's existing cron-trigger count; whether Zero Trust sign-up asks for a payment method.
- WebKit and Firefox were not re-run: the CP-3 changes are server-side only.
