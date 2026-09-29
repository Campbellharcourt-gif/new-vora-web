# Phase 1 — Production Foundation: Report

> Later checkpoints (your integration run, the security verification of the production build and
> the fixes it produced) are recorded in `docs/VERIFICATION-LOG.md`. This report stays as the
> Phase 1 record (checkpoint CP-0).

Date: 27 September 2026 · Scope: PROMPT 2 (foundation only — no visual website yet, as instructed)

## 1. Verdict

The foundation is built and **verified locally**: typecheck, lint, 110 unit tests, 111
integration tests running inside the real Workers runtime (workerd), a production build, and 58
end-to-end browser tests against that build — **all PASS**. Writing the tests exposed nine real
defects; all are fixed and covered (section 5).

It is **not deployed**. Staging/production, Resend delivery, live Turnstile, live Gemini, cron
on Cloudflare and backup restores are **NOT VERIFIED** — they need your Cloudflare login and
provider keys. Section 6 lists the exact commands and what to send back.

## 2. What was built

| Area | What exists | Key files |
|---|---|---|
| Platform | React Router 8 (SSR) on Cloudflare Workers via the Vite plugin; Hono kernel in front; TypeScript 7 strict; Biome; env-separated `wrangler.jsonc` (local / staging / production) | `workers/app.ts`, `app/.server/kernel/`, `wrangler.jsonc` |
| Configuration | Zod-validated environment that fails closed (generic 503, logs key names only); staging/production refuse an http origin, the capture mail transport, a missing Turnstile secret and the placeholder Turnstile site key | `app/.server/config/env.ts` |
| Database | D1 schema for every domain (identity, governance, content + immutable versions, media, enquiries/careers, client portal, AI); CHECK constraints; append-only audit/security trails; last-Owner guards | `app/.server/db/schema/`, `migrations/0000`–`0002` |
| Seeds | Roles/permissions from code; real content only (SAIL Gaming, EON Clothing, services, Solara partner line, job titles) — all **drafts** | `app/.server/db/seed/`, `scripts/seed.ts` |
| HTTP kernel | Request IDs, security headers + per-request CSP nonce, CSRF origin gate, session resolution, maintenance gate, legacy 301s, JSON API with one error envelope, generic 500/503 pages | `app/.server/kernel/`, `app/.server/api/` |
| Authentication | Argon2id; opaque hashed sessions (`__Host-` cookie in production); idle/absolute expiry; email 2FA for privileged roles and risky sign-ins; recovery codes; step-up; password reset; invitations; `/setup` Owner bootstrap; lockout, Turnstile escalation, IP-hash credential-stuffing block; login history, risk scoring, alerts | `app/.server/auth/` |
| Authorisation | 54 code-defined permissions, 6 ranked roles, `authorize()` and resource policies inside the services (not only in routes) (client-organisation membership, staff assignment), rank rules, step-up for role changes | `shared/permissions.ts`, `app/.server/auth/rbac.ts` |
| Email | Resend + capture transports, escaped templates, outbox with idempotency and retry/backoff, sensitive mail sent synchronously and never stored | `app/.server/email/` |
| Enquiries | Shared browser/server validation, signed form token (bot timing + idempotency), honeypot, Turnstile, per-IP and per-email limits, stored before any email, team + sender emails, admin status workflow | `app/.server/services/enquiries.ts` |
| Operations | Health (DB, storage, email, AI, jobs, config) + public `/status`; feature flags; typed settings; maintenance (setting, env, CLI); cron jobs (email retry, retention); structured redacting logs | `app/.server/services/`, `app/.server/jobs/` |
| VORA AI foundation | Provider interface, Gemini adapter (key in header only), budgets, circuit breaker, usage/cost ledger — **off** by setting and flag | `app/.server/ai/` |
| Routes | Public shells, auth screens, account/security, admin (dashboard, enquiries, users/invitations, system), client, member, error pages | `app/routes/` |
| Runbooks | Deployment + cutover, backup & recovery, operations & security procedures | `docs/runbooks/` |

