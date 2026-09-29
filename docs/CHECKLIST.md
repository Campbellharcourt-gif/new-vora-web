# VORA — Running Implementation Checklist

Legend: `[x]` done and verified · `[~]` in progress / partly verified · `[ ]` not started · `[!]` blocked on you
Verification states used in reports: **PASS** (actually run and passed) · **FAIL** · **NOT VERIFIED** (could not be run here — exact command provided)

## Phase 0 — Discovery
- [x] Inspect 4 screen recordings (frames + crops)
- [x] Inspect attached mark image (colour sampling)
- [x] Read memory (VORA, Solara)
- [x] Inventory live Mark4 site content
- [x] Inventory Cloudflare account (Workers, D1, KV, R2) — read-only
- [x] Read supplied skills
- [x] Discovery report (`00-DISCOVERY.md`)
- [x] Architecture (`01-ARCHITECTURE.md`, 21 sections)
- [x] Approval of §21 decisions (D1–D4 approved 26 Sep 2026; the rest on recommended defaults)

## Phase 1 — Foundation (report: `02-PHASE1-REPORT.md`)
- [x] Scaffold (React Router 8 + Hono + Vite + Cloudflare plugin), TypeScript strict
- [x] Lint/format (Biome), typegen, scripts
- [x] Typed env schema (fails closed), `.dev.vars.example`, wrangler envs (local/staging/production)
- [x] Server-only boundary (`app/.server`)
- [x] Database schema (all domains) + migrations `0000`–`0002` + integrity triggers
- [x] Seeds: roles, permissions, socials, partner, draft pages/services/projects/roles (real facts only)
- [x] Core libs: IDs, crypto, errors, cookies, request metadata, time
- [x] Structured logger with redaction + request IDs
- [x] Security headers + CSP nonce (every script nonced — E2E)
- [x] CSRF origin gate (API + pages)
- [x] Maintenance mode (setting + env override + staff bypass + CLI script)
- [x] Feature flags (defaults, overrides, role/environment rules, audited management service)
- [x] Rate limiting (Workers binding + D1 account throttles + IP-hash credential-stuffing block)
- [x] Password hashing (Argon2id) + policy + breach check (fail-open)
- [x] Sessions (hashed tokens, rotation, idle/absolute expiry, revocation, re-validation per request)
- [x] Login + lockout + enumeration protection
- [x] Email OTP 2FA + challenges (attempt limits, cooldown, hourly cap, replay-proof)
- [x] Recovery codes (single use, alerts)
- [x] Step-up (elevated) access
- [x] Password reset
- [x] Invitations (rank rules, client organisations)
- [x] Owner bootstrap — service tested; `/setup` exercised end to end with and without JavaScript (CP-2.1), which found and fixed a bug: the one-time recovery codes were not shown after a successful setup
- [x] Login history + risk scoring + alerts
- [x] Permissions catalogue + default roles + policies + guards
- [x] Audit log + security events services (append-only in the database)
- [x] Email transports (Resend, capture), templates, outbox, cron retry — Resend itself NOT VERIFIED
- [x] Enquiry pipeline (validation, form token, honeypot, Turnstile, limits, persistence, notifications) — live Turnstile NOT VERIFIED
- [x] Health: app, DB, email, AI, storage, jobs, configuration; public `/status`
- [x] AI provider interface + Gemini adapter + guard rails — live Gemini NOT VERIFIED
- [x] Route shells: public, auth, account, admin, client, member
- [ ] Route shell: `/preview` (arrives with CMS editing, Phase 5)
- [x] Error pages: 404, 403, 500, maintenance, validation, configuration-unavailable
- [x] Tests: unit + integration (workerd) + E2E (production build, desktop + mobile, axe) + HTTPS production mode (CP-2.1)
- [~] E2E in WebKit (Safari engine) and Firefox — matrix defined and listed (CP-2.1); runs NOT VERIFIED until done on your Mac (`npm run test:e2e:browsers`)
- [x] Runbooks: deployment, backup & recovery, operations
- [x] Verification: typecheck, lint, tests, build
- [!] Staging and production deployment — NOT VERIFIED (needs your Cloudflare login; `docs/runbooks/deployment.md`)
- [~] Restore: local rehearsal PASS (CP-2.1, `npm run db:restore-rehearsal`; export needs `db:restore-prepare` before import)
- [!] First restore drill on Cloudflare — NOT VERIFIED (`docs/runbooks/backup-and-recovery.md` §5)

## Verification checkpoints (`VERIFICATION-LOG.md`)
- [x] CP-0 · Phase 1 foundation (build sandbox)
- [x] CP-1 · Integration 111/111 on your machine — reproduced; integrity audited; stderr reviewed
- [x] CP-2 · Security verification of the production build — 15 E2E checks, secret/bundle scan,
      deployment-config guards, dependency audit; findings S-1…S-5 fixed and tested
