# Runbook — Environments, first deployment and cutover

Status: **written, not yet executed.** Nothing in this runbook has been run against your Cloudflare
account from the build environment (no Wrangler login there). Every step is marked with who runs
it. Commands are for macOS (zsh) from the project root. CP-2.1 applied the corrections from the
CP-3 readiness review (P5 items 1–9) and added the deploy guards H1–H4 described in §2, §3 and §5.

Environments (see `wrangler.jsonc`):

| | Local | Staging | Production |
|---|---|---|---|
| Worker | `vite dev` / `vite preview` (workerd) | `vora-web-staging` | `vora-web` |
| Hostname | `http://localhost:5173` | `staging.vorawebsites.store` (behind Cloudflare Access) | `vorawebsites.store` (attached at cutover) |
| D1 | local Miniflare | `vora-staging` | `vora-production` |
| R2 | local | `vora-media-staging`, `vora-private-staging` | `vora-media`, `vora-private` |
| Email | capture (dev mailbox) | Resend | Resend |

---

## 0. Prerequisites (once)

1. **Cloudflare plan** — read `docs/CLOUDFLARE-FREE-COMPATIBILITY.md` first. Since the CP-3 Free
   audit, Argon2id (~250 ms of CPU per hash) runs in the `PasswordHasher` Durable Object and
   `wrangler.jsonc` no longer sets `limits.cpu_ms` (a Free account refuses any deploy that does),
   so the configuration deploys on Workers Free. The Worker's own CPU for sign-in, the email-code
   step and the portals was still measured at 2–4× the Free plan's 10 ms, so on Free expect
   Error 1102 on those pages until Cloudflare's CPU telemetry shows otherwise (report §9).
   Workers Paid removes that limit; nothing else in this runbook changes with the plan.
2. Node 22.22+ and npm. Then:

   ```sh
   npm ci
   npx wrangler login          # opens the browser; choose the account that owns vorawebsites.store
   npx wrangler whoami         # confirm the account name and ID
   ```

3. Local sanity check (must pass before anything is deployed):

   ```sh
   npm run verify              # typegen + typecheck, lint, unit + integration tests, build
   npm run test:e2e            # production build in workerd + Playwright (needs: npx playwright install chromium)
   npm run test:e2e:https      # production mode over local HTTPS: __Host- cookies, HSTS
   ```

   Before a release, also run the Safari engine (WebKit) and Firefox: `npx playwright install
   webkit firefox` once, then `npm run test:e2e:browsers` and `npm run test:e2e:https:browsers`.

## 1. Create Cloudflare resources (you run — once per environment)

Oceania (`oc`) location hints keep data close to Australian users. Change them only if you
decide otherwise.

```sh
# Staging
npx wrangler d1 create vora-staging --location oc --update-config=false
npx wrangler r2 bucket create vora-media-staging --location oc --update-config=false
npx wrangler r2 bucket create vora-private-staging --location oc --update-config=false

# Production
npx wrangler d1 create vora-production --location oc --update-config=false
npx wrangler r2 bucket create vora-media --location oc --update-config=false
npx wrangler r2 bucket create vora-private --location oc --update-config=false

# Long-term database exports (see backup-and-recovery.md)
npx wrangler r2 bucket create vora-backups --location oc --update-config=false

npx wrangler r2 bucket list                     # check every bucket exists before any deploy
```

`--update-config=false` matters. Without it, Wrangler 4.141 asks "Would you like Wrangler to add
it on your behalf?" with **Yes** as the default and, without `--env`, writes the new database or
bucket into the top-level **local** configuration. If you still see that question, answer **n**.

Create every database and bucket **before** the first deploy. The deploy scripts run
`wrangler deploy --experimental-provision=false` (§5), so a missing database or bucket makes the
deploy fail instead of being created silently (without the Oceania location hint).

Copy each `database_id` printed by `d1 create` into `wrangler.jsonc`, replacing
`REPLACE_WITH_STAGING_D1_ID` and `REPLACE_WITH_PRODUCTION_D1_ID`; the pre-deploy check (§5)
refuses to upload while a placeholder remains or the ID is not a UUID. Do **not** create KV for
`DEV_MAILBOX` in staging or production — it is intentionally absent there.

## 2. Third-party services (you run — dashboards)

