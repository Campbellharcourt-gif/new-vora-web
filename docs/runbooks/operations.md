# Runbook — Day-to-day operations and security procedures

VORA runs as one Node service on Railway (`deployment.md`). The admin screens for settings,
flags and user management grow in Phase 5 — until then the SQL below is the supported path.

**Where the commands run:** inside the service, where the volume is mounted — `railway ssh`
(select the environment and the `web` service), then the commands below. Railway access is the
control: whoever can open that shell can read the database. *NOT VERIFIED until staging.*

Shorthand used below (inside the service):

```sh
vdb() { node build/server/index.js query "$1"; }                      # read-only, one statement
vdb_write() { node build/server/index.js exec "$1" --confirm-write; } # one write — record who and why
```

## 1. Health and status

| Endpoint | Who | Meaning |
|---|---|---|
| `/api/health` | anyone | the server is running (`{"status":"ok"}`) |
| `/api/health/live` | Railway's deploy check (exempt from origin auth) | process + database + all migrations applied + foreign keys on; states only |
| `/api/health/ready` | anyone | the database answers (`ready` / 503 `unavailable`) |
| `/status`, `/api/v1/status` | public | component states only (website, email, AI, media) — no internals |
| `/admin/system`, `/api/v1/system/status` | `system.status` (Admin, Owner) | per-component detail: migrations applied, email outcomes in the last hour, AI provider, storage, cron runs, missing optional secrets |

*Degraded* is expected while optional secrets are unset (for example `GEMINI_API_KEY` before
AI is enabled) — the detail names the missing key, never its value.

## 2. Logs and request IDs

Every response carries `X-Request-Id` (Cloudflare Ray ID when present), shown on error pages as
“Reference …”. Every log line carries the same ID.

Logs are one line of JSON per entry with `level` and `message` (what Railway parses): Railway →
project → service → **Logs**, filter e.g. `@requestId:<id>` or `@level:error`. Railway keeps them
7 days on Hobby (no log drain) — security events and the audit trail are also in the database,
kept 1–2 years (§6).
Passwords, tokens, codes, cookies and API keys are redacted by the logger before output: values
under sensitive field names are replaced, and (CP-2.1, decision O-2) credentials written inside
free text — error messages, stack traces, provider errors — are scrubbed too, for example
`password=…`, `Bearer …`, JWTs, Resend/Google/GitHub keys, Turnstile secrets, private-key
blocks, `vora_session=…` and sign-in codes. Email addresses are **not** scrubbed (they are
needed to investigate delivery problems); treat log exports as personal data.

Log levels (CP-2.1, decision O-1): server failures (5xx) are logged at `error`, **except the
planned maintenance 503**, which is logged at `info` with `maintenance: true` — so an alert on
`level = error` does not fire for every visitor during planned maintenance, while a real outage
(including a 503 from a configuration or database failure) still does. To see maintenance
traffic, filter on `maintenance = true`.

## 3. Maintenance mode

| Situation | Action |
|---|---|
| Planned work, database healthy | inside the service: `node build/server/index.js maintenance on "Back at 3pm AEST"` … `maintenance off` (audited; ~30 s to apply) |
| Database or server broken | set the variable `MAINTENANCE_MODE=on` in Railway and redeploy; revert the same way |

During maintenance the public gets a 503 page (with `Retry-After`); `/api/health*`, `/login`
and `/logout` stay reachable, and signed-in staff with `admin.access` or `maintenance.manage`
keep working normally.

## 4. Account lockouts and sign-in problems

```sh
vdb "select email, status, locked_until from users where email = 'person@example.com'"
vdb "select outcome, country, datetime(created_at/1000,'unixepoch') at from login_attempts
     where user_id = (select id from users where email = 'person@example.com')
     order by created_at desc limit 20"
```

Locks lift by themselves after 15 minutes. To lift one early (write):

```sh
vdb_write "update users set locked_until = null where email = 'person@example.com'"
```

A person who lost access to their email **and** their recovery codes cannot pass 2FA. Verify
their identity out of band, then an Admin/Owner either changes their account email (Phase 5
admin) or — for the only Owner — follow §7.

## 5. Suspending an account and revoking sessions

The admin Users screen currently lists users and sends invitations; its suspend and role
controls arrive in Phase 5 (the underlying services exist and are tested — suspension revokes
every session). Until then, SQL (write):

