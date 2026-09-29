# VORA — web platform

Public site, admin, client and member portals and VORA AI for VORA Websites: **one Node.js 24
service on Railway**, behind Cloudflare (DNS, TLS, WAF, cache, Turnstile, R2, Access for staging).
React Router 8 SSR + a Hono kernel, SQLite (libSQL) on a volume with Litestream backups to R2,
native Argon2id. Plan and reasons: `docs/VORA-RAILWAY-MIGRATION.md`.

Creative by Solara. Digital by VORA.

## Run it locally

Requires **Node 24.19+** (`crypto.argon2`; `.node-version` pins 24.21.0).

```sh
npm ci
cp .dev.vars.example .dev.vars
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # paste as AUTH_SECRET in .dev.vars

npm run db:seed:local         # migrations + roles, permissions and DRAFT content (real facts only)
npm run dev:users             # one local user per role; passwords are printed once
npm run dev                   # http://localhost:5173 (Vite in middleware mode inside the Node server)
```

The development database is `.vora/dev.db` (git-ignored). Sign-in codes and other emails are
captured locally: open `http://localhost:5173/api/dev/mailbox` (development only — it answers
404 in staging and production). Turnstile is skipped locally while `TURNSTILE_SECRET_KEY` is
empty. `npm run preview` runs the production build locally.

## Check it

```sh
npm run verify                # typecheck, lint, unit + tooling, integration, build
npm run test:e2e              # production build on three Node servers + Playwright + axe
npm run test:e2e:https        # PRODUCTION MODE over HTTPS behind a local Cloudflare stand-in
npm run security:scan         # secrets in committable files; server code/secrets/maps in build/client
npm run db:restore-rehearsal  # Litestream replica + snapshot → restore → compare → sign in (local only)
npx tsx scripts/mutation-check.ts         # 20 deliberate regressions, each must be caught
npm run docker:build && npx tsx scripts/docker-rehearsal.ts --image vora-web:local
npm run deploy:check          # build → scan → the IMAGE validates both environment templates

npx playwright install webkit firefox     # once, for the Safari engine and Firefox
npm run test:e2e:browsers                 # E2E in WebKit (desktop + iPhone), then Firefox
npm run test:e2e:https:browsers           # HTTPS production-mode suite in WebKit and Firefox
```

- **Unit and tooling** (`tests/unit`, `tests/tooling`) run in Node.
- **Integration** (`tests/integration`) run in Node against the real platform adapters — SQLite
  (`:memory:`, foreign keys on), storage, rate limiters, dev mailbox — with real migrations and
  seed per file, through the real kernel. `cloudflare:test`/`cloudflare:workers` are aliased to
  `tests/support/node-runtime.ts`, so the test files are the workerd suite's, unchanged.
- **E2E** (`tests/e2e`) serve the production build from three Node servers on throwaway SQLite
  files under `.wrangler/e2e-*` (:5173 main, :5174 and :5175 empty for `/setup` with and without
  JavaScript). `E2E_BROWSERS=all` adds WebKit and Firefox.
- **HTTPS** (`tests/e2e-https`): the build in production mode behind a local TLS proxy that adds
  the origin-auth header and `CF-Connecting-IP` like Cloudflare, with R2 on a local S3 mock.
- The retired Cloudflare-only tests and their replacements: `docs/railway/TEST-MAPPING.md`.
- **Nothing in this repository deploys.** Railway builds the root `Dockerfile` from Git once the
  project exists — `docs/runbooks/deployment.md` (every account step needs your approval).
- Every test must assert something (`requireAssertions`), and `.skip`/`.only` fail the lint.
- Verification history: `docs/VERIFICATION-LOG.md`.

## Rules this codebase keeps

- No secret ever reaches the browser or the repository. Locally `.dev.vars` (git-ignored);
  staging/production use **sealed** Railway variables (`docs/railway/variables.md`).
- The server refuses to start on unsafe configuration: missing secrets, Turnstile test keys,
  capture email, an http origin, no origin-auth secret, no backups (staging/production).
- Migrations run at start-up after a snapshot, each file atomically; they are expand-only;
  nothing destructive runs automatically.
- Real content only: seeded content is draft until someone publishes it. Where approved copy or
  media does not exist yet, the page shows a marked `v-slot` or the survey-drawing plate — never
  invented copy, clients, figures or stock imagery.
- The interface uses only the design system (`docs/VORA-DESIGN-SYSTEM.md`): tokens in
  `app/styles/tokens.css`, components in `app/styles/vora.css` (ported from
  `docs/design-system/components/bundle.css`), React primitives in `app/components/vora/`.
- Anything that could not be verified is reported as **NOT VERIFIED**.

## Documents

| | |
|---|---|
| `docs/00-DISCOVERY.md` | references, content inventory, conflicts, missing inputs |
| `docs/01-ARCHITECTURE.md` | architecture (21 sections) |
| `docs/02-PHASE1-REPORT.md` | what Phase 1 built and how it was verified |
| `docs/CHECKLIST.md` | running implementation checklist |
| `docs/VERIFICATION-LOG.md` | verification checkpoints (what ran, where, results, what is still NOT VERIFIED) |
| `docs/CLOUDFLARE-FREE-COMPATIBILITY.md` | CP-3 audit (historical): what ran on Workers Free — superseded by the Railway runtime |
| `docs/VORA-RAILWAY-MIGRATION.md` | the Railway plan (R0–R10) |
| `docs/railway/variables.md` | every environment variable (names and meanings; no values) |
| `docs/railway/TEST-MAPPING.md` | retired Cloudflare-only tests and their Railway replacements |
| `docs/VORA-DESIGN-SYSTEM.md` | the visual source of truth for the rebuild |
| `docs/design-system/` | the design-system source: tokens, fonts (OFL), component CSS/JS, guidelines |
| `docs/FINAL-REPORT.md` | Railway migration + design-system rebuild: architecture, design, tests, security, remaining work |
| `docs/runbooks/deployment.md` | Railway + Cloudflare set-up (with approval), deploy, first Owner, cutover, rollback |
| `docs/runbooks/backup-and-recovery.md` | Litestream, volume backups, snapshots, restores, drills, rehearsals |
| `docs/runbooks/operations.md` | health, logs, maintenance, lockouts, secrets rotation, outbox |