**Turnstile** (Cloudflare dashboard → Turnstile → Add widget):
- `VORA staging` — hostname `staging.vorawebsites.store`, managed mode.
- `VORA production` — hostname `vorawebsites.store`. A hostname entry also covers its
  subdomains (so `www.` and `next.` are included; at most 10 hostnames per widget).
- Put each **site key** into `wrangler.jsonc` (`TURNSTILE_SITE_KEY`, replacing the
  `REPLACE_WITH_…` placeholder — config validation refuses to start with a placeholder).
  The **secret key** goes in as a secret (step 3).
- Never use Cloudflare's Turnstile **test keys** (`1x00000000000000000000AA` and the like)
  outside local development: staging and production refuse to start with a test site key or
  secret (CP-2.1 H1), and the pre-deploy check refuses to upload a test site key.

**Resend** (resend.com → Domains → Add Domain):
- Domain `vorawebsites.store`, region **Tokyo (ap-northeast-1)** — the closest of Resend's
  regions. Changing the region later means deleting and re-adding the domain.
- Leave the custom return path at `send`. Keep **open tracking, click tracking and receiving
  off**: click tracking rewrites the links in sign-in and password-reset emails, and receiving
  adds another MX.
- In Cloudflare DNS add exactly the **3 records** Resend lists, copying the values from its
  screen: `MX send` (priority 10), `TXT send` (SPF) and `TXT resend._domainkey` (DKIM). Don't
  use Resend's automatic "Sign in to Cloudflare" setup, and don't change the apex `MX` records
  (Cloudflare Email Routing) or the apex SPF record. Wait for **Verified**.
- **Do not add a DMARC record** (skip the DMARC row Resend shows). One already exists
  (`p=none`, with Cloudflare reporting), and a second DMARC record breaks DMARC.
- Create an API key with **Sending access** for this domain only (a different key per
  environment).
- Senders used: `hello@` (default), `projects@` (enquiry notifications), `careers@` (later).
  Make sure these mailboxes receive mail.

**Gemini** (Google AI Studio → API keys): create a key restricted to the Generative Language
API. VORA AI stays **off** (setting + feature flag) until content is final, so this can wait.

**Cloudflare Access** for staging (Zero Trust → Access → Applications → Add → Self-hosted):
application domain `staging.vorawebsites.store`, policy *Allow* → *Emails* → your address(es).
Do this **before** the first staging deploy.

## 3. Secrets (you run — per environment)

Generate strong values locally; never paste them into files or chat. Paste each value at
Wrangler's hidden prompt.

- **Always** pass `--env staging` or `--env production`, and never combine `--name` with `--env`.
- **Never** pipe a value in (`echo … | npx wrangler secret put …`) and never run with `CI=true`:
  Wrangler then answers "yes" to creating Workers by itself, so a missing `--env` would silently
  create `vora-web-local`.
- The first `secret put` of an environment asks whether to create the Worker: answer **y** for
  `vora-web-staging` (or `vora-web`) — it creates an empty placeholder Worker that only holds the
  secrets, and the first deploy replaces it. If a prompt mentions **vora-web-local**, answer
  **n**: `--env` is missing.

```sh
openssl rand -base64 48          # use once for AUTH_SECRET
openssl rand -base64 32          # use once for SETUP_TOKEN

npx wrangler secret put AUTH_SECRET --env staging
npx wrangler secret put SETUP_TOKEN --env staging
npx wrangler secret put RESEND_API_KEY --env staging
npx wrangler secret put TURNSTILE_SECRET_KEY --env staging
npx wrangler secret put GEMINI_API_KEY --env staging          # optional until AI is enabled
# RESEND_WEBHOOK_SECRET is added when the webhook endpoint ships (Phase 5).

# Repeat with --env production (different values for every secret).
npx wrangler secret list --env staging                        # names only — values are never shown
```

`AUTH_SECRET`, `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY` are declared as **required** in
`wrangler.jsonc` (`secrets.required` in `env.staging` and `env.production`, CP-2.1 H3). Set them
**before the first deploy**: Wrangler refuses to deploy a new Worker without them, and the
Cloudflare API refuses to update an existing one while one is missing. `SETUP_TOKEN`,
`GEMINI_API_KEY`, `RESEND_WEBHOOK_SECRET` and `AUTH_SECRET_PREVIOUS` are optional and not declared.