```sh
vdb_write "update users set status = 'suspended' where email = 'person@example.com'"
vdb_write "update sessions set revoked_at = (unixepoch()*1000), revoked_reason = 'operator'
     where user_id = (select id from users where email = 'person@example.com') and revoked_at is null"
```

The database refuses to suspend, delete or demote the **last active Owner** — invite and
promote a second Owner first.

## 6. Reviewing security events and the audit trail

```sh
vdb "select type, severity, count(*) n from security_events
     where created_at > (unixepoch()-86400)*1000 group by 1,2 order by n desc"
vdb "select datetime(created_at/1000,'unixepoch') at, action, summary, actor_user_id
     from audit_logs order by created_at desc limit 50"
```

Events to act on: `auth.login.locked` spikes (password spraying), `auth.ip.blocked`
(credential stuffing), `auth.login.suspicious` with severity `high` (privileged account from a
new country), `auth.setup.rejected` (someone probing `/setup`), repeated `authz.denied` for one
user, `csrf.rejected` bursts.

Neither table can be edited or have recent rows deleted — not even by the application.

## 7. Secret rotation

**AUTH_SECRET** (suspected leak, staff departure with server access, or yearly):

1. Railway → production → Variables: set the sealed `AUTH_SECRET_PREVIOUS` ← the *current* value.
2. Set the sealed `AUTH_SECRET` ← a new `openssl rand -base64 48`, then redeploy.
3. Effects: sessions keep working (they are stored as SHA-256 of the cookie, not keyed by the
   secret); open sign-in codes and form tokens keep verifying via the previous secret; login
   risk signals restart (IP/email/device hashes change), so some people get one “new sign-in”
   email.
4. **Recovery codes** were HMAC'd with the old secret and verify only while
   `AUTH_SECRET_PREVIOUS` holds it. Ask privileged users to regenerate codes (Account → Security),
   then after ~30 days delete `AUTH_SECRET_PREVIOUS` in Railway and redeploy.
   If the old secret itself leaked, delete it immediately instead and have everyone regenerate.

**RESEND_API_KEY / TURNSTILE_SECRET_KEY / GEMINI_API_KEY / R2 token:** create the new key at the
provider, replace the sealed variable in Railway, redeploy, confirm health in `/admin/system`,
then revoke the old key at the provider.

**ORIGIN_AUTH_SECRET:** there is no overlap window, so rotate in a quiet moment: set the new value
in the Cloudflare Transform Rule and in Railway's sealed variable, redeploy; requests between the
two changes are refused (403) for a few seconds.

**An Owner lost their password, mailbox access and recovery codes:** there is deliberately no
application back door. In order of preference:

1. Another Owner handles it — this is why you should keep **two** Owners.
2. Recover the mailbox with the email provider, then use “Forgot password”; sign-in codes go to
   that mailbox.
3. Last resort, needs Railway access: point the account at a mailbox you control
   (`vdb_write "update users set email = '…' where id = 'usr_…'"`), then “Forgot password”. Write
   down who did this and why — a direct SQL change bypasses the application audit log.

## 8. Email outbox

```sh
vdb "select status, count(*) n from email_outbox group by 1"
vdb "select id, template, to_email, attempts, last_error, datetime(updated_at/1000,'unixepoch') at
     from email_outbox where status in ('failed','dead') order by updated_at desc limit 20"
```

`failed` rows retry automatically (the in-process job every 5 minutes, 25 per run, backoff up to
6 hours). `dead` rows
need a decision: fix the cause (unverified domain, bad address) and re-queue (write):

```sh
vdb_write "update email_outbox set status = 'failed', next_attempt_at = unixepoch()*1000, attempts = 0
     where id = 'eml_…' and sensitive = 0"
```

Sensitive messages (sign-in codes, reset and invitation links) are never stored or re-sent —
the person simply requests a new one.

## 9. Scheduled jobs

```sh
vdb "select job, status, datetime(started_at/1000,'unixepoch') at, details
     from job_runs order by started_at desc limit 10"
```

The jobs run inside the web service (an in-process UTC scheduler; a job still running is never
started twice). `email-retry` runs every 5 minutes; `daily` (03:17 UTC) expires sessions, codes and tokens,
applies retention (login history 180 days, email outbox 90 days, closed enquiries anonymised
after 24 months) and re-syncs roles from code when `RBAC_VERSION` changes. `/admin/system`
reports *degraded* if either has not succeeded recently.
