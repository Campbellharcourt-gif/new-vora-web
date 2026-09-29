# Cloudflare Free plan — compatibility report (CP-3)

29 September 2026 · Baseline: CP-2.1 (`cp-2.1`, 6079373) plus the verified skip-link fix · Nothing
was deployed, created or purchased on Cloudflare. Items that can only be settled on Cloudflare are
marked **NOT VERIFIED**.

## Verdict

- **Password hashing** was the documented reason for Workers Paid. No OWASP-strength password hash
  fits the Free plan's 10 ms of CPU per request: the cost *is* the protection (§2). It is now run in
  a Durable Object — the same Argon2id code and parameters — which the Workers docs recommend for
  expensive computation and which documents a 30 s CPU allowance per invocation (§3). Whether a
  Free account really grants that is **NOT VERIFIED** (local workerd enforces no CPU limits).
- **That alone does not make VORA fit Free.** Without any hashing, the Worker's own CPU per request
  was measured locally at 28–43 ms for the sign-in code step, ~27–55 ms for a password sign-in and
  15–21 ms for the admin dashboard; public pages 7–17 ms; the first page after an isolate starts
  ~70–80 ms (§4). Cloudflare's own limits page says authentication and server-side-rendering
  workloads "typically use 10-20 ms". Local hardware differs from Cloudflare's, but the gap for the
  signed-in flows is 2–4×.
- **So the full CP-3 deployment cannot realistically run on Cloudflare Free.** The public site may
  fit (NOT VERIFIED); sign-in, two-step verification and the portals are expected to exceed the
  limit regularly (Error 1102). Only a staging deployment on Free with CPU telemetry can settle it
  (§9), and even then Free adds hard daily caps with no overage (100,000 requests/day shared with the
  eight Workers already on the account; D1 reads/writes that now fail until midnight UTC).

## 1. How this was measured

Local workerd 1.20260925.1 (Wrangler 4.141.0, `vite preview` for the VORA build) on a 2-vCPU
Intel Xeon 2.1 GHz VM. Cloudflare's servers are different and usually faster, so every number is
indicative, not a prediction. Workers limits "are only enforced when deployed to Cloudflare's
network, not in local development".

- Crypto costs: a stand-alone test Worker, best of 3 runs of N operations, CPU read from the
  workerd threads (`/proc/<pid>/task/*/schedstat`).
- VORA requests: the production build, (a) CPU of all workerd threads per request with no profiler
  — this includes the local dev proxy (~2 ms; a static-asset request that never reaches the Worker
  costs 2.1 ms) and the local D1 simulator — and (b) V8 CPU profiles of the Worker isolate alone
  (user code, runtime work on that thread; slightly inflated by the profiler). `LOG_LEVEL=info` as in
  staging/production.

## 2. Password hashing (the Workers Paid blocker)