`AUTH_SECRET_PREVIOUS` is only used during a key rotation (see `operations.md`).

## 4. Database: migrate and seed (you run)

```sh
npm run db:migrate:staging        # wrangler d1 migrations apply DB --env staging --remote
npm run db:seed:staging           # roles, permissions, socials, partner + DRAFT content only
```

Production (both commands ask you to type `production` first):

```sh
npx wrangler d1 time-travel info vora-production --env production   # record the bookmark first
npm run db:migrate:production
npm run db:seed:production
```

Migrations in this repository are **expand-only** (new tables/columns/triggers). Anything
destructive (dropping or rewriting data) is never run by these scripts: it needs a written plan,
a fresh export (`npm run backup:export -- --env production --upload`) and a manual run.

## 5. Deploy (you run)

```sh
npm run verify                    # must pass
npm run test:e2e                  # must pass (includes the security suite)
npm run deploy:staging:dry-run    # optional: every step except the upload
npm run deploy:staging            # build → security scan → pre-deploy check → wrangler deploy
```

Each `deploy:*` script runs, in order, stopping at the first failure:

1. the build for that environment (`CLOUDFLARE_ENV` is set for that one command only);
2. `npm run security:scan` — stops if a committable file contains a credential, or the client
   bundle contains server code, a secret value or a source map;
3. the **pre-deploy check** (`tsx scripts/predeploy-check.ts --env <env>`, CP-2.1 H2), which reads
   the build output and prints `Pre-deploy check (<env>) FAILED — nothing was uploaded` unless
   it is the intended environment (Worker name, routes, `APP_ENV`, an https `APP_ORIGIN`, Resend
   email, no debug logging, no `workers.dev` or preview URLs) with no `REPLACE_WITH_…`
   placeholder, no localhost or `http://` reference, no development mailbox (`DEV_MAILBOX` or any
   KV namespace), no Turnstile test key, a real D1 UUID, no secret passed as a var, and exactly
   the required secrets declared. It prints field names only, never values;
4. `wrangler deploy --experimental-provision=false` (CP-2.1 H4): a missing database or bucket
   fails the deploy instead of being created.

Expected during the staging/production build — names only, never values:
`▲ [WARNING] Missing required secrets: AUTH_SECRET, RESEND_API_KEY, TURNSTILE_SECRET_KEY. Add them
to .dev.vars, .env, or set as environment variables.` The build machine never holds the deployed
secrets; they live on the Worker (§3). Also expected: `"kv_namespaces" exists at the top level,
but not on "env.staging"` — leaving KV out of staging and production is deliberate; don't add it.

**Never run `npx wrangler deploy` yourself**, with or without `--env`: after `npm run verify` or
`npm run test:e2e` the build on disk is the **local development** build, and Wrangler ignores
`--env` for it (a dry run showed it would upload APP_ENV `development`, the localhost origin,
capture email and `DEV_MAILBOX`). **Never `export CLOUDFLARE_ENV=…`**: Wrangler treats it like
`--env`, and it also turns local test builds into staging builds. Always use `npm run
deploy:<env>`, which rebuilds for the right environment first.

The staging custom domain is attached by the deploy (`routes` in `env.staging`).

## 6. Create the first Owner (you run — once per environment)

1. Open `https://staging.vorawebsites.store/setup` (Access will ask you to sign in first).
2. Enter the `SETUP_TOKEN` value, your name, email and a strong password.
3. **Save the 10 recovery codes offline** (password manager). They are shown once.
4. Remove the token — `/setup` already answers 404 once an Owner exists, this removes the secret:

   ```sh
   npx wrangler secret delete SETUP_TOKEN --env staging
   ```

5. Invite other people from the admin (Owners/Admins/Managers invite roles below their own).

## 7. Smoke test (you run — after every deploy)

Staging is behind Access, so check it in the browser:

- `/api/health/ready` → `{"status":"ready"}`
- `/status` → components listed; `/admin/system` (signed in) → database *Operational*,
  `N migrations applied`, email transport `resend`. An overall **"degraded"** status is expected
  at first — until `GEMINI_API_KEY` and `RESEND_WEBHOOK_SECRET` exist and the daily job
  (03:17 UTC) has run once. Database and storage must be *Operational*.
