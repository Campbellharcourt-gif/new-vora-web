# Runbook — Backup and recovery

Status: the export → restore procedure (§3.2) **passes a local rehearsal** on throwaway local
databases (§6, `npm run db:restore-rehearsal`, CP-2.1). It has **not yet been exercised against a
real Cloudflare database** (NOT VERIFIED — no staging/production databases exist yet). The first
restore drill (§5) is that verification; record its result at the bottom of this file.

## 1. What protects what

| Asset | Protection | Recovery point | How to restore |
|---|---|---|---|
| D1 — all application data | **Time Travel**: any minute in the last 30 days on Workers Paid — **7 days on Workers Free** | ~1 minute | §3.1 (in-place, destructive) |
| D1 — long-term | `npm run backup:export -- --env production --upload` → `vora-backups` R2 bucket; keep 12 weekly + 12 monthly | last export | §3.2 (into a fresh database) |
| R2 media / private files | Media library (Phase 5) soft-deletes and keeps replaced files 30 days (`media_revisions.purge_after`); optional monthly off-site copy (rclone) | ≤ 30 days for deletions | copy objects back by key |
| Secrets | Cloudflare secrets (values unreadable); a sealed offline note of *which* secrets exist; Owner recovery codes offline | — | re-issue / rotate (`operations.md`) |
| Code and config | Git (every commit) | per commit | redeploy a tag, or `wrangler rollback` |

Audit and security trails are protected inside the database as well: `audit_logs` and
`security_events` cannot be updated and cannot be deleted before 2 years / 1 year (database
triggers), and published content versions can never be deleted.

## 2. Routine (you run)

**Before every production migration** (the migration script asks for confirmation; do these
first and paste the output into the deploy log):

```sh
npx wrangler d1 time-travel info vora-production --env production     # note the bookmark
npm run backup:export -- --env production --upload                     # SQL export → backups/ and R2
```

**Weekly** (until a scheduled GitHub Action exists — it needs the repository and a scoped
`CLOUDFLARE_API_TOKEN` secret with D1 read + R2 write):

```sh
npm run backup:export -- --env production --upload
```

Exports are written to `backups/` (git-ignored). Delete local copies once they are in R2; they
contain personal data (enquiries, user emails, hashed passwords).

## 3. Restoring

### 3.1 Point in time (Time Travel) — undo a bad migration, bulk mistake or corruption

Time Travel restores **in place** and **overwrites** everything after the chosen point. Take a
bookmark of the current state first so the restore itself can be undone.

```sh
npm run maintenance -- --env production --on "Restoring data — back shortly"
npx wrangler d1 time-travel info vora-production --env production                     # current bookmark (undo point)
npx wrangler d1 time-travel restore vora-production --env production --timestamp=2026-10-01T09:30:00Z
# or: --bookmark=<bookmark recorded before the migration>
```

Then roll the Worker back if the bad state came with a deploy (`deployment.md` §9), check
`/admin/system`, spot-check recent enquiries and users, and switch maintenance off.

Anything written between the restore point and the restore is lost (for example enquiries
received in that window). Before restoring, export those rows if they matter:

```sh
npx wrangler d1 execute vora-production --env production --remote --json \
  --command "select * from enquiries where created_at > <unix-ms of restore point>" > enquiries-window.json
```

### 3.2 From an export — older than the Time Travel window (30 days on Paid, 7 on Free), or into a clean database

Never import over the live database. Restore into a new database, verify, then switch the binding.

```sh
npx wrangler r2 object get vora-backups/d1/vora-production/<stamp>.sql --remote --file restore.sql
npm run db:restore-prepare -- restore.sql          # writes restore.restore.sql (local file step)
npx wrangler d1 create vora-production-restore --location oc --update-config=false
npx wrangler d1 execute vora-production-restore --remote --file restore.restore.sql --yes
npx wrangler d1 execute vora-production-restore --remote --command \
  "select (select count(*) from users) users, (select count(*) from enquiries) enquiries, (select count(*) from d1_migrations) migrations"
```

