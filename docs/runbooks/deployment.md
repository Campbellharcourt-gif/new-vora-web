# Runbook — Environments, first deployment and cutover (Railway)

VORA runs as **one Node.js service on Railway** behind **Cloudflare** (DNS, TLS, WAF, cache,
Turnstile, R2, Access for staging). Architecture and reasons: `docs/VORA-RAILWAY-MIGRATION.md`.
Every variable: `docs/railway/variables.md`.

> **Status: nothing here has been done.** No Railway project, Cloudflare resource, bucket,
> token, DNS record or secret exists for this build. Every step below is yours, happens only
> after your explicit approval (checkpoint **R8**), and is **NOT VERIFIED** until staging proves it
> (checkpoint **R9**). The production cutover (**R10**) is a separate approval.

Rules that never change:

- Secrets are **sealed** Railway variables, entered in the dashboard's variable editor — never in
  a shell command, a chat, a file or a commit.
- Staging first, always. Production gets exactly what staging proved.
- Mark4 (the live site, its Railway project and the `vora-websites-mark2` proxy Worker) is never
  modified until the approved cutover, and is kept for 14 days after it.

## 0. Decisions and limits first

| # | Decision | Recommendation (migration plan §12.4) |
|---|---|---|
| D20 | Railway plan (Hobby is a purchase) | Hobby; **hard spending limit** ≈ $20/month and an email alert at $10, set *before* the first deploy |
| D21 | Region | Singapore (`asia-southeast1`), the nearest to Australia |
| D22 | Staging protection | Cloudflare Access (named emails only) + origin JWT check + origin-auth header |
| D24 | Database | SQLite on a volume + Litestream to R2 (PostgreSQL deferred) |
| D12 | Mark4 data | Unchanged question — nothing is migrated without an export and a written mapping |

## 1. Cloudflare (you, dashboard — per environment)

1. **R2 buckets** (all private): `vora-media-staging`, `vora-private-staging`,
   `vora-backups-staging` (production: `vora-media`, `vora-private`, `vora-backups`). The
   application never creates buckets.
2. **R2 API token** per environment: *Object Read & Write*, scoped to that environment's three
   buckets only. Keep the Access Key ID and Secret for step 3 (sealed variables).