- Sign out and in again: the 6-digit code must arrive by email (checks Resend end to end).
- Submit `/contact` with your own address: the enquiry appears in `/admin/enquiries`, the team
  notification reaches `projects@`, the confirmation reaches you.
- Browser DevTools → Network (these close CP-2 items that only Cloudflare can confirm):
  - any `/assets/*.js` file → response header `X-Content-Type-Options: nosniff` (from
    `public/_headers`, served by the static-asset service, not the Worker);
  - navigate client-side to *Account* → the `/account.data` request → `Cache-Control:
    private, no-store`;
  - the session cookie is named `__Host-vora_session` and is `Secure; HttpOnly; SameSite=Lax`.

  The same checks run locally in production mode over HTTPS (`npm run test:e2e:https`, CP-2.1);
  on Cloudflare they still need this look, because the edge and the static-asset service are
  only there.

Production (public):

```sh
curl -sS https://vorawebsites.store/api/health/ready
curl -sSI https://vorawebsites.store/ | grep -Ei 'strict-transport|content-security|x-frame'
curl -sS https://vorawebsites.store/ | grep -o '/assets/[^"]*\.js' | head -1 \
  | xargs -I{} curl -sSI https://vorawebsites.store{} | grep -i x-content-type-options
curl -sSI https://vorawebsites.store/api/dev/mailbox | head -1        # must be 404
```

Logs: `npx wrangler tail vora-web --format pretty` (production) — every response carries
`X-Request-Id`, which is also on every log line.

## 8. Production cutover from Mark4 (you run, planned window)

Today `vorawebsites.store` is served by the `vora-websites-mark2` proxy Worker (Railway origin).
Production `env.production` deliberately has **no routes**, so the first production deploy does
not touch the live site.

1. `npm run deploy:production` (types `production` to confirm).
2. Temporarily attach a private hostname for final checks, e.g. `next.vorawebsites.store`
   (Workers → vora-web → Settings → Domains & Routes → Add custom domain), protected by an
   Access application like staging. Run section 7 against it. Expected there: production's
   `APP_ORIGIN` is the apex, so Turnstile-protected forms (contact, and sign-in after repeated
   failures) **fail on `next.` by design** (`hostname_mismatch`), and links in emails point to
   the apex (still Mark4). Sign-in, the admin area and pages work. Test forms and email on
   staging, and again on the apex right after cutover.
3. Decide what happens to Mark4 data (enquiries, portal users). Nothing is migrated without an
   export and a written mapping.
4. Cutover: remove the custom domain / route from `vora-websites-mark2` and attach **only the
   apex** `vorawebsites.store` to `vora-web` as a Custom Domain. For `www`, add a **Redirect
   Rule** (Rules → Redirect Rules) sending `www.vorawebsites.store/*` to
   `https://vorawebsites.store` with a 301, keeping the path and query, and keep a proxied `www`
   DNS record. Do **not** attach `www` to the Worker: `vora-web` has no host canonicalisation,
   so on `www` the contact form's Turnstile hostname check would fail and `__Host-` sessions
   would split between the two hosts. Then add the apex route
   (`{ "pattern": "vorawebsites.store", "custom_domain": true }`) to `env.production` in
   `wrangler.jsonc` and redeploy so config matches reality; the pre-deploy check refuses a
   `www` route. `tests/tooling/deploy-config.test.ts` currently asserts that production has no
   routes, so that assertion is updated to the exact route at the same time, with your approval.
   Legacy Mark4 URLs (`/plans`, `/start-a-project`, `/founders`, …) are 301-redirected by the
   new Worker from the first request.
5. Keep `vora-websites-mark2` and Railway untouched for 14 days as the rollback path (re-attach
   the domain to mark2 to roll back).
6. Remove the temporary `next.` hostname and its Access application.

## 9. Rolling back a bad deploy

```sh
npx wrangler deployments list --name vora-web     # find the previous version
npx wrangler rollback --name vora-web             # or: npx wrangler rollback <version-id> --name vora-web
```

Because migrations are expand-only, the previous Worker version runs on the newer schema. A
migration that must be undone is handled with Time Travel — see `backup-and-recovery.md`.

A fixed version goes out the normal way (`npm run deploy:production`), never with a direct
`wrangler deploy` and never with `CLOUDFLARE_ENV` exported (§5).