**Why the prepare step.** An export lists each table in creation order, each followed by its rows.
VORA's first migration creates several tables that reference `users` before `users` itself, so
importing an export **as-is** into an empty database stops at the first such row with
`no such table: main.users` (reproduced locally with Wrangler 4.141, CP-2.1). `PRAGMA
defer_foreign_keys` at the top of the export only postpones the constraint check; SQLite still
needs the referenced table to exist. `db:restore-prepare` reorders the file: every `CREATE TABLE`
first, then the rows (referenced tables' rows before the rows that point at them), then indexes,
triggers and views — as in the export, after the data. It never edits a statement, refuses a file
containing anything an export does not contain, never contacts Cloudflare and never prints the
file's contents. Remote behaviour of the import is NOT VERIFIED until the first drill (§5).

`--update-config=false` stops Wrangler from offering to write the new database into
`wrangler.jsonc` (its default answer is Yes, and without `--env` it would edit the **local**
configuration). Put the new `database_id` into `env.production` yourself, as below.

If it checks out: put the new `database_id` in `env.production` of `wrangler.jsonc`, deploy,
verify, and keep the old database until you are sure.

## 4. Disaster scenarios

| Scenario | First actions |
|---|---|
| Bad deploy | `npx wrangler rollback --name vora-web`; investigate with `wrangler tail` and the request IDs users report. |
| Bad migration | Maintenance on → Time Travel to the pre-migration bookmark (§3.1) → roll back the Worker → maintenance off. |
| Accidental deletion / corruption | Find the time from `audit_logs`; export affected rows from a Time Travel restore made into a *copy* (§3.2 approach) where possible, rather than rewinding the live database. |
| Compromised staff account | Suspend the user and revoke their sessions (`operations.md` §5); review `audit_logs` and `security_events` for their user ID; rotate `AUTH_SECRET` if server-side secrets may be exposed. |
| Email provider outage | Nothing is lost: ordinary email waits in the outbox and the 5-minute cron retries with backoff (1, 5, 15, 60, 360 min; dead after 6). Sign-in codes fail visibly and users can resend; recovery codes still work. |
| AI provider outage | VORA AI returns a friendly message and fails fast after 5 errors (circuit breaker); nothing else depends on it. |
| Cloudflare account compromise | Account 2FA, scoped API tokens only, review the account audit log, rotate all Worker secrets (`deployment.md` §3), then check D1 for unexpected changes via `audit_logs`. |

Targets: application RTO < 1 hour; data restore RTO < 4 hours; RPO ~1 minute (Time Travel).

## 5. Restore drill (quarterly — you run)

1. `npm run backup:export -- --env production` (no upload needed for a drill).
2. `npm run db:restore-prepare -- backups/<file>.sql`, then restore the `.restore.sql` file into a
   throwaway database as in §3.2 (`vora-restore-drill`).
3. Compare counts against production (`users`, `enquiries`, `audit_logs`, `d1_migrations`).
4. `npx wrangler d1 delete vora-restore-drill` and delete both local `.sql` files.
5. Record the date, export size, row counts and time taken below.

| Date | Export | Counts match | Duration | By |
|---|---|---|---|---|
| — | — | — | — | — |

## 6. Local restore rehearsal (any time — no Cloudflare access)

```sh
npm run db:restore-rehearsal          # add -- --keep to keep .wrangler/restore-rehearsal/
```

Runs §3.2 end to end on throwaway local databases under `.wrangler/restore-rehearsal/` (deleted
afterwards): a fresh database (migrations + seed) gets real activity through the production build
(first Owner via `/setup`, an enquiry, a failed and a successful Owner sign-in); it is exported
with `wrangler d1 export --local`, prepared with `db:restore-prepare`, and imported into a **fresh,
empty** database. The restored database must then match the source — tables, indexes, triggers
and their SQL, every table's row count and SHA-256, `sqlite_sequence`, applied migrations — pass
`PRAGMA quick_check` and `PRAGMA foreign_key_check`, still refuse audit/security edits and removal
of the last Owner (triggers), and serve the app: `/setup` stays closed, the Owner signs in with
their password and a recovery code issued before the export, and the enquiry is listed in
`/admin/enquiries`. Every Wrangler call is `--local`; `--remote` and `--env` are refused. It prints
no secrets, codes or row contents. (`PRAGMA integrity_check` is not permitted by D1, so
`quick_check` is used.) It also imports the unprepared export into a separate empty database and
reports the result, so a change in that behaviour is visible.

| Date | Result | Export | Duration | Notes |
|---|---|---|---|---|
| 2026-09-27 | 23 passed, 0 failed, 2 informational | 94,759 bytes, 53 tables, 266 rows | 47 s | CP-2.1 gate, build sandbox (Linux). Unprepared export: `no such table: main.users` |
