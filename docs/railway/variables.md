# VORA on Railway — environment variables

Names and meanings only. **No value of a secret ever appears in this repository.** The templates
`config/railway.staging.env.example` and `config/railway.production.env.example` hold the plain
values; sealed values are always empty there. `tests/tooling/railway-config.test.ts` checks the
templates against this page and against the start-up validation.

- **Plain** variables are ordinary Railway variables.
- **Sealed** variables are entered in Railway's variable editor with *Seal* switched on. A sealed
  value is never shown in the UI and never returned by the CLI or API. Never type one into a shell
  command, a chat or a commit.
- Each environment (`staging`, `production`) has its own values. Nothing is shared between them.
- The server **refuses to start** when a required value is missing or unsafe, and logs the
  variable's *name* (never its value). Railway's deploy health check (`/api/health/live`) then
  keeps the deploy from going live.

## Application

| Variable | Kind | Staging | Production | Notes |
|---|---|---|---|---|
| `APP_ENV` | plain | `staging` | `production` | Selects production behaviour (HSTS, `__Host-` cookies, origin auth). Required. |
| `APP_ORIGIN` | plain | `https://staging.vorawebsites.store` | `https://vorawebsites.store` | The public URL. Every request URL is rebuilt from it (never from `Host` or `X-Forwarded-Proto`). Must be https. |
| `APP_NAME` | plain | `VORA` | `VORA` | |
| `EMAIL_TRANSPORT` | plain | `resend` | `resend` | `capture` is refused in staging/production. |
| `EMAIL_FROM` | plain | `VORA <hello@vorawebsites.store>` | same | |
| `EMAIL_REPLY_TO` | plain | `hello@vorawebsites.store` | same | |
| `TEAM_NOTIFY_EMAIL` | plain | `projects@vorawebsites.store` | same | Enquiry alerts. |
| `CAREERS_NOTIFY_EMAIL` | plain | `careers@vorawebsites.store` | same | |
| `TURNSTILE_SITE_KEY` | plain | the staging widget's site key | the production widget's site key | Cloudflare's test keys are refused (H1). |
| `AI_GATEWAY_BASE_URL` | plain | empty | empty | Optional Cloudflare AI Gateway for VORA AI (off). |
| `MAINTENANCE_MODE` | plain | `off` | `off` | `on` forces the maintenance page (operations runbook §3). |
| `LOG_LEVEL` | plain | `info` | `info` | |
| `AUTH_SECRET` | **sealed** | ≥ 32 random bytes | ≥ 32 random bytes | Signs tokens, hashes IPs. Required. Different per environment. |
| `AUTH_SECRET_PREVIOUS` | **sealed** | empty (rotation only) | empty (rotation only) | The previous `AUTH_SECRET` during a rotation. |
| `RESEND_API_KEY` | **sealed** | Resend key | Resend key | Required with `resend`. |
| `RESEND_WEBHOOK_SECRET` | **sealed** | Resend webhook secret | same | Optional; the health page flags it when missing. |
| `TURNSTILE_SECRET_KEY` | **sealed** | Turnstile secret | Turnstile secret | Required. |
| `GEMINI_API_KEY` | **sealed** | empty | empty | VORA AI stays off (D8); server-side only when set. |
| `SETUP_TOKEN` | **sealed** | set once for `/setup`, then removed | same | 24+ characters. Remove it after the first Owner exists. |

## Platform (Railway)

| Variable | Kind | Staging | Production | Notes |
|---|---|---|---|---|
| `ORIGIN_AUTH_SECRET` | **sealed** | ≥ 32 random characters | ≥ 32 random characters | Must equal the value the Cloudflare Transform Rule sets in `X-Vora-Origin-Auth`. Without it (or with a shorter one) staging/production refuse to start; requests without it are refused (403). |
| `CF_ACCESS_TEAM_DOMAIN` | plain | unset (optional: `<team>.cloudflareaccess.com`) | unset | Optional Cloudflare Access. When set with `CF_ACCESS_AUD`, every request except `/api/health/live` must carry a valid Access JWT; unset, only origin authentication applies. |
| `CF_ACCESS_AUD` | plain | unset (optional: the Access application's AUD tag) | unset | Set together with the team domain, or neither — one without the other refuses to start. |
| `DATABASE_PATH` | plain | `/data/vora-staging.db` | `/data/vora.db` | On the service's volume (mounted at `/data`). Absolute. |
| `R2_ACCOUNT_ID` | plain | Cloudflare account ID | same | R2's S3 endpoint is `https://<account>.r2.cloudflarestorage.com`. |
| `R2_BUCKET_MEDIA` | plain | `vora-media-staging` | `vora-media` | Public media. Never created by the app (H4). |
| `R2_BUCKET_PRIVATE` | plain | `vora-private-staging` | `vora-private` | CVs and client files; never public. |
| `R2_BUCKET_BACKUPS` | plain | `vora-backups-staging` | `vora-backups` | Litestream replica. Staging/production refuse to start without backups. |
| `R2_ACCESS_KEY_ID` | **sealed** | R2 token (this environment's three buckets, Object Read & Write) | same, production token | |
| `R2_SECRET_ACCESS_KEY` | **sealed** | R2 token secret | same | |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | plain | `30` | `30` | Railway's default is 0: SIGTERM, then SIGKILL immediately. |
| `UV_THREADPOOL_SIZE` | plain | `8` | `8` | Argon2id and file I/O share the libuv pool (also set in the image). |
| `NODE_ENV` | plain | `production` | `production` | Also set in the image. |
| `TZ` | plain | `UTC` | `UTC` | Also set in the image. |
| `PORT` | Railway | — | — | Provided by Railway; read, never set. |

## Local and rehearsal only (never set in Railway)

| Variable | Purpose |
|---|---|
| `HOST` | Listening address. Default `::` (IPv4 + IPv6), falling back to `0.0.0.0` where IPv6 is unavailable. |
| `SHUTDOWN_TIMEOUT_MS` | Bound for draining on SIGTERM (default 25 000 — inside Railway's 30 s). |
| `SCHEDULER` | `off` disables the in-process jobs (rehearsals only). |
| `MIGRATIONS_DIR`, `CLIENT_DIR` | Alternative locations (rehearsals only). |
| `R2_ENDPOINT` | A **loopback** S3 endpoint for local production-mode rehearsals; anything else is refused in staging/production. |
| `LITESTREAM_CONFIG`, `LITESTREAM_FILE_REPLICA` | The file-replica Litestream configuration used by the rehearsals (`docker/litestream.file.yml`). |

## Cloudflare settings that pair with these variables (not variables)

- Transform Rule 1 — set request header `X-Vora-Origin-Auth` to the `ORIGIN_AUTH_SECRET` value.
- Transform Rule 2 — set request header `X-Vora-ASN` to `to_string(ip.src.asnum)`.
- Managed transform — "Add visitor location headers" on (`cf-ipcity`, `cf-region`, …).
- SSL/TLS mode **Full** (Railway documents Full (strict) as not working as intended behind its edge).

All of this is part of checkpoint R8 and happens only with your approval — see
`docs/runbooks/deployment.md`.