## 3. Verification results (run in the build environment)

| Command | Result |
|---|---|
| `npm run typecheck` (wrangler types + react-router typegen + `tsc -b`) | **PASS** |
| `npm run lint` (Biome, 166 files) | **PASS** |
| `npm run test:unit` (Node) | **PASS** — 110 / 110 in 8 files |
| `npm run test:integration` (workerd + Miniflare D1, KV, R2, rate limiters; real migrations + seed per file) | **PASS** — 111 / 111 in 11 files |
| `npm run build` (client + Worker) | **PASS** |
| `npm run test:e2e` (production build in `vite preview`/workerd, throwaway migrated + seeded DB, Playwright + axe) | **PASS** — 58 / 58 (34 desktop Chromium, 24 mobile Pixel 7) |
| `npx wrangler d1 migrations apply DB --local` | **PASS** — `0000`, `0001`, `0002` |
| `npm run maintenance -- --local --on/--off` | **PASS** — setting written, audit + security event recorded; production path refuses without typed confirmation |
| Mutation check (two guards deliberately broken) | **PASS** — both regressions caught by the suite, originals restored |
| Clean-room check: the delivered zip unpacked fresh (no `.dev.vars`, no local state) → `npm ci`, `npm run verify`, `npm run test:e2e` | **PASS** — 110 + 111 + build + 58 |
| `npm run dev` smoke (health, home, 404, dev mailbox, report-only CSP for HMR) | **PASS** |

E2E ran on a preinstalled Chromium (build 1194) via `PW_CHROMIUM_PATH`; on your Mac Playwright
uses its own browser (`npx playwright install chromium`).

## 4. Where each required area is tested

| Required area | Tests |
|---|---|
| Authentication | `auth-login` (member/staff sign-in, identical failures, challenge after 5, lock after 10 + email, unknown-email parity, suspended accounts, IP-hash block, rate-limit binding, emailed code never stored, pending session powerless, wrong/right/replayed code, 5-attempt burn, resend cooldown, recovery codes once each, risk-based code + new-device alert, per-request revalidation: revoked/idle/absolute/suspended/privilege-gained, last-seen throttle); `auth-account` (bootstrap, reset, invitations, password change, step-up, own-session revocation); E2E `auth.spec` |
| Authorisation & permissions | `rbac-users` (each role vs code, unions, `authorize()` 401/403 + recorded denial, role assignment rules, step-up, Owner rules, suspension); `content-portal` (client org isolation, internal files, staff assignment); `settings-flags`; unit `risk-permissions`; E2E guards |
| Database | `database` (tables, triggers, FKs, CHECKs, seed correctness and idempotency, RBAC resync, append-only/retention triggers, immutable versions, last-Owner backstop) |
| APIs | `kernel` (headers, CSP, request IDs, JSON 404, CSRF, strict body parsing, legacy 301s, maintenance, config failure, production headers, 500 page); `health-jobs`; `auth-account` (sessions API) |
| Enquiry flow | `enquiries` (end-to-end API → D1 → outbox → emails, idempotent double submit, honeypot/too-fast discard, forged/expired tokens, field errors, per-email and per-IP limits, spam triage, Turnstile success/failure/foreign host/missing token, admin transitions, privacy, notes, pagination); E2E `contact.spec` |
| Error handling | unit `http-primitives` (envelope never leaks internals, logger redaction), `kernel` (generic 500/503), `email-outbox` (retry/backoff/dead-letter, stuck sends, sensitive mail), `ai` (friendly messages, no provider text, circuit breaker, budgets), `health-jobs` (failed job recorded) |

## 5. Defects found by the tests — fixed

1. **The last Owner could be deleted.** Deleting the user row cascaded past the `user_roles`
   trigger. → Migration `0002_owner_guards.sql` guards the user row (delete, suspend,
   soft-delete).
2. **Unknown `/api/*` paths rendered the HTML site** instead of the JSON 404 envelope. → Explicit
   API catch-all.
