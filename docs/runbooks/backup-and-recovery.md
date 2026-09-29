# Runbook — Backup and recovery (Railway)

The database is SQLite on the service's volume (`/data/vora.db`; staging `/data/vora-staging.db`).
Four layers protect it (migration plan §6.9). Files (media, private uploads) live in R2.

> Everything that needs Railway or R2 is **NOT VERIFIED** until staging exists. Everything local
> is rehearsed: `npm run db:restore-rehearsal` and `scripts/docker-rehearsal.ts` (§5).

## 1. What protects what

| Layer | What | Recovery point | Kept | Notes |
|---|---|---|---|---|
| 1 · Litestream | Continuous replication of the database to the environment's **private** R2 backups bucket | ≈ 1 s | Litestream's retention | Runs in the container (`litestream replicate -exec`). An empty volume restores from it automatically on start. Staging/production refuse to start without it. |
| 2 · Railway volume backups | Daily / weekly / monthly | ≤ 24 h | 6 / 27 / 89 days | Restore only within the same project and environment. Wiping the volume deletes them — hence layer 1. |
| 3 · Pre-migration snapshots | `VACUUM INTO /data/pre-migrate-<time>.db` before any migration runs | that moment | last 3 | Written by the server itself. |
| 4 · Export | `npm run backup:export -- --env <env>`: the latest replica restored to a local file | ≈ 1 s | as long as you keep the file | Personal data: store encrypted, never commit or share. |

R2 files: R2 has no versioning here; media can be re-uploaded from source, private files (CVs,
client files) are the critical set — a periodic `rclone`-style copy to a second bucket is a
future decision (not implemented).

## 2. Routine

- **Monthly:** `npm run backup:export -- --env production` → `npm run db:integrity:local -- --db <file>`
  → store the file encrypted.
- **Quarterly:** a restore drill on staging (§4).
- **After every deploy:** the smoke test's backup check (`deployment.md` §5).

## 3. Restoring

### 3.1 From the Litestream replica (the normal path — point in time, ≈ 1 s)

1. Maintenance on (`node build/server/index.js maintenance on "Restoring"` inside the service), or
   stop the service if the database is unusable.
2. Stop the service. Detach or clear the volume's database (move `/data/vora.db*` aside — never
   delete until the restore is verified).
3. Start the service: the entrypoint runs `litestream restore -if-db-not-exists
   -if-replica-exists` and restores the **latest** replica. For a specific time, restore to a
   file first with `litestream restore -timestamp <RFC3339> -o /data/restored.db <replica URL>`,
   check it (`node build/server/index.js integrity` with `DATABASE_PATH` pointing at it), then
   put it in place.
4. Check `/api/health/live`, `/admin/system`, a sign-in; maintenance off.

### 3.2 From a pre-migration snapshot (undo a migration)

Maintenance on → stop the service → copy `/data/pre-migrate-<time>.db` over the database
(remove its `-wal`/`-shm` files) → redeploy the **previous** image → maintenance off. Anything
written after the snapshot is lost; take it from the Litestream replica (§3.1) if needed.

### 3.3 From a Railway volume backup

Railway → service → Volume → Backups → restore (same project and environment only). Then as §3.1
step 4.

### 3.4 From a D1-style SQL export (legacy)

`npm run db:restore-prepare -- <export.sql>` reorders a D1 export so it imports into an empty
database (parents before children). Kept for any old export; Railway's backups are SQLite files.

## 4. Restore drill (quarterly, on staging — you run)

1. `npm run backup:export -- --env staging` → a local copy of the latest replica.
2. `npm run db:integrity:local -- --db <file>` → `quick_check: ok`, 0 foreign-key violations.
3. Compare counts with production-like expectations (users, enquiries, audit rows).
4. Record the row: date · replica timestamp · integrity result · time taken.

## 5. Local rehearsals (any time — no account)

- `npm run db:restore-rehearsal` — real activity through the production build running under
  **Litestream** (file replica), then `litestream restore` and a `VACUUM INTO` snapshot into fresh
  files; both compared with the source (tables, schema SQL, every row's SHA-256, migrations,
  `quick_check`, `integrity_check`, `foreign_key_check`, triggers); then the Owner signs in on the
  restored database with a recovery code issued before the backup. Needs `litestream` 0.5.x.
- `npm run docker:build && npx tsx scripts/docker-rehearsal.ts` — the production **image**: fresh
  volume, SIGTERM, restart on the same volume, restore on an empty volume from the replica, a
  failing migration leaving its snapshot.

## 6. Disaster scenarios

| Scenario | First actions |
|---|---|
| Bad deploy | Redeploy the previous deployment in Railway; request IDs from users find the log lines. |
| Bad migration | The deploy never goes live (start-up fails, health check fails) and the snapshot is kept; if it did go live: §3.2. |
| Accidental deletion / corruption | Find the time in `audit_logs`; restore the replica at an earlier time into a **separate file** (§3.1) and copy back only the affected rows. |
| Volume lost | Start the service on a new, empty volume: the entrypoint restores the latest replica (§3.1). |
| R2 outage | The site keeps running; replication resumes when R2 returns (Litestream retries). Media fails to load meanwhile. |
| Compromised staff account | Suspend and revoke (`operations.md` §5); review `audit_logs` / `security_events`; rotate `AUTH_SECRET` if server secrets may be exposed. |
| Railway/Cloudflare account compromise | Account 2FA; rotate every sealed variable and the R2 tokens; review `audit_logs` for unexpected changes. |

Targets: application RTO < 1 hour; data RTO < 4 hours; RPO ≈ 1 second (Litestream).
