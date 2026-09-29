# Cloudflare-only tests and their Railway replacements (D23)

The Railway branch retires the tests that could only exist on Cloudflare Workers — they test
Wrangler, `wrangler.jsonc`, the PasswordHasher Durable Object or Workers Free limits — and
replaces each with an equivalent guard for the Railway runtime (migration plan §13.3). **Nothing
was dropped without a replacement.** The originals stay intact in the CP-3 checkpoint
(`vora-cp3-cloudflare-free.zip`).

Every other test file is unchanged from CP-3 except where noted: all 13 unit files except
`password-hashing.test.ts`, all 13 other integration files, all 7 E2E specs and the HTTPS spec.

## Retired → replacement

| Retired (CP-3) | Case | Railway replacement |
|---|---|---|
| `tests/tooling/deploy-config.test.ts` | parses, runs with nodejs_compat, observability and both cron jobs | `railway-config` › exactly the two schedules, in UTC; the server boots on Node (all E2E, `server-lifecycle`) |
| | keeps secrets out of plain vars in every environment | `railway-config` › every sealed value is empty in both templates; the Dockerfile names no secret |
| | `<env>`: production-grade settings and complete bindings | `railway-config` › `<env>`: production-grade plain settings; start-up accepts the template once real values exist |
| | never shares databases, buckets or rate-limit namespaces | `railway-config` › never shares a database or buckets between environments (rate limiters are per process) |
| | does not attach the live domain to production before cutover | `railway-config` › no Railway config-as-code file can change settings; domains are dashboard steps in `deployment.md` §6 (approval) |
| | documents every secret in `.dev.vars.example` without values | `railway-config` › same check (kept) |
| | git-ignores local secrets, state and exports | `railway-config` › same check, plus `.vora/` and the Docker build context |
| `tests/tooling/deploy-guards.test.ts` | `<env>`: never uses a Turnstile test site key (H1) | `railway-config` › `<env>`: never uses a Turnstile test site key; start-up refuses every test key (and `turnstile-test-keys`, unchanged) |
| | `<env>`: declares exactly the secrets a deploy must find (H3) | `railway-config` › start-up refuses without each required sealed value; `server-lifecycle` and `docker-rehearsal` refuse to start without them |
| | keeps secret declarations out of the local configuration | `railway-config` › secrets hygiene; local defaults (`server/local-env.ts`) hold no secret |
| | deploy scripts: build → scan → pre-deploy check → deploy, no provisioning (H2, H4) | `railway-config` › `deploy:check` is build → security scan → image check, and no script deploys or provisions |
| | production asks for typed confirmation | no script can deploy (Railway deploys only from the dashboard/Git after approval) — `railway-config` › no script deploys |
| `tests/tooling/predeploy-check.test.ts` (13 cases) | accepts a correct build; rejects local build/other environment, placeholders, localhost/http, dev mailbox/KV, development settings, test keys, wrong secrets; reports names only | `railway-config` › template and start-up checks (per environment); `platform-runtime` › platform configuration; `cli` › `check` validates both configurations; `scripts/deploy-check.ts` runs the same validation inside the built image |
| `tests/tooling/wrangler-deploy-guards.test.ts` (8 cases) | Wrangler never creates a missing R2 bucket (H4); a new Worker is refused without its secrets (H3); uploads carry names only | `storage` › no bucket-creation call exists and no request ever addresses a bucket root; `railway-config` › the adapter source has no create-bucket call; H3 as above (start-up refuses) |
| `tests/tooling/free-plan-config.test.ts` | no `limits.cpu_ms` | not applicable on Railway (no per-request CPU limit) |
| | PasswordHasher Durable Object bound everywhere / declared once / exported | `railway-config` › no Durable Object remains; `argon2-native` › native = `@noble/hashes` byte for byte, start-up self-test; `password-hashing-native` (integration) |
| | ≤ 2 cron triggers per environment | `railway-config` › exactly the two schedules; `platform-runtime` › scheduler fires each with its own string, never overlaps |
| `tests/unit/free-plan-limits.test.ts` | the 5-minute run fits 50 D1 queries | `railway-config` › the batch is back to the CP-2.1 value of 25 |
| `tests/integration/password-hasher.test.ts` (7 cases) | same hashes both ways; oversized input; sign-in / reset / invitation / setup fail closed with the object down | `password-hashing-native.test.ts` — the same 7 scenarios against the native path (an Argon2 error or a full queue instead of an unreachable object) + 2 back-pressure cases |
| `tests/unit/password-hashing.test.ts` (routing cases) | routes to a fresh object; weak hash refused; object errors → 503; non-boolean verify refused | same file, rewritten for the native path: identical assertions with a stand-in derivation (the policy-hash and timing-dummy cases are unchanged) |
| `tests/tooling/restore-prepare.test.ts` (Wrangler block) | an unmodified D1 export fails; the prepared file restores exactly | same file: the same proof on a real SQLite engine (libSQL) instead of the D1 simulator; the other cases unchanged |

## New for Railway (migration plan §13.2)

| # | Risk | Tests |
|---|---|---|
| 1 | Argon2 native vs `@noble`, known answers, PHC, existing hashes, self-test, concurrency cap | `unit/argon2-native`, `unit/password-hashing`, `integration/password-hashing-native` |
| 2 | SQLite foreign keys, WAL, atomic batches | `integration/sqlite-platform`, `integration/database` (unchanged) |
| 3 | Proxy trust: origin auth, forged headers, CSRF over plain HTTP, Host/X-Forwarded-Proto | `unit/platform-trust`, `integration/server-lifecycle`, `docker-rehearsal`, HTTPS E2E through a Cloudflare stand-in |
| 4 | Access JWT (valid / wrong audience / expired / unsigned / keys unavailable) | `unit/platform-trust` |
| 5 | One-line JSON logs with `message` and `level`, still redacted | `unit/platform-runtime`, `docker-rehearsal` |
| 6 | SIGTERM drains requests and background work, then exits 0 | `integration/server-lifecycle`, `docker-rehearsal`, `db:restore-rehearsal` |
| 7 | Scheduler: both schedules, UTC, no overlap | `unit/platform-runtime`, `integration/server-lifecycle` |
| 8 | Rate limiter: 20/6/120/12 per 60 s, bounded memory | `unit/platform-runtime` |
| 9 | Storage: SigV4 verified independently against a local S3 mock; no bucket creation | `unit/storage` |
| 10 | Migrations at start-up: all three on a fresh file, none on restart, a failure stops start-up and leaves the snapshot | `integration/sqlite-platform`, `integration/server-lifecycle`, `docker-rehearsal` |
| — | In-container operator commands | `integration/cli` |
| — | Mutation check: 20 deliberate regressions (CP-3's seven restated + 13 new) | `scripts/mutation-check.ts` |