| Operation (local workerd) | CPU per operation | vs 10 ms |
|---|---|---|
| Argon2id m=19456 t=2 p=1 (VORA's, `@noble/hashes` async) | 237 ms (sync API 221 ms) | 24× |
| Argon2id m=7168 t=5 (OWASP alternative) | 200 ms | 20× |
| Argon2id m=47104 t=1 (OWASP alternative) | 309 ms | 31× |
| PBKDF2-SHA256, 600,000 iterations (OWASP) | 105 ms | 10× |
| PBKDF2-SHA256, 100,000 iterations (below OWASP) | 17.3 ms | 1.7× |
| HMAC-SHA256 (sessions, codes) | 0.003 ms | — |
| ECDSA P-256 / Ed25519 verify (passkeys) | 0.075 / 0.061 ms | — |

| Option | Fits 10 ms? | Security | Classification | Decision |
|---|---|---|---|---|
| Keep Argon2id in the Worker | No (24×) | unchanged | REQUIRES WORKERS PAID | replaced (below) |
| Lower Argon2id/PBKDF2 cost | only far below OWASP | weaker offline resistance | — | rejected (weak hashing) |
| Fast keyed hash + pepper | yes | crackable fast if DB and secret leak | — | rejected (weak hashing) |
| Client-side / "server relief" hashing | yes | moves the work factor to the browser; breaks no-JS forms | — | rejected (your instruction) |
| Split one hash across requests | yes | artificial; stores hash state | — | rejected (artificial workaround) |
| External hashing service / external IdP | yes | passwords or identity leave Cloudflare | REQUIRES AN EXTERNAL SERVICE | not implemented (no other providers) |
| Cloudflare Access as the login | yes | replaces VORA's auth; 50-user cap | CAN BE ADAPTED (≤ 50 users) | not implemented (product change) |
| Passkeys (WebAuthn) instead of passwords | yes (~0.1 ms) | stronger, phishing-resistant | CAN BE ADAPTED | needs your decision: removes passwords, rewrites auth flows and their tests; Playwright can emulate passkeys only in Chromium |
| **Argon2id in a Durable Object** | Worker: yes; DO: 30 s documented | **unchanged** | **CAN BE ADAPTED — implemented; DO CPU on Free NOT VERIFIED** | **done (§3)** |

## 3. The Durable Object design (implemented)

- `PasswordHasher` (`app/.server/auth/password-hasher.ts`), SQLite-backed — the only kind the Free
  plan offers — runs `hashPassword` / `verifyPassword` from `password.ts` unchanged. It is
  stateless: no storage, no logging, no state between calls, and reachable only through this
  Worker's `PASSWORD_HASHER` binding.
- `passwordHashing(ctx)` (`password-hashing.ts`) sends every operation to a fresh object
  (`newUniqueId()`: created next to the caller, no shared queue). Without the binding (unit tests,
  scripts) the same functions run in-process.
- Only an exact policy-strength hash is ever stored (`isPolicyHash`); `verify` must return a boolean.
- Fails closed: if the object errors, returns anything else, or the Free daily DO quota is used
  up, the operation fails with a 503 ("temporarily unavailable") — no in-process fallback, no weaker
  hash, and nothing is recorded against the account, so an outage cannot lock anyone out.
- Timing parity for unknown emails: one verification against `TIMING_DUMMY_HASH`, a fixed
  policy-strength hash of a discarded random value — exactly the work of a real check.
- Password reset and invitations now hash *before* consuming their single-use token; first-Owner
  setup hashes before its insert. A hashing outage therefore leaves the link, invitation or setup
  usable for a retry instead of burning it (or, for setup, reporting "already completed").
- Free allowances for Durable Objects: 100,000 requests/day and 13,000 GB-s/day (pricing page) — a
  hash is one request of roughly 0.03 GB-s. Rate limits and the credential-stuffing block still run
  before any hash. A distributed attacker could still exhaust the daily quota; sign-in then fails
  closed until 00:00 UTC — the same class of risk as the 100,000-request daily Workers cap.
- On Workers Paid the design works unchanged; removing the binding returns to in-process hashing.

## 4. The Worker's own CPU per request (after the changes)

| Request | Local, all threads, no profiler | Worker isolate (profiled) |
|---|---|---|
| Static asset (Worker not invoked — local floor) | 2.1 ms | 0 |
| Legacy redirect `/plans` (kernel only) | 3.2–3.5 ms | ~3 ms |
| `/`, `/services`, `/our-story`, `/contact`, `/privacy` | 8–12 ms | 12–16 ms |
| `/login` (page) | 6–7 ms | ~10 ms |
| `/status` (live checks) | ~17 ms | ~20 ms |
| `/member`, `/account`, `/member.data` (signed in) | 9–13 ms | 12–13 ms |
| `/admin` dashboard (privileged, warm) | 15–21 ms | 15.5–19 ms |
| `POST /login/verify` (email code, no hashing) | 26–43 ms | 28–42 ms |
| `POST /login` password — Worker part, hashing excluded | — | ~27 ms (unknown email) / ~51 ms (member) |
| First page after an isolate starts | ~80 ms | ~67 ms |
| Cron `*/5` (empty outbox) / sending 10 emails | ~11 ms / 63–82 ms | ~9 ms / — |
| Cron `17 3` (daily retention) | 23–29 ms | 22–44 ms |

Worker startup (global scope): 32.6 ms active locally (`wrangler check startup`) against a 1 s
limit. Bundle: 1,566.86 KiB uncompressed (limit 64 MiB on Free since 4 Sep 2026).

Where it goes (profiles): D1 round trips through the runtime's D1 client, Drizzle query building,
formatting of the structured logs, React Router matching/rendering, and GC. Reusing one Drizzle
instance per D1 binding (implemented) saved ~0.3–1 ms per request in an A/B run. Further cuts
(fewer/batched queries in the auth flows, caching RBAC lookups, cheaper log formatting, prerendering
the public pages as static assets) are possible but touch security-critical code or the CSP design,
and their effect can only be judged with Cloudflare's CPU telemetry — not attempted here.

Cloudflare allows some flexibility for isolates that "infrequently" exceed the limit; Workers that
exceed it "consistently" are terminated with Error 1102.

## 5. Every CP-3 dependency

| Requirement | Free plan (source) | VORA | Classification |
|---|---|---|---|
| Argon2id password hashing | 10 ms CPU/request | 200–300 ms | REQUIRES WORKERS PAID in the Worker → **CAN BE ADAPTED**: moved to a Durable Object (DO CPU on Free NOT VERIFIED) |
| Worker CPU, signed-in flows (sign-in, code step, portals) | 10 ms | 15–50 ms locally, no hashing | **REQUIRES WORKERS PAID** (expected; NOT VERIFIED on Cloudflare) |
| Worker CPU, public pages | 10 ms | 7–17 ms locally | CAN BE ADAPTED at best — borderline; NOT VERIFIED |
| First request per isolate | 10 ms + limited flexibility | ~70–80 ms locally | NOT VERIFIED — depends on Cloudflare's flexibility |
| `limits.cpu_ms = 30000` | Paid-only; Free deploys are refused (API error 100328, reported) | removed; 30 s is Paid's default | **CAN BE ADAPTED** — done |
| Durable Objects (new) | SQLite-backed only; 100k req/day; 13,000 GB-s/day | password ops only | WORKS ON CLOUDFLARE FREE |
| Cron Triggers: count | 5 per account | 2 per environment = 4 | WORKS ON CLOUDFLARE FREE if the eight existing Workers use ≤ 1 between them (NOT VERIFIED — the Cloudflare tool available here doesn't list triggers) |
| Cron Triggers: CPU | 10 ms per run | `*/5` ~9–11 ms idle, 60–80 ms sending 10; daily 22–44 ms | **REQUIRES WORKERS PAID** for reliable runs (expected). Jobs are resumable; a cut-short run loses nothing |
| D1 queries per invocation | 50 | sign-in ~12; email job could reach 54 | **CAN BE ADAPTED** — job batch 25 → 10 (24 queries max) |
| External subrequests | 50 | ≤ 10 per run/request | WORKS ON CLOUDFLARE FREE |
| D1 size / databases | 500 MB per DB, 10 DBs, 5 GB | 2 DBs, small | WORKS ON CLOUDFLARE FREE |
| D1 daily rows (5M read / 100k written) | queries fail until 00:00 UTC since 1 Sep 2026 | small site | WORKS ON CLOUDFLARE FREE — availability risk (whole account's D1 stops if exhausted) |
| D1 Time Travel | 7 days (Paid 30) | runbooks assumed 30 | **CAN BE ADAPTED** — runbook updated; older recovery uses exports |
| R2 (MEDIA, PRIVATE) | 10 GB-month, 1M Class A, 10M Class B free; usage beyond is billed | tiny | WORKS ON CLOUDFLARE FREE (R2 already enabled on the account — `solara-media`; no spend cap, so watch usage) |
| Rate Limiting binding | GA; plan availability not stated | 4 limiters/env | WORKS ON CLOUDFLARE FREE — NOT VERIFIED (VORA fails open to its D1 account throttles) |
| Static assets | free, unlimited requests; 20,000 files | 62 files | WORKS ON CLOUDFLARE FREE |
| Worker size / startup | 64 MiB / 1 s | 1.57 MiB / ~33 ms | WORKS ON CLOUDFLARE FREE |
| Variables + secrets | 64 per Worker | ~19 | WORKS ON CLOUDFLARE FREE |
| Memory | 128 MB (same as Paid) | Argon2id 19 MiB (in the DO) | WORKS ON CLOUDFLARE FREE |
| Daily requests | 100,000/day per account (Error 1027) | shared with the 8 existing Workers | WORKS ON CLOUDFLARE FREE — capacity/DoS risk; static assets don't count |
| Workers Logs | 200,000 events/day, 3-day retention | 1–3 lines per request | WORKS ON CLOUDFLARE FREE — 3 days, not 7 |
| Logpush | Paid-only | not used | n/a |
| Custom domain `staging.vorawebsites.store` | available | 1 route | WORKS ON CLOUDFLARE FREE |
| Turnstile | free, 20 widgets | 2 | WORKS ON CLOUDFLARE FREE |
| Cloudflare Access (staging) | Zero Trust free up to 50 users | a few people | WORKS ON CLOUDFLARE FREE — sign-up may ask for a payment method (community reports, not official docs): your call |
| Secrets, `secrets.required` | available | 3 required | WORKS ON CLOUDFLARE FREE |
| Resend | free 3,000/month, 100/day | transactional | REQUIRES AN EXTERNAL SERVICE (as designed) |
| Have I Been Pwned range API | free, no key | password set/change | REQUIRES AN EXTERNAL SERVICE (fails open) |
| Gemini (VORA AI) | — | off | REQUIRES AN EXTERNAL SERVICE (optional) |

CP-3 checklist: Step 1 (Workers Paid) is replaced by this report; Steps 2–10 (Resend, D1, R2,
Turnstile, Access, secrets, report) involve nothing that needs Workers Paid.

## 6. Code changes (all local; `git diff cp-2.1`)

| File | Change |
|---|---|
| `wrangler.jsonc` | removed `limits.cpu_ms`; added `PASSWORD_HASHER` Durable Object binding (top level, staging, production) and migration `v1-password-hasher` (`new_sqlite_classes`) |
| `app/.server/auth/password-hasher.ts` | new — the Durable Object |
| `app/.server/auth/password-hashing.ts` | new — routing, policy-hash check, fail-closed 503, timing dummy |
| `app/.server/auth/password.ts` | added `isPolicyHash`, `TIMING_DUMMY_HASH` (hash/verify unchanged) |
| `app/.server/auth/login.ts`, `account.ts` | verify/burn/hash through `passwordHashing(ctx)` |
| `app/.server/auth/password-reset.ts`, `invitations.ts` | hash before consuming the token / claiming the invitation |
| `app/.server/auth/bootstrap.ts` | hash before the insert, outside the "already completed" catch |
| `app/routes/auth/login.tsx` | a hashing outage answers 503 with a clear message (other errors unchanged) |
| `app/.server/config/env.ts` | `PASSWORD_HASHER` binding type |
| `app/.server/db/client.ts` | one Drizzle instance per D1 binding |
| `app/.server/jobs/scheduled.ts` | email job sends at most `EMAIL_RETRY_BATCH` = 10 per run |
| `workers/app.ts`, `tests/support/test-worker.ts` | export `PasswordHasher` (the test entry needs it because `wrangler.jsonc` binds it; no test changed) |
| `worker-configuration.d.ts` | regenerated by `wrangler types` |
| tests | new: `tests/unit/password-hashing.test.ts` (7), `tests/unit/free-plan-limits.test.ts` (1), `tests/integration/password-hasher.test.ts` (7), `tests/tooling/free-plan-config.test.ts` (5) |
| docs | this report; deployment, backup and architecture notes; verification log; checklist |

## 7. Tests performed

See `VERIFICATION-LOG.md` (CP-3 Free entry): typecheck, lint, 200 unit/tooling (187 + 13 new),
124 integration in workerd (117 + 7 new — every auth test now hashes through the real Durable
Object), E2E Chromium 83/83 and HTTPS production mode 7/7, a mutation check (7 of 7 deliberate
regressions caught), staging/production builds, `wrangler deploy --dry-run` for both, predeploy
checks (fail only on the known `REPLACE_WITH_` placeholders), startup profile, and the CPU
measurements above. WebKit/Firefox were not re-run: the changes are server-side.

## 8. Remaining blockers

1. **Worker CPU of the signed-in flows** (sign-in, code step, recovery, portals, admin) — 2–4× the
   Free limit locally, even with hashing moved out. Expected to require Workers Paid. NOT VERIFIED.
2. **Durable Object CPU on a Free account** — documented (30 s default, no Free exception listed),
   NOT VERIFIED.
3. **Cron CPU** — the daily job and a non-empty email run exceed 10 ms locally.
4. **Free operating limits with no overage** — 100,000 requests/day for the whole account (shared
   with the eight existing Workers), D1 reads/writes that stop until 00:00 UTC, 3-day logs.
5. **Account-level unknowns** — cron triggers used by the other Workers; whether Zero Trust asks
   for a payment method.

## 9. How to settle it on Cloudflare (only when you decide to)

Requires creating the staging resources and deploying staging on the Free account — not done.
After `npm run deploy:staging`:

```sh
npx wrangler tail vora-web-staging --format json   # outcome "exceededCpu" = over the limit
```

Then sign in (member and a privileged account), open `/admin`, `/account`, the public pages, and
wait for both crons. In the dashboard: Workers & Pages → `vora-web-staging` → Observability →
CPU time (look at P90/P99), and Errors → Invocation statuses → "Exceeded CPU Time Limits".
A successful sign-in with no `exceededCpu` on the Durable Object's invocations settles item 2.

## Sources

- Workers limits (CPU, requests, subrequests, size, startup, cron count, Error 1102/1027):
  https://developers.cloudflare.com/workers/platform/limits/
- Subrequests on Free (Feb 2026): https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/
- Worker size 64 MiB (Sep 2026): https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/
- `limits` only on the Standard (Paid) model: https://developers.cloudflare.com/workers/wrangler/configuration/#limits
- Free deploy refused with `limits.cpu_ms` (third-party report, error 100328): https://github.com/EL-Bied-Ali/trackfleet/pull/333
- Durable Objects limits and FAQ (30 s CPU per invocation): https://developers.cloudflare.com/durable-objects/platform/limits/ · https://developers.cloudflare.com/durable-objects/reference/faq/
- Durable Objects pricing (Free allowances): https://developers.cloudflare.com/durable-objects/platform/pricing/
- D1 limits (queries per invocation, Time Travel): https://developers.cloudflare.com/d1/platform/limits/
- D1 Free enforcement (1 Sep 2026): https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/
- Workers pricing / Workers Logs: https://developers.cloudflare.com/workers/platform/pricing/
- Rate Limiting binding: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Turnstile plans: https://developers.cloudflare.com/turnstile/plans/
- Zero Trust free for up to 50 users: https://developers.cloudflare.com/reference-architecture/architectures/sase/
- Resend pricing: https://resend.com/pricing