- [x] Observations O-1 (maintenance logged as error) and O-2 (log-message scrubbing) — decided and implemented in CP-2.1
- [x] CP-2.1 · Local checks (first-Owner E2E, restore rehearsal, HTTPS production mode, WebKit/Firefox matrix) and deployment safety (H1–H4, runbook corrections) — WebKit/Firefox runs NOT VERIFIED (your Mac)
- [!] CP-3 · Staging on Cloudflare — paused at Step 1 (Workers Paid not purchased); needs your login (`runbooks/deployment.md` §0–7)
- [~] CP-3 · Cloudflare Free audit — password hashing moved to a Durable Object, `limits.cpu_ms` removed, Free-limit fixes; signed-in flows still measured over the Free CPU limit — decision needed (`CLOUDFLARE-FREE-COMPATIBILITY.md`)

## Waiting on you
- [!] VORA logo files (SVG) — or confirmation that the eye/star mark is the logo
- [!] Budget ranges for the enquiry form (the field stays hidden until provided)
- [!] Legal entity details and approved Terms / Privacy / Cookies text
- [!] Decision on Mark4 data (export and migrate enquiries/portal users, or start clean)
- [!] Typeface licensing (commercial fonts TBC)
- [!] Blender Phase 2.2 files (hero environment — Phase 3)
- [!] Staging Access allow-list emails; Resend domain verification; Turnstile widgets

## Phase 2 — Visual system (`VORA-DESIGN-SYSTEM.md`; log: `VERIFICATION-LOG.md` DS-1, DS-2)
- [x] Tokens (Appendix A), Basalt / Mist / workspace roles, self-hosted Archivo · Newsreader · DM Mono with metric-matched fallbacks
- [x] Primitives: survey line, aperture, instrument label, buttons, links, form controls, status, notices, tables, section header, invitation, project / service / process / careers components
- [x] Navigation: header states, menu dialog (+ `<details>` without JS), footer; View Transitions; fire-once reveals; reduced motion (OS setting; Save-Data)
- [x] Every route rebuilt (public, system, auth, portals); Home as the T0 typographic stations (D9)
- [x] VORA AI: grounded public assistant, off by default (flag + setting + server key), allow-listed sources
- [x] Responsive review (1440 / 390 / 320), axe on every public page, both motion modes, auth and each portal area
- [x] JavaScript before interaction under 120 KB gzipped on every marketing page (116.1–119.8 KB; DS-2)
- [ ] Focus after choosing a page from the mobile menu dialog lands on `<body>`, not the new h1 (since DS-1; found in DS-2)
- [!] WebKit / Firefox and a VoiceOver pass — your Mac
- [!] Open decisions keep their fallbacks: D5 logo (text wordmark), D9 renders (T0 stations), D10 fonts (Archivo/Newsreader/DM Mono), D13 testimonials (off), D18 Design page (part of Websites), D19 Journal (deferred), Motion cookie `vora_motion` (OS setting only), `dominantColor` (basalt-900 placeholder)
- [!] Copy slots and media: positioning line, invitations per page, leads, service bodies and who-does-what, principle bodies, "what happens next"; case-study captures, covers, service plates; the media delivery route (Phase 5)

## Phases 3–8
Hero (3) · Public site (4) · Backend/CMS/admin (5) · Portals (6) · VORA AI (7) · QA/launch (8) — see `01-ARCHITECTURE.md` §19.

## Railway migration (plan: `VORA-RAILWAY-MIGRATION.md`; log: `VERIFICATION-LOG.md` RW-1)
- [x] R0 — CP-3 imported unchanged, docs patch applied, baseline re-run (200 · 124 · 83 · 7)
- [x] R1 — Node 24 server, platform adapter, static files, one-line JSON logs, graceful shutdown
- [x] R2 — native Argon2id (byte-identical to @noble), self-test, back-pressure; Durable Object removed
- [x] R3 — libSQL SQLite (foreign keys, WAL), start-up migrations + snapshots, `affectedRows()`
- [x] R4 — R2 S3 adapter, in-process limiters, background tasks, UTC scheduler, `/api/health/live`, batch 25
- [x] R5 — origin authentication, trusted Cloudflare headers, URL from APP_ORIGIN, Access JWT
- [x] R6 — Node test harness (unchanged test files), Cloudflare-only tests replaced (TEST-MAPPING.md), mutation check 20/20
- [x] R7 — Dockerfile + Litestream + restore rehearsal (37/37) + Docker rehearsal (25/25) + deploy:check
- [!] R7 on your Mac — Docker rehearsal and WebKit/Firefox E2E (commands in VERIFICATION-LOG.md RW-1)
- [!] R8 — accounts (Railway project, volume, sealed variables, spending limit; R2 buckets + tokens; Cloudflare rules, Access, DNS) — your approval (D20–D22, D24)
- [ ] R9 — staging deploy and verification of every NOT VERIFIED item
- [ ] R10 — production cutover (separate approval; Mark4 kept 14 days)