3. **Crashes were answered by Hono's plain-text 500 and never logged with details.** →
   `app.onError` logs the error with the request ID and returns the proper page or envelope.
4. **Lockout timing revealed whether an email had an account** (real accounts locked one attempt
   earlier). → Both lock on the same attempt.
5. **A revoked pending sign-in could still be processed** by a request already in flight. → The
   pending session is re-checked inside the operation.
6. **Every page requested a missing `/favicon.ico`** (console error + a wasted server render). →
   Empty icon declared until real icons are made from your logo.
7. **IP-hash blocking was configured but not implemented.** → Implemented (8 accounts/hour).
8. **Role changes did not rotate sessions** as the architecture states. → The user is signed out
   everywhere on a role change.
9. **Settings writes had no permission check in the service.** → Per-setting permissions
   (`settings.manage`, `maintenance.manage`, `ai.manage`), audit + security event; audited
   feature-flag management service added.

## 6. NOT VERIFIED — commands for your Mac

| # | Item | Command(s) | Send me |
|---|---|---|---|
| 1 | Full suite on your machine | `npm ci && npm run verify && npx playwright install chromium && npm run test:e2e` | the last ~20 lines of each |
| 2 | Cloudflare resources, secrets, migrations, seed, staging deploy | `docs/runbooks/deployment.md` §0–5 | output of `npx wrangler deployments list --name vora-web-staging` |
| 3 | Owner bootstrap on staging | `deployment.md` §6 (`/setup`, then `npx wrangler secret delete SETUP_TOKEN --env staging`) | “done” + whether `/setup` now shows 404 |
| 4 | Resend delivery (codes, enquiries) | sign in on staging; submit `/contact` | whether both emails arrived + the *Email* line on `/admin/system` |
| 5 | Live Turnstile | after a `/contact` submission: `npx wrangler d1 execute vora-staging --env staging --remote --command "select reference, turnstile_ok from enquiries order by created_at desc limit 1"` | the output (`turnstile_ok` should be `1`) |
| 6 | Argon2id within Workers Paid CPU limits | `npx wrangler tail vora-web-staging --format pretty` while signing in | the tail lines (outcome must be `ok`, not `exceededCpu`) |
| 7 | Cron triggers on Cloudflare | after 24 h: `npx wrangler d1 execute vora-staging --env staging --remote --command "select job, status, started_at from job_runs order by started_at desc limit 5"` | the output |
| 8 | Restore drill | `docs/runbooks/backup-and-recovery.md` §5 (against staging first) | the table row you record |
| 9 | Live Gemini | only when you enable VORA AI (Phase 7) | — |
| 10 | Safari/Firefox, VoiceOver, real phone | Phase 8 QA | — |

## 7. Deliberately not in Phase 1

The visual website (Phases 2–4); `/preview`, CMS editors, media library, Resend webhooks, the
applications form and admin controls for settings/flags/roles/suspension (Phase 5 — the services
and tests for settings, flags, roles and suspension already exist); portal depth (Phase 6);
VORA AI endpoints and UI (Phase 7); CI (needs a GitHub repository); scheduled backups (needs the
repository and a scoped API token); `/register` and `/verify-email` (member self-signup is off
by default).

## 8. Choices made within the approved defaults

- D1/R2 location hint **Oceania** (`oc`) in the runbook.
- IP-hash block threshold: **8 failing accounts per hour**.
- **No favicon** until icons can be made from your logo (no invented mark).
- Owner-created custom roles wait for the Phase 5 admin; system roles stay code-defined.
- Integration tests pin the breach-check flag off (it calls an external API); the check itself is
  unit-tested with a fake network, including fail-open behaviour.

## 9. Needed from you

VORA logo files (or confirmation that the eye/star mark is the logo) · budget ranges for the
enquiry form · legal entity details and approved Terms/Privacy/Cookies text · a decision on
Mark4 data · typeface licences · Blender Phase 2.2 files · emails for the staging Access
allow-list · Resend domain verification and Turnstile widgets (runbook §2).