3. **Turnstile** widget per environment (hostname = the environment's hostname). The site key is
   a plain variable, the secret a sealed one. Test keys are refused at start-up.
4. **Transform Rules** (Rules → Transform Rules → Modify Request Header), on the environment's
   hostname only:
   - set `X-Vora-Origin-Auth` = a new random value of ≥ 32 characters
     (`openssl rand -base64 48`, pasted straight into the rule and into Railway's sealed
     `ORIGIN_AUTH_SECRET` — nowhere else);
   - set `X-Vora-ASN` = `to_string(ip.src.asnum)`;
   - Managed Transforms → **Add visitor location headers** on.
5. **Access (staging only)**: an application for `staging.vorawebsites.store` with a policy naming
   approved email addresses only (never "Everyone"). Note the team domain and the application
   **AUD** tag → `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`.
6. **SSL/TLS mode: Full** (Railway documents Full (strict) as not working behind its edge).
   Always Use HTTPS on; minimum TLS 1.2. HSTS is sent by the application.
7. **Bot Fight Mode stays off** until tested against the Resend webhooks.

## 2. Railway (you, dashboard)

1. A **new project** `vora` (never the Mark4 project), environments `staging` and `production`,
   region per D21.
2. Service **`web`** from this repository's branch; Railway builds the root `Dockerfile`
   (no `railway.json` — config-as-code is deprecated and would bypass review).
3. **Volume** mounted at `/data` (one replica only — a volume allows no replicas).
4. **Variables**: every entry of `config/railway.<env>.env.example` — plain values as they are
   there, sealed values entered with *Seal* on. `docs/railway/variables.md` explains each.
5. **Settings**: health check path `/api/health/live` (checks process, database, migrations —
   never R2 or email); `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30`; restart policy *on failure*.
6. **Networking**: do **not** generate a `*.up.railway.app` domain. Add the custom domain
   (`staging.vorawebsites.store`) and create the DNS records Railway shows (proxied CNAME + TXT)
   in Cloudflare. If the certificate is not issued while proxied, switch the record to DNS-only
   until it is, then back (staging first).
7. **Spending limit** and alert (D20) — before the first deploy.

## 3. Deploy (Railway builds and starts the image)

Before merging a change for deployment, locally:

```sh
npm run verify            # typecheck, lint, unit + integration, build
npm run test:e2e          # Chromium; add test:e2e:browsers on your Mac
npm run test:e2e:https    # production mode over HTTPS behind a local Cloudflare stand-in
npm run deploy:check      # build → security scan → the IMAGE validates both environment templates
```

On start the container: restores the database from the R2 replica if the volume is empty →
runs the server under Litestream → the server validates configuration (refusing unsafe values),
opens SQLite (foreign keys, WAL), snapshots and applies pending migrations, runs the Argon2id
self-test, then listens. Any failure exits non-zero and the health check keeps the deploy from
going live.

## 4. Base data and the first Owner (once per environment)

Inside the service (`railway ssh`, select the service — NOT VERIFIED):

```sh
node build/server/index.js seed        # roles, permissions, DRAFT content (idempotent)
```

Then:

1. Set `SETUP_TOKEN` (sealed, 24+ characters) and redeploy.
2. Open `https://staging.vorawebsites.store/setup` (Access asks you to sign in first), enter the
   token, your name, email and a strong password. **Save the 10 recovery codes offline.**
3. Delete `SETUP_TOKEN` and redeploy (`/setup` already answers 404 once an Owner exists).
4. Invite the others from the admin; keep **two** Owners.

## 5. Smoke test (after every deploy)

- `/api/health/live` → `{"status":"live",…}`; `/status` lists components; `/admin/system` shows
  database and storage *Operational* and 3 migrations applied.
- **Origin protection:** a request that bypasses Cloudflare is refused — from your Mac,
  `curl -sI --resolve staging.vorawebsites.store:443:<Railway edge IP> https://staging.vorawebsites.store/`
  must answer **403** (no origin-auth header).
- **Client IP:** sign in and check *Account → Security*: the location is yours (proves
  `CF-Connecting-IP` and the location headers arrive through Cloudflare).
- Sign out and in: the 6-digit code arrives (Resend end to end). Submit `/contact`: the enquiry
  appears in `/admin/enquiries`; both emails arrive.
- Headers: `Strict-Transport-Security`, a CSP with a nonce, `__Host-vora_session` (Secure,
  HttpOnly, SameSite=Lax), `/assets/*` immutable + `nosniff`, `/api/dev/mailbox` → 404.
- Logs (Railway → service → Logs): one JSON line per entry with `level` and `message`; every
  response's `X-Request-Id` appears in its log lines.
- Backups: the `vora-backups-<env>` bucket receives Litestream files within a minute of a write.

## 6. Production cutover from Mark4 (separate approval — R10)

1. Staging has passed §5 and a restore drill (`backup-and-recovery.md` §4).
2. Deploy production (no custom domain yet); attach a temporary protected hostname
   (e.g. `next.vorawebsites.store` behind Access) and run §5 there. Turnstile and email links
   are bound to the apex, so forms fail on `next.` by design — test them on staging.
3. D12: decide about Mark4 data; nothing is migrated without an export and a written mapping.
4. Cutover window: point the apex `vorawebsites.store` (proxied CNAME) at the production service's
   custom-domain target; add a **Redirect Rule** `www` → apex (301, path and query kept). Legacy
   Mark4 URLs are 301-redirected by the application from the first request.
5. Keep Mark4 and `vora-websites-mark2` untouched for **14 days** (rollback = point DNS back).
6. Remove the temporary hostname and its Access application.

## 7. Rolling back

- **Application:** Railway → Deployments → redeploy the previous deployment. Migrations are
  expand-only, so the previous image runs on the newer schema.
- **A migration that must be undone:** maintenance on → stop the service → restore the
  pre-migration snapshot (`/data/pre-migrate-<time>.db`, the last three are kept) over the
  database → redeploy the previous image → maintenance off. See `backup-and-recovery.md` §3.
- A deploy on a volume has a short outage (no overlap). Deploy at quiet times.
