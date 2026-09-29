# VORA — web platform

Public site, admin, client and member portals and VORA AI for VORA Websites, on Cloudflare
Workers (React Router 8 SSR + Hono kernel, D1, R2, Workers Rate Limiting).

Creative by Solara. Digital by VORA.

## Run it locally

Requires Node 22.22+.

```sh
npm ci
cp .dev.vars.example .dev.vars
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # paste as AUTH_SECRET in .dev.vars

npm run db:migrate:local      # apply migrations to the local D1 database
npm run db:seed:local         # roles, permissions and DRAFT content (real facts only)
npm run dev:users             # one local user per role; passwords are printed once
npm run dev                   # http://localhost:5173
```

Sign-in codes and other emails are captured locally: open
`http://localhost:5173/api/dev/mailbox` (development only — it answers 404 in staging and
production). Turnstile is skipped locally while `TURNSTILE_SECRET_KEY` is empty.

## Check it

```sh
npm run verify                # typegen + typecheck, lint, unit + integration tests, build
npx playwright install chromium
npm run test:e2e              # production build in workerd + Playwright + axe (own throwaway DB and secrets)
npm run test:e2e:https        # the same build in PRODUCTION MODE over local HTTPS: __Host- cookies, HSTS
npm run security:scan         # secrets in committable files; server code/secrets/source maps in build/client
npm run db:restore-rehearsal  # export → restore into a fresh local database → compare (local only)

npx playwright install webkit firefox     # once, for the Safari engine and Firefox
npm run test:e2e:browsers                 # E2E in WebKit (desktop + iPhone), then Firefox
npm run test:e2e:https:browsers           # HTTPS production-mode suite in WebKit and Firefox
```

- Unit tests (`tests/unit`) run in Node.
- Integration tests (`tests/integration`) run inside workerd with real migrations and seed data
  per file, through the real kernel (headers, CSRF, sessions, API).
- E2E tests (`tests/e2e`) build the site, start `vite preview` on a fresh local database under
  `.wrangler/e2e-state`, and drive it with Chromium (desktop + mobile). `security.spec.ts` checks
  access control, CSRF, sessions, redirects, XSS, headers and bundle exposure on that build.
  `setup.spec.ts` runs the one-time first-Owner flow (`/setup`) on two more preview servers with
  empty databases (:5174 with JavaScript, :5175 without). `E2E_BROWSERS=all` adds WebKit and
  Firefox projects that run the same tests.
- HTTPS tests (`tests/e2e-https`) run the build with `wrangler dev --local-protocol https` in
  production mode (APP_ENV=production, random throwaway secrets) to check what only exists on
  https: `__Host-` Secure cookies, HSTS, production indexing and caching headers.
- Tooling tests (`tests/tooling`) check the security scanner, the deployment configuration, the
  pre-deploy check, the deploy guards against the exact Wrangler version (local mock API), the
  restore tooling (with the real Wrangler on throwaway local databases) and the browser matrix.
- Deploy only with `npm run deploy:<env>` (build → security scan → pre-deploy check → upload with
  no automatic resource creation); see `docs/runbooks/deployment.md` §5.
- Every test must assert something (`requireAssertions`), and `.skip`/`.only` fail the lint.
- Verification history and what each checkpoint does and does not prove: `docs/VERIFICATION-LOG.md`.

## Rules this codebase keeps

- No secret or API key ever reaches the browser or the repository (`.dev.vars` is git-ignored;
  staging/production use `wrangler secret put`).
- Production migrations and seeds only run after you type `production`; migrations are
  expand-only; nothing destructive runs automatically.
- Real content only: seeded content is draft until someone publishes it.
- Anything that could not be verified is reported as **NOT VERIFIED**.

## Documents

| | |
|---|---|
| `docs/00-DISCOVERY.md` | references, content inventory, conflicts, missing inputs |
| `docs/01-ARCHITECTURE.md` | architecture (21 sections) |
| `docs/02-PHASE1-REPORT.md` | what Phase 1 built and how it was verified |
| `docs/CHECKLIST.md` | running implementation checklist |
| `docs/VERIFICATION-LOG.md` | verification checkpoints (what ran, where, results, what is still NOT VERIFIED) |
| `docs/CLOUDFLARE-FREE-COMPATIBILITY.md` | CP-3 audit: what runs on Workers Free, what was adapted, what still needs Paid |
| `docs/runbooks/deployment.md` | Cloudflare resources, secrets, deploy, first Owner, cutover, rollback |
| `docs/runbooks/backup-and-recovery.md` | Time Travel, exports, restore procedures, drills |
| `docs/runbooks/operations.md` | health, logs, maintenance, lockouts, secrets rotation, outbox |
