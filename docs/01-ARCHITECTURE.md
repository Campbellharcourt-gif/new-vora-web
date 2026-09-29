# VORA — Production Architecture

Version 1.0 · 26 September 2026 · Status: **approved** — D1 (platform), D2 (purpose-built auth),
D3 (retire public price list) and D4 (Branding/Motion/Film delivered with Solara) approved by you
on 26 Sep 2026; the remaining §21 items proceed on the recommended defaults until you say otherwise.

Companion documents: `00-DISCOVERY.md` (evidence and conflicts), `CHECKLIST.md` (running
implementation checklist).

Guiding rules carried through every section: real content only; secrets never reach the
browser; every protected operation is authorised on the server; drafts can never render on
a public route; nothing is reported as passing unless it was actually run.

---

## 1. Technology stack

| Layer | Choice | Why |
|---|---|---|
| Hosting / runtime | **Cloudflare Workers (Paid plan)**, one Worker + Workers Static Assets | Brief requires Cloudflare. Paid plan is required: the Free plan's 10 ms CPU limit cannot run a proper password hash (a production hash costs ~200–400 ms CPU). *CP-3 Free audit (29 Sep 2026): the hash now runs in a Durable Object, which removes that specific blocker; the Worker's own CPU for the signed-in flows still measured 2–4× the Free limit — see `CLOUDFLARE-FREE-COMPATIBILITY.md`.* |
| Application framework | **React Router 8** (framework mode, SSR) via **@cloudflare/vite-plugin** | Cloudflare's first-class full-stack path. Dev and tests run inside `workerd` (the real Workers runtime) with local D1/R2, so Cloudflare compatibility is proven continuously, not assumed. Loaders/actions give an explicit server boundary and forms that work without JavaScript. Route-level code splitting keeps admin code out of public bundles. |
| HTTP kernel | **Hono 4** as the Worker entry | One request pipeline in front of everything: request IDs, security headers + CSP nonce, CSRF origin checks, maintenance mode, rate limiting, session resolution, JSON API (`/api/v1`), SSE streaming, media streaming. React Router handles page rendering behind it. |
| Language | **TypeScript** (strict, `noUncheckedIndexedAccess`) | |
| Database | **Cloudflare D1** (SQLite) + **Drizzle ORM** + drizzle-kit | Native binding, no connection pooling, 30-day point-in-time restore. Drizzle gives typed, parameterised queries and SQL migration files that are reviewed and committed. Scale (a studio site + portals) is far inside D1's limits. |
| Object storage | **R2**: `vora-media` (publishable assets) and `vora-private` (client files, CVs) | Private data physically separated from public media. |
| Abuse controls | Workers **Rate Limiting** binding (GA) + D1 counters for account-level throttling + **Turnstile** + Cloudflare WAF rules | Layered: edge, per-IP, per-account, human verification. |
| Email | **Resend** REST API behind a transport interface | Existing provider. |
| AI | Provider interface → **Gemini** adapter (REST), optional **Cloudflare AI Gateway** | Provider can be swapped without touching the UI or domain code. Gemini parameters changed as recently as July 2026 (temperature/top-p deprecated; `thinkingLevel` replaces budgets) — the adapter isolates that churn. |
| Validation | **Zod 4**, shared by client and server | Same schema validates in the browser and again on the server. |
| Styling | CSS custom properties (tokens) + **CSS Modules** + cascade layers | Bespoke system, zero runtime, no utility-class soup. No Tailwind. |
| Motion | **GSAP 3** (ScrollTrigger, SplitText), **Lenis** (desktop only, optional), View Transitions API | Choreography needs a timeline engine; everything else is CSS. |
| 3D | **Three.js** (vanilla, isolated lazy module) + Blender pipeline (glTF/meshopt, KTX2) + pre-rendered plates | See §11. React-Three-Fiber is not used: one persistent scene with a scroll-driven camera is simpler and cheaper without a second reconciler. |
| Testing | **Vitest** (unit), **@cloudflare/vitest-pool-workers** (integration inside workerd with real D1/R2), **Playwright** + axe (E2E, accessibility, screenshots) | |
| Lint / format | Biome (lint + format, a11y rules) + `tsc --noEmit` + React Router typegen | Fewer tools, fast CI. |
| Package manager | npm (lockfile committed) | Works on any Mac with Node, no extra install. |

**Alternatives considered and rejected**

- *Next.js 16 on Workers via OpenNext* — viable (Cloudflare lifted the compressed Worker size
  limit on 4 Sep 2026), but it adds an adapter layer, and local development runs in Node rather
  than `workerd`. Offered as the alternative in §21.
- *Astro 7* (now Cloudflare-owned) — excellent for marketing pages, weaker for three
  authenticated application areas (admin, client, member).
- *Postgres (Neon) via Hyperdrive* — more relational power, but a second vendor, network hop and
  more operations for no requirement D1 can't meet.
- *Better Auth* — capable library; rejected in favour of a small, explicit auth module built on
  audited primitives because the brief's role model, mandatory privileged 2FA, login history,
  risk detection and audit trail are tightly integrated (offered as the alternative in §21).

---

## 2. Project architecture

### 2.1 Request lifecycle

```
Browser
  │
  ▼
Cloudflare edge (TLS, WAF + rate-limit rules, cache for static assets)
  │
  ▼
Worker entry  workers/app.ts  ── scheduled() → cron jobs (email retry, retention, cleanup)
  │
  ▼
Hono kernel
  1 request id + structured logger
  2 security headers, CSP nonce
  3 maintenance gate (settings + env override; staff bypass)
  4 CSRF gate for unsafe methods (Origin / Sec-Fetch-Site)
  5 rate-limit gate (route class)
  6 session resolution (cookie → session → user → permissions), no redirects here
  │
  ├── /api/v1/*, /api/health*, /media/*, /files/*, /api/webhooks/*  → Hono routers
  └── everything else → React Router request handler
                          loaders/actions call the same services
```

### 2.2 Layers

```
routes (React Router UI) ─┐
api routers (Hono) ───────┼──► services (domain logic, authorisation, audit)
cron jobs ────────────────┘          │
                                     ├──► repositories (Drizzle, D1)
                                     ├──► storage (R2)
                                     ├──► email transport (Resend | capture)
                                     └──► AI provider (Gemini | future)
```

- **Routes and API handlers are thin:** parse → validate (Zod) → call a service → map result.
- **Services own business rules and authorisation** (`requirePermission`, resource policies),
  write audit logs and security events.
- **Repositories own SQL.** Public content is read through a dedicated *published-content
  repository* that can only see published snapshots (§7).
- **Server-only code** lives under `app/.server/`; React Router refuses to bundle `.server`
  modules into client code, so a mistaken import fails the build instead of leaking.

### 2.3 Directory layout

```
vora/
  app/
    root.tsx, routes.ts, entry.server.tsx
    routes/               public/, auth/, account/, admin/, client/, member/, system/
    components/           ui/ (primitives), site/ (public), admin/, portal/
    styles/               tokens.css, base.css, layers.css
    experience/           3D + scroll choreography (lazy chunks, Phase 3)
    lib/                  browser-safe helpers (motion prefs, consent, formatting)
    .server/
      kernel/             Hono app + middleware
      api/                Hono routers
      auth/               passwords, sessions, mfa, tokens, risk, rbac, policies
      db/                 schema/, client, repositories/
      services/           enquiries, cms, media, careers, clients, settings, flags, notifications, privacy
      email/              transports, templates, outbox
      ai/                 service, provider interface, gemini adapter, guards
      observability/      logger, security events, audit
      config/             env schema + loader
      lib/                crypto, ids, errors, http, time
  shared/                 isomorphic: zod schemas, permission keys, enums, route helpers
  workers/app.ts          Worker entry (fetch + scheduled)
  migrations/             SQL migrations (generated + hand-written triggers)
  scripts/                seed, bootstrap, backup export, migration checks
  tests/                  unit/, integration/, e2e/
  docs/
```

### 2.4 Configuration

Typed environment schema validated at first request (`config/env.ts`). Missing secrets fail
closed with a logged configuration error and a generic 503 — never a half-working app.
`APP_ENV` ∈ `development | test | staging | production` drives behaviour (e.g. the capture email
transport and test mailbox exist only outside production and are not even registered there).

---

## 3. Route architecture

### 3.1 Public (indexable)

| Route | Purpose |
|---|---|
| `/` | Homepage experience |
| `/services` | Services overview |
| `/services/:slug` | `websites`, `branding`, `motion`, `film` (CMS-driven; new services can be added) |
| `/work` | Work index (published projects only; empty state if none) |
| `/work/:slug` | Case study |
| `/our-story` | Editorial story |
| `/partners` | Partnerships (Solara) |
| `/careers` | Open roles + how to apply (empty state if none open) |
| `/careers/:slug` | Role detail + application |
| `/contact` | Enquiry experience |
| `/terms`, `/privacy`, `/cookies` | Legal |
| `/status` | Public service status (coarse; no internals) |
| `/sitemap.xml`, `/robots.txt` | Resource routes |

### 3.2 Authentication (noindex)

`/login`, `/login/verify` (2FA code), `/login/recovery` (recovery code), `/logout` (POST only),
`/forgot-password`, `/reset-password/:token`, `/invite/:token`, `/verify-email/:token`,
`/register` (member sign-up, behind a feature flag), `/setup` (one-time owner bootstrap; 404 once
an owner exists).

### 3.3 Authenticated areas (noindex, `Cache-Control: private, no-store`)

| Area | Routes | Guard |
|---|---|---|
| Account (everyone) | `/account`, `/account/security`, `/account/privacy` | Signed in |
| Admin | `/admin`, `/admin/enquiries[/:id]`, `/admin/projects[/new|/:id]`, `/admin/pages[/:id]`, `/admin/services[/:id]`, `/admin/partners`, `/admin/careers[/:id]`, `/admin/applications[/:id]`, `/admin/media`, `/admin/clients[/:id]`, `/admin/engagements/:id`, `/admin/users[/:id]`, `/admin/roles`, `/admin/settings/*` (general, social, enquiry options, flags, maintenance), `/admin/ai/*` (settings, prompts, usage), `/admin/security/*` (events, sessions), `/admin/audit`, `/admin/notifications`, `/admin/system` (health, jobs, email outbox) | `admin.access` + 2FA-verified session; each page and action checks its own permission |
| Client portal | `/client`, `/client/engagements/:id` (overview, milestones, deliverables, files, messages) | `client_portal.access` + organisation membership per resource |
| Member | `/member` (+ future modules) | `member_portal.access` |
| Preview | `/preview/:type/:id` | valid preview token **or** editor permission; never cached, noindex |

### 3.4 API (`/api`)

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /api/health` | none | liveness only (`{status:"ok"}`), no internals |
| `GET /api/health/ready` | none | DB reachable → 200/503, no details |
| `GET /api/v1/system/status` | `system.status` | per-component health (DB, email, AI, storage, config) |
| `POST /api/v1/enquiries` | public + Turnstile | JSON twin of the `/contact` form action |
| `POST /api/v1/applications` | public + Turnstile | multipart (CV to private R2) |
| `POST /api/v1/ai/chat` | per channel | SSE stream |
| `GET/DELETE /api/v1/account/sessions[/:id]` | signed in | list/revoke own sessions |
| `/api/v1/admin/*` | per permission | data endpoints for rich admin UI (media upload, reorder) |
| `GET /media/:id/:name` | public (published media only) | R2 stream, range requests, immutable caching |
| `GET /files/:id` | policy-checked | private file download, `no-store`, attachment |
| `POST /api/webhooks/resend` | signature | delivery/bounce events |
| `GET /api/dev/mailbox` | **development/test only** | answers 404 in staging/production, which also have no `DEV_MAILBOX` binding |

Any other `/api/*` path answers the JSON 404 envelope (never the HTML page renderer).

Error envelope for every API error: `{ "error": { "code": "validation_failed", "message": "…",
"fields": {…}?, "requestId": "…" } }` — no stack traces, no SQL, no provider messages.

### 3.5 Legacy URL redirects (301)

`/plans` → `/services` · `/start-a-project` → `/contact` · `/founders` → `/our-story` ·
`/process` → `/our-story` · `/cookie-policy` → `/cookies` · `/portal` → `/client` ·
`/faq`, `/help` → `/contact` (until real pages exist) · `/work/sail-gaming`,
`/work/eon-clothing` keep their slugs.

---

## 4. Database schema (D1 / SQLite via Drizzle)

### 4.1 Conventions

- **IDs:** prefixed, time-sortable random IDs (`usr_…`, `ses_…`, `prj_…`; 48-bit time + 80-bit
  randomness, Crockford base32). Never sequential integers in URLs. Authorisation never relies
  on IDs being unguessable.
- **Time:** `INTEGER` epoch milliseconds, UTC. Display converts to the viewer's time zone.
- **Enums:** `TEXT` + `CHECK (col IN (…))`. **Booleans:** `INTEGER CHECK (col IN (0,1))`.
- **JSON columns:** `TEXT` validated by a Zod schema on every write and read; `CHECK (json_valid(col))`.
- **Foreign keys** enforced (D1 default); explicit `ON DELETE` on every FK (`CASCADE` for owned
  children, `SET NULL` for authorship, `RESTRICT` where deletion must be deliberate).
- **Emails** stored normalised (trimmed, lower-cased) with a `UNIQUE` index.
- **Secrets are never stored in plaintext:** session tokens, reset/invite/preview tokens, OTP
  codes and recovery codes are stored only as hashes/HMACs.
- **IP addresses are not stored raw.** `ip_hash` = HMAC(IP, server key) for correlation;
  `ip_prefix` (IPv4 /24, IPv6 /48) + Cloudflare geo (country/region/city/ASN) for display.
- **Append-only tables** (`audit_logs`, `security_events`) have SQLite triggers that abort any
  `UPDATE`, and abort `DELETE` for rows younger than their retention period.
- **Migrations** are additive by default; destructive changes use expand → migrate → contract
  across separate releases and are never applied automatically to production.

### 4.2 Identity and access

| Table | Key columns | Constraints / indexes |
|---|---|---|
| `users` | id, email, email_verified_at, name, password_hash (nullable until invite accepted), status (`invited|active|suspended|deactivated`), password_changed_at, last_login_at, locked_until, deleted_at, created_at, updated_at | `UNIQUE(email)`, idx(status) |
| `roles` | id, key (`owner|admin|manager|staff|client|member` + custom), name, description, rank (int), is_system, is_privileged | `UNIQUE(key)` |
| `permissions` | key (PK, e.g. `projects.publish`), category, description | synced from code |
| `role_permissions` | role_id → roles, permission_key → permissions | PK(role_id, permission_key) |
| `user_roles` | user_id → users (cascade), role_id → roles (restrict), granted_by, granted_at | PK(user_id, role_id), idx(role_id) |
| `sessions` | id (= SHA-256 of token), user_id, auth_level (`pending_mfa|full`), auth_method, mfa_verified_at, elevated_until, created_at, last_seen_at, idle_expires_at, expires_at, ip_hash, ip_prefix, country, city, asn, user_agent, device_label, revoked_at, revoked_reason | idx(user_id, revoked_at), idx(expires_at) |
| `mfa_factors` | id, user_id, type (`email_otp|totp|sms|webauthn`), label, secret_enc (future TOTP), phone_enc (future SMS), verified_at, last_used_at, disabled_at, created_at | idx(user_id, type) |
| `mfa_challenges` | id, user_id, session_id, factor_id, purpose (`login|step_up|verify_factor`), code_hmac, attempts, max_attempts, expires_at, consumed_at, created_at, ip_hash | idx(session_id), idx(user_id, created_at) |
| `recovery_codes` | id, user_id, batch_id, code_hmac, used_at, created_at | `UNIQUE(user_id, code_hmac)` |
| `auth_tokens` | id, user_id, type (`password_reset|email_verify|email_change`), token_hash, payload (json), expires_at, consumed_at, created_at | `UNIQUE(token_hash)`, idx(user_id, type) |
| `invitations` | id, email, role_ids (json), client_org_id, invited_by, token_hash, expires_at, accepted_at, revoked_at, created_at | `UNIQUE(token_hash)`, idx(email) |
| `login_attempts` | id, user_id (nullable), email_hmac, outcome (`success|bad_credentials|locked|suspended|mfa_passed|mfa_failed|recovery_used|rate_limited|challenge_failed`), risk_score, risk_reasons (json), ip_hash, ip_prefix, country, city, asn, user_agent, created_at | idx(user_id, created_at), idx(email_hmac, created_at), idx(ip_hash, created_at) |

### 4.3 Observability and governance

| Table | Key columns | Notes |
|---|---|---|
| `security_events` | id, type, severity (`info|low|medium|high|critical`), user_id, ip_hash, country, user_agent, details (json, redacted), request_id, acknowledged_at, acknowledged_by, created_at | append-only (acknowledgement stored in `security_event_acks`) |
| `security_event_acks` | event_id, user_id, note, created_at | |
| `audit_logs` | id, actor_user_id, actor_roles (json snapshot), action (e.g. `project.publish`), target_type, target_id, summary, changes (json diff, sensitive fields excluded), ip_hash, request_id, created_at | append-only; 2-year retention |
| `notifications` | id, user_id, type, title, body, link, read_at, created_at | in-app notifications |
| `email_outbox` | id, template, to_email, subject, payload (json; **redacted** for OTP/reset/invite), status (`queued|sending|sent|failed|dead`), attempts, next_attempt_at, last_error, provider_message_id, idempotency_key, related_type, related_id, created_at, sent_at | `UNIQUE(idempotency_key)`, idx(status, next_attempt_at) |
| `job_runs` | id, job, status, started_at, finished_at, details (json) | cron history |
| `feature_flags` | key (PK), description, enabled, rules (json: roles, environments), updated_by, updated_at | |
| `site_settings` | key (PK), value (json, schema per key), updated_by, updated_at | identity, contact emails, SEO defaults, enquiry options, maintenance, retention |
| `social_links` | id, platform, label, url (https, validated), handle, placements (json), sort_order, is_visible, updated_by, updated_at | idx(sort_order) |

### 4.4 Content (CMS)

| Table | Key columns | Notes |
|---|---|---|
| `projects` | id, slug, status (`draft|published|archived`), title, category, summary, body (json blocks), year, client_name, client_org_id, credits (json), external_url, cover_media_id, seo_title, seo_description, og_media_id, is_featured, sort_order, published_version_id, published_at, has_unpublished_changes, created_by, updated_by, created_at, updated_at, archived_at | `UNIQUE(slug)`, idx(status, sort_order), idx(is_featured) |
| `project_media` | project_id, media_id, sort_order, caption, alt_override, layout | PK(project_id, media_id) |
| `project_services` | project_id, service_id | PK |
| `services` | id, slug, name, summary, body (json), delivery_model (`vora|partner|joint`), partner_id, sort_order, status, published_version_id, … | `UNIQUE(slug)` |
| `pages` | id, key (e.g. `our-story`, `terms`), title, body (json blocks), seo fields, status, published_version_id, … | `UNIQUE(key)` |
| `partners` | id, slug, name, relationship, description, statement, url, logo_media_id, sort_order, status, published_version_id, … | `UNIQUE(slug)` |
| `job_roles` | id, slug, title, department, employment_type, location_type, location_text, summary, body (json), application_mode (`form|email|external`), external_url, status (`draft|open|closed|archived`), opens_at, closes_at, sort_order, published_version_id, … | `UNIQUE(slug)` |
| `content_versions` | id, entity_type, entity_id, version (int), kind (`draft|published|restored`), snapshot (json), schema_version, note, created_by, created_at | `UNIQUE(entity_type, entity_id, version)` |
| `preview_tokens` | id, entity_type, entity_id, version_id, token_hash, expires_at, revoked_at, created_by, created_at | `UNIQUE(token_hash)` |
| `slug_redirects` | id, entity_type, from_slug, entity_id, created_at | `UNIQUE(entity_type, from_slug)` |

### 4.5 Media

| Table | Key columns | Notes |
|---|---|---|
| `media_assets` | id, bucket (`media|private`), storage_key, kind (`image|video|model|document|font|audio|other`), mime_type (sniffed), original_name (sanitised), size_bytes, width, height, duration_ms, checksum_sha256, alt_text, caption, credit, focal_x, focal_y, placeholder (tiny LQIP), status (`uploading|ready|failed|quarantined`), uploaded_by, created_at, updated_at, deleted_at | `UNIQUE(storage_key)`, idx(kind, created_at) |
| `media_revisions` | id, media_id, storage_key, size_bytes, checksum, replaced_by, created_at | replacement history |
| `media_usages` | media_id, entity_type, entity_id, field | PK(all four); blocks unsafe deletion |

### 4.6 Enquiries and careers

| Table | Key columns | Notes |
|---|---|---|
| `enquiries` | id, reference (random, e.g. `VR-7K3F9Q`), name, email, company, website_url, project_types (json), budget_key, budget_label, timeline_key, timeline_label, message, source_key, source_detail, status (`received|processing|contacted|qualified|won|lost|archived`), assigned_to, spam_score, turnstile_ok, consent_at, ip_hash, country, user_agent, first_response_at, closed_at, retention_until, created_at, updated_at, deleted_at | `UNIQUE(reference)`, idx(status, created_at), idx(email) |
| `enquiry_events` | id, enquiry_id, type (`status_change|note|assignment|email`), from_status, to_status, body, actor_user_id, created_at | internal only |
| `applications` | id, job_role_id (nullable = general), name, email, portfolio_url, message, cv_media_id (private bucket), status (`received|reviewing|interviewing|offer|hired|declined|withdrawn|archived`), consent_at, ip_hash, retention_until, created_at, updated_at, deleted_at | idx(job_role_id, status) |
| `application_events` | as `enquiry_events` | |

### 4.7 Client portal and members

| Table | Key columns | Notes |
|---|---|---|
| `client_orgs` | id, name, slug, website_url, status, created_at, updated_at | |
| `client_org_members` | org_id, user_id, org_role (`owner|member|viewer`), created_at | PK(org_id, user_id) |
| `engagements` | id, org_id, name, status (`planning|in_progress|review|delivered|on_hold|closed`), summary, start_date, target_date, public_project_id, created_at, updated_at | idx(org_id, status) |
| `engagement_staff` | engagement_id, user_id | Staff see only assigned engagements |
| `milestones` | id, engagement_id, title, description, due_date, status (`upcoming|in_progress|done|blocked`), sort_order, completed_at | |
| `deliverables` | id, engagement_id, title, description, status (`pending|in_review|approved|changes_requested`), due_date, media_id, approved_at, approved_by | |
| `engagement_files` | id, engagement_id, media_id, visibility (`client|internal`), label, uploaded_by, created_at | internal files never listed to clients |
| `engagement_messages` | id, engagement_id, author_id, body, visibility (`client|internal`), created_at, edited_at, deleted_at | |
| `member_profiles` | user_id (PK), display_name, avatar_media_id, preferences (json), created_at, updated_at | extension point for member features |

### 4.8 AI and privacy

| Table | Key columns | Notes |
|---|---|---|
| `ai_prompts` | id, key (`public_assistant`, `enquiry_summary`, …), version, content, is_active, created_by, created_at | `UNIQUE(key, version)`; never sent to browsers |
| `ai_conversations` | id, channel (`public|admin`), user_id, visitor_hash, status (`active|closed|flagged`), message_count, created_at, last_message_at, retention_until | |
| `ai_messages` | id, conversation_id, role (`user|assistant`), content, tokens_in, tokens_out, flagged, created_at | short retention for anonymous visitors |
| `ai_usage` | id, conversation_id, user_id, channel, provider, model, status (`ok|error|timeout|rate_limited|blocked|malformed`), error_code, latency_ms, input_tokens, output_tokens, cost_micro_usd, created_at | idx(created_at), idx(user_id, created_at) |
| `privacy_requests` | id, user_id, email, type (`export|delete`), status, requested_at, completed_at, handled_by, notes | |

AI configuration itself lives in `site_settings` under `ai.config` (provider, model, thinking
level, token/time limits, quotas, per-channel on/off, price table for cost estimates).

---

## 5. Authentication architecture

### 5.1 Primitives

| Concern | Design |
|---|---|
| Password hashing | **Argon2id** via `@noble/hashes` (audited), OWASP parameters m=19 MiB, t=2, p=1, 16-byte salt, stored in PHC format `$argon2id$v=19$m=19456,t=2,p=1$salt$hash` (~270 ms CPU, measured). Parameters versioned; re-hash on login when they change. Unknown-email logins still run a dummy hash (timing parity). |
| Password policy | 12–128 characters, no composition rules, blocks the most common passwords and anything containing the email/name; optional k-anonymity breach check (Have I Been Pwned range API, 1.5 s timeout, fail-open, logged). |
| Session token | 32 random bytes (base64url) in cookie `__Host-vora_session` — `Secure; HttpOnly; SameSite=Lax; Path=/`, no `Domain`. DB stores only SHA-256(token), so a database leak does not yield usable sessions. |
| Lifetimes | Privileged roles: 2 h idle / 12 h absolute. Others: 7 d idle / 30 d absolute. `last_seen_at` refresh throttled to once per 5 min. |
| Rotation | New token on login and after 2FA; a role change or password reset revokes the user's sessions and a password change revokes all other sessions (fixation-proof). |
| Server keys | `AUTH_SECRET` → HKDF sub-keys for OTP/recovery-code HMACs, IP/email hashing and preview tokens. `AUTH_SECRET_PREVIOUS` supported for rotation. |

### 5.2 Flows

**Sign-in**
1. `POST /login` — rate-limited per IP (binding) and per account (D1: ≥5 failures in 15 min →
   Turnstile required; ≥10 → 15-minute lock + email to the account holder; unknown emails
   "lock" on the same attempt so lock timing reveals nothing). An IP hash that fails against
   ≥8 different accounts within an hour is refused sign-in for the rest of that hour
   (credential stuffing). Generic error text for every failure ("Email or password is incorrect.").
2. Password OK → compute login risk (§5.4). If the user holds a privileged role, has opted in
   to 2FA, or the risk score ≥ 30 → create a `pending_mfa` session (10-minute lifetime, can only
   reach `/login/verify` and `/login/recovery`) and email a one-time code.
3. `POST /login/verify` — 6-digit code, 10-minute expiry, 5 attempts per challenge, resend
   cooldown 60 s, max 5 codes/hour. Stored only as HMAC. Success → rotate to a `full` session.
4. New device/location → "New sign-in to VORA" alert email with time, approximate location,
   device, and a link to review sessions.

**Recovery codes** — 10 codes (`XXXXX-XXXXX`, ~50 bits each), shown once at enrolment, stored
as HMACs, consumed atomically (`UPDATE … WHERE used_at IS NULL RETURNING`). Use triggers an alert
email and a security event; ≤3 remaining prompts regeneration (requires step-up).

**Step-up (elevated) access** — sensitive actions (role grants, recovery-code regeneration,
email change, security settings, data deletion) require re-entering the password or a fresh
code within the last 10 minutes (`sessions.elevated_until`).

**Password reset** — always "If an account exists, we've emailed a link". Token: 32 bytes,
hashed, 30-minute expiry, single use, invalidated by any password change. Completing a reset
revokes all sessions and sends a "password changed" alert. The next sign-in still requires 2FA
where applicable.

**Invitations** (staff, clients) — invite by email with role(s) (and client organisation);
72-hour single-use link; invitee sets name + password; email counts as verified; privileged
invitees receive recovery codes on acceptance. Inviters can only grant roles ranked below their
own (Owner excepted — see §6).

**Owner bootstrap** — `/setup` works only while no active Owner exists **and** a one-time
`SETUP_TOKEN` secret is configured; it creates the Owner with password + recovery codes, then
returns 404 permanently. Local development uses a seed script instead.

**Member sign-up** — `/register` behind the `members.self_signup` flag (off by default).
Enumeration-safe: always "check your email"; an existing account holder receives a "someone
tried to register with your email" notice instead of a second account.

**Sign-out** — `POST /logout` (CSRF-protected) revokes the session server-side and clears the
cookie. "Sign out everywhere" revokes all sessions.

### 5.3 2FA extensibility

`mfa_factors` is a factor registry. Phase 1 ships the `email_otp` factor for every verified
email address. TOTP (`@oslojs/otp`, secret encrypted with an HKDF key), SMS (provider adapter)
and passkeys/WebAuthn slot in as new factor types with no change to sessions, challenges or
recovery codes. Recommendation: add TOTP or passkeys for Owner/Admin soon after launch (§20).

### 5.4 Login history and suspicious-login detection

Every attempt writes `login_attempts`. Risk score (0–100) from real signals only: unseen device
for this user in 90 days (+25), new country (+30), new ASN (+10), recent failures on the account
(+5 each, max +30), country change since the last successful sign-in within 2 hours (+30), IP
hash with failures across ≥5 accounts in an hour (+40). ≥30 → email code required; ≥60 → also
alert email + `high` security event; credential-stuffing pattern → IP hash blocked for 1 hour.
Users see their own history on `/account/security`; admins with `security.view` see events.

---

## 6. Authorisation and permissions

### 6.1 Permission catalogue (code-defined, synced to DB)

```
admin.access
enquiries.view  enquiries.edit  enquiries.delete  enquiries.export
projects.view   projects.create projects.edit     projects.publish  projects.delete
pages.view      pages.edit      pages.publish
services.view   services.edit   services.publish
partners.view   partners.edit   partners.publish
careers.view    careers.edit    careers.publish
applications.view applications.edit applications.delete
media.view      media.upload    media.edit        media.delete
clients.view    clients.manage  engagements.view  engagements.manage
users.view      users.invite    users.manage      roles.assign      roles.manage
settings.view   settings.manage social.manage     flags.manage      maintenance.manage
ai.use          ai.manage       ai.usage.view
security.view   security.manage audit.view
system.status   system.jobs     privacy.manage
client_portal.access  member_portal.access
```

### 6.2 Default roles

| Role | Rank | Privileged (2FA mandatory) | Default permissions |
|---|---|---|---|
| Owner | 100 | yes | everything; only an Owner can grant/revoke Owner; the last active Owner cannot be removed, demoted or suspended |
| Admin | 80 | yes | everything except `roles.manage` and Owner management |
| Manager | 60 | yes | admin.access; enquiries view/edit/export; all content incl. publish (no delete of users/settings); applications view/edit; media view/upload/edit; clients + engagements manage; users view + invite (Staff/Client only); ai.use; audit.view |
| Staff | 40 | yes | admin.access; enquiries view/edit; projects view/create/edit (**no publish/delete**); pages/services/careers view; media view/upload/edit; engagements view/manage **only where assigned**; ai.use |
| Client | 20 | no (optional) | client_portal.access — resources limited to their organisations |
| Member | 10 | no (optional) | member_portal.access |

A Staff account therefore cannot publish, delete, invite, change settings, see security data or
manage AI — administrative power is never implied by being staff.

### 6.3 Enforcement

- **Route guards** in layout loaders (`/admin` requires `admin.access` + a `full` session with
  2FA verified) — for navigation UX only.
- **The real check is in services:** every service method that reads or changes protected data
  calls `authorize(actor, permission)` and, for owned resources, a policy
  (`canViewEngagement(actor, engagement)`, `canManageUser(actor, target)`…). Hidden buttons are
  never the control.
- **Resource policies:** clients can reach an engagement only via `client_org_members`;
  `internal` files/messages are excluded at the repository level for client actors; Staff need
  `engagement_staff` assignment; users can manage only lower-ranked users and never their own roles.
- **Role composition:** the six system roles are **code-defined** (`shared/permissions.ts`,
  reviewed in version control) and re-synced to `roles`/`role_permissions` whenever
  `RBAC_VERSION` changes — a hand edit to a system role in the database is reverted by the next
  sync. Owner-created custom roles (`roles.manage`) arrive with the admin UI in Phase 5 and are
  never touched by the sync.
- **Last Owner:** the service layer refuses to demote or suspend the last active Owner, and
  database triggers (migrations `0001`, `0002`) refuse it on every SQL path, including deleting
  or soft-deleting the user row.
- **Role changes sign the user out** (all sessions revoked) so new privileges — and 2FA where
  now required — take effect on a fresh session.
- **Tests:** every system role's effective permissions are checked against the code
  definition; services are exercised with allowed and refused roles (403/401); IDOR tests use
  two client organisations; E2E checks the guards through the real UI.

---

## 7. CMS architecture

### 7.1 Content types

Projects (+ gallery, services), Services, Pages (home copy, Our Story, Partners intro, Careers
intro, Contact intro, Terms, Privacy, Cookies), Partners, Job roles. Settings and social links
are configuration (audited, not versioned content).

### 7.2 Lifecycle: Draft → Preview → Publish → Archive

```
            save (version)            publish (validate strict)
  [draft] ─────────────────► [draft] ───────────────────────────► [published]
     ▲  preview link / editor preview        │   edit working copy → has_unpublished_changes
     │                                       │   publish again → new published snapshot
     └──────── restore version ◄─────────────┤
                                             └── archive ─► [archived] (off public site, kept)
```

- **Working copy** = the entity row. **Published state** = an immutable `content_versions`
  snapshot referenced by `published_version_id`.
- **Public pages read snapshots only**, through a published-content repository that joins on
  `published_version_id` and `status = 'published'`. The working copy is never read on a public
  route — draft leakage is prevented structurally, and tested.
- **Validation:** drafts accept incomplete content; publishing runs a strict schema (required
  fields, image alt text, SEO title/description length, valid slug, no empty sections).
- **Preview:** editors preview the working copy at `/preview/:type/:id`; shareable preview links
  use a hashed, expiring token (default 24 h, max 7 days, revocable). Previews are `noindex`,
  `private, no-store`, and carry a visible "Preview — not published" bar.
- **Versions & rollback:** each explicit save and every publish creates a version (draft
  versions pruned to the latest 50; published versions kept). Rollback restores a version into
  the working copy as a new version ("Restored from v12"); it goes live only when published.
- **Slugs:** changing a published slug creates a `slug_redirects` row (301).
- **Ordering & visibility:** `sort_order`, `is_featured` and archive are publication controls
  with their own permission and audit entries.
- **Cache:** publish/archive purges affected public URLs from the edge cache.
- **Rich content:** stored as structured blocks (paragraph, heading, list, quote, image,
  gallery, video, embed from an allow-list, divider) with inline marks (bold, italic, link with
  validated URL). Rendered by React components — **no raw HTML is ever stored or injected**,
  which removes a whole class of XSS.

### 7.3 Permissions

`*.view` read admin lists; `*.edit` change working copy; `*.publish` publish/archive/reorder;
`*.delete` hard-delete (rare; archive is the norm). Every publish, archive, restore and delete is
audited with a diff summary.

---

## 8. Media architecture

| Concern | Design |
|---|---|
| Upload | `POST /api/v1/admin/media` (streamed through the Worker, ≤100 MB) or multipart (R2 multipart via the Worker) for large video. No S3 keys needed. |
| Validation | Permission check → size limit per kind (image 25 MB, video 1 GB multipart, 3D model 50 MB, document 25 MB, font 5 MB) → **magic-byte sniffing** (JPEG, PNG, WebP, AVIF, GIF, MP4/MOV, WebM, GLB, KTX2, HDR, PDF, WOFF2) must agree with the extension allow-list → dimensions/duration parsed from headers → SHA-256 checksum. |
| SVG | Allowed only for `media.edit` holders; rejected if it contains scripts, event handlers, `foreignObject` or external references; always served with `Content-Security-Policy: sandbox` and never inlined as HTML. |
| Storage | R2 key `m/{yyyy}/{mm}/{mediaId}/{random}.{ext}`; private files in `vora-private`. Original filenames sanitised and kept only as metadata. |
| Serving | Public: `/media/:id/:name` — only media that is referenced by published content or marked public; `ETag`, range requests, `immutable` caching (keys change on replacement), `nosniff`. Private: `/files/:id` — policy check every time, `Content-Disposition: attachment`, `private, no-store`. |
| Images | Cloudflare Image Transformations for AVIF/WebP and responsive widths (`srcset`), focal-point aware cropping. Requires Transformations enabled on the zone. |
| Video | Uploaded pre-encoded (H.264 + HEVC/AV1 where useful) with poster; Cloudflare Stream is an optional later upgrade. |
| 3D | GLB (meshopt-compressed), KTX2 textures, HDR/EXR environment maps — validated and versioned like any asset. |
| Metadata | Alt text (required before an image can be published), caption, credit, focal point, tiny placeholder for progressive loading. |
| Replacement | New file, same media ID; previous object kept in `media_revisions` for 30 days. |
| Deletion | Soft delete; blocked while `media_usages` references exist (shows where it's used); objects purged by cron after 30 days. |

---

## 9. VORA AI architecture

```
Browser ──► /api/v1/ai/chat (Hono) ──► AIService ──► AIProvider interface ──► GeminiProvider ──► (AI Gateway) ──► Gemini
                │                        │  policies, quotas, context building, usage ledger
                │                        └─ settings (D1: ai.config), prompts (D1: ai_prompts)
                └─ SSE stream back to the browser
```

- **Channels.** *Public "Ask VORA"* (flag-controlled): answers questions about VORA's services,
  process and partnership using **only published site content** retrieved server-side; no tools,
  no side effects; hands off to the enquiry form. *Admin assistant* (`ai.use`): enquiry
  summaries, reply drafts, copy suggestions — always human-reviewed, never auto-sent or
  auto-published. Exact scope to be confirmed (§21).
- **Provider interface:** `generate()`, `stream()`, `health()`; typed errors
  (`RateLimited`, `Timeout`, `Unavailable`, `Blocked`, `MalformedResponse`, `ConfigError`).
  Gemini adapter uses REST with the key in the `x-goog-api-key` header server-side only. Default
  model `gemini-3.8-flash`, `thinkingLevel: low`; model and limits are admin settings. Moving to
  another provider = one new adapter class.
- **Reliability:** request timeout (default 20 s), first-token timeout for streams (8 s),
  one retry on 5xx with jitter, circuit breaker (5 consecutive failures → provider marked
  degraded for 60 s), validation of every response shape. The UI always ends in a definite state
  — answer, clear error, or "VORA AI is unavailable right now — you can still reach us here".
- **Abuse & cost controls:** kill switch; per-IP and per-user rate limits; daily request and
  token budgets (global and per channel); 2,000-character input cap; 20-turn conversations;
  output token cap; `ai_usage` ledger with cost estimates shown in admin.
- **Prompt-injection posture:** system prompts live server-side and are never returned;
  retrieved content is passed as delimited *data* with instructions to treat it as such; the
  public channel has no tools, so injected instructions cannot trigger actions; outputs render
  as escaped text with a safe markdown subset and links restricted to VORA's own domain;
  secrets, internal notes and personal data are never placed in context.
- **Privacy:** anonymous conversations retained 30 days (configurable) then purged; usage
  metrics kept as aggregates.

---

## 10. Email architecture (Resend)

- **Transport interface** with three implementations: `ResendTransport` (fetch, 10 s timeout,
  `Idempotency-Key`), `CaptureTransport` (development/test: stores messages for the dev mailbox)
  and `DisabledTransport` (logs and fails loudly).
- **Templates** are typed functions returning `{ subject, html, text }` from one shared layout;
  every interpolated value is HTML-escaped; links are absolute to `APP_ORIGIN`.
  Templates: enquiry notification (team) and confirmation (enquirer), application notification
  and confirmation, sign-in code, password reset, invitation, email verification, new sign-in
  alert, password changed, recovery code used, 2FA changed, account locked, sessions revoked;
  later: client message notifications.
- **Outbox:** ordinary mail is written to `email_outbox`, sent right after the response
  (`waitUntil`), and retried by cron every 5 minutes with exponential backoff (max 6 attempts →
  `dead` + admin notification).
- **Sensitive mail** (codes, reset and invite links) is sent inside the request so the user gets
  immediate feedback; the outbox row stores only redacted metadata — codes and links are never
  persisted or logged.
- **Failures are never swallowed:** every failure is logged with the request ID and provider
  status, counted on the system page, and visible in the admin outbox.
- **Webhooks:** Resend delivery/bounce/complaint events verified by signature and recorded.
- **Domain:** `vorawebsites.store` with SPF, DKIM and DMARC in Resend. Senders:
  `VORA <hello@vorawebsites.store>` (confirmations), `notifications@` or `projects@` for team
  alerts — to confirm (§21).

---

## 11. 3D and experience architecture

### 11.1 Direction

The references teach one thing above all: **one continuous world, with scroll as the camera.**
VORA's world is the established Blender environment — a monumental natural landscape with a
sculptural monument, water, stone, mist and controlled sunlight. The page is a single camera
journey through that world; each homepage chapter is a *station* where the camera settles and
the typography holds the frame.

Working storyboard (to be locked against the Phase 2.2 blockout, not invented around it):

| Station | Camera | Content |
|---|---|---|
| Threshold | wide, low, mist over water, monument in silhouette; light breaks | Wordmark (real logo), one line of positioning |
| Approach | slow dolly toward the monument; raking light reveals material | What VORA is — two sentences, no more |
| Chambers | inside/along the monument; openings frame published work | Featured work (real projects only; empty state otherwise) |
| Terraces | lateral move across terraces/water channels | Services (Websites · Branding · Motion · Film + delivery model) |
| Reflection | camera meets the water; inverted, quiet chapter | Partnership: Creative by Solara. Digital by VORA. |
| Horizon | camera turns to open landscape; sun aligns | The invitation to start a project |

Three treatments will be prototyped against the real environment in Phase 3 before one is
chosen (design-experimenter rule): **A · Monument & Water** (photographic CGI, restrained
editorial type), **B · Survey** (architectural drawing language — contours, measured lines —
resolving into the built world; stronger "precision" signal), **C · Atrium** (interior light
shafts and planted terraces; more gallery-like). Recommendation going in: A, borrowing B's
drawing language for loading and transitions.

### 11.2 Rendering strategy — hybrid

Real-time WebGL on a phone cannot match Cycles-quality water, mist and global illumination. So:

1. **Pre-rendered plates** from Blender (Cycles) for the camera path: encoded as short
   all-keyframe video segments (for scrubbing) and AVIF image sequences at 2–3 resolutions, per
   device class and orientation (portrait mobile gets its own framing, not a crop).
2. **A light real-time layer** (Three.js) composited on top where interaction earns it: parallax
   depth from a depth pass, water ripple and caustic shimmer shader, volumetric light shafts,
   and the transition between stations. Real-time geometry comes from the same Blender scene
   (glTF, meshopt, KTX2), so both layers share one camera and one world.
3. **DOM typography** above both, positioned in the plates' planned negative space.

Scroll-scrub engineering follows the proven standard (poster first, streamed fetch with
watchdog, frame-rate-independent easing, gated seeks, DOM writes only on change, idle loops).

### 11.3 Quality tiers, loading and fallbacks

| Tier | Who | Experience |
|---|---|---|
| T0 | `prefers-reduced-motion`, Save-Data, no WebGL2, or low memory | Composed still frames per station, crossfades only, full content |
| T1 | typical mobile | Portrait plates scrubbed, real-time layer off |
| T2 | capable laptop/tablet | Plates + real-time layer at reduced resolution |
| T3 | desktop with strong GPU | Full layer, higher resolution, richer shader passes |

- The first paint is HTML, the headline and a compressed poster (LCP target < 2.5 s on 4G).
  The experience chunk (Three.js ≈150 KB gz + scene code) loads after first paint and idle.
- A frame-time monitor downgrades the tier if the 95th-percentile frame time exceeds budget.
- The canvas is decorative (`aria-hidden`); every station's meaning exists as real text.
- WebGL context loss, failed asset loads and timeouts fall back to T0 without breaking the page.
- Loops sleep when the canvas is off-screen or the tab is hidden; all GPU resources are
  disposed on route change.

### 11.4 Motion language (summary)

Slow, weighted, architectural: long ease-outs (`cubic-bezier(.16,1,.3,1)`-family), no bounce,
no elastic. Text arrives by line masks, never letter confetti. One gesture per shot. Route
changes use View Transitions with the canvas persisting in the layout. Reduced motion replaces
movement with opacity and removes scroll-jacking. No custom cursor.

---

## 12. Deployment architecture (Cloudflare)

| | Local | Staging | Production |
|---|---|---|---|
| Worker | `vite dev` (workerd) | `vora-web-staging` | `vora-web` |
| URL | `http://localhost:5173` | `staging.vorawebsites.store` behind **Cloudflare Access** | `vorawebsites.store` (+ `www` → apex 301) |
| D1 | local (Miniflare) | `vora-staging` | `vora-production` |
| R2 | local | `vora-media-staging`, `vora-private-staging` | `vora-media`, `vora-private` |
| Email | capture transport | Resend (restricted recipients) | Resend |
| Turnstile | test keys | staging widget | production widget |

- One `wrangler.jsonc` with `env.staging` and `env.production`; the build selects the
  environment with `CLOUDFLARE_ENV`. Bindings: `DB`, `MEDIA`, `PRIVATE`, `RL_AUTH`,
  `RL_FORMS`, `RL_API`, `RL_AI` (Workers Rate Limiting), `ASSETS`; `DEV_MAILBOX` (KV) exists in
  local development only. Cron: `*/5 * * * *` (email retries), `17 3 * * *` (retention/cleanup).
  Step-by-step commands: `docs/runbooks/deployment.md`.
- **Secrets** (per environment, `wrangler secret put`): `AUTH_SECRET`, `RESEND_API_KEY`,
  `RESEND_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY`, `GEMINI_API_KEY`, `SETUP_TOKEN` (only until
  the Owner exists). Local development uses `.dev.vars` (git-ignored); `.dev.vars.example`
  documents every key without values.
- **Vars:** `APP_ENV`, `APP_ORIGIN`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `TEAM_NOTIFY_EMAIL`,
  `TURNSTILE_SITE_KEY`, `AI_GATEWAY_BASE_URL` (optional), `LOG_LEVEL`.
- **CI (GitHub Actions):** typecheck → lint → unit + integration tests → build → E2E against
  a local build. Merge to `main` deploys staging (migrations applied to staging first). Production
  deploys are manual (approval), run `wrangler d1 migrations apply --env production --remote`
  **only for backwards-compatible migrations**, then deploy, then smoke-test
  (`/api/health/ready`, key routes). Destructive migrations require a separate, manual,
  documented procedure with a fresh backup.
- **Rollback:** `wrangler rollback` to the previous Worker version; because migrations are
  expand-only, the previous version still runs against the new schema.
- **Cutover from Railway/Mark4:** build and verify on staging → set the new Worker's custom
  domain → keep `vora-websites-mark2` and Railway untouched for 14 days as an instant rollback →
  legacy redirects live from day one → decommission afterwards. Any Mark4 data (enquiries,
  portal users) is migrated only with an explicit export and a written mapping.
- **Observability:** Workers Logs enabled (structured JSON), request IDs returned in
  `X-Request-Id`, head sampling for high-volume info logs, 100% for warnings/errors.

---

## 13. Backup and recovery

| Asset | Protection | RPO | Restore |
|---|---|---|---|
| D1 (all data) | **Time Travel**: point-in-time restore to any minute in the last 30 days (Workers Paid; 7 days on Free) | ~1 min | `wrangler d1 time-travel restore vora-production --timestamp=…` (destructive in place — take a bookmark and export first) |
| D1 long-term | Weekly `wrangler d1 export` (`npm run backup:export -- --env production --upload`; scheduling via GitHub Actions once the repository exists) → separate `vora-backups` R2 bucket; keep 12 weekly + 12 monthly | 7 days | import into a fresh database, verify, swap binding |
| R2 media/private | Soft delete + 30-day retention of replaced/deleted objects; monthly `rclone` sync to a second bucket/provider (documented, optional) | ≤30 days for deletions | copy objects back by key from `media_revisions` |
| Secrets | Cloudflare secrets; offline sealed record of what exists (not values) + Owner recovery codes stored offline | — | re-issue/rotate |
| Code/config | Git (GitHub) | per commit | redeploy any tag |

- **Migration recovery:** every production migration is preceded by a Time Travel bookmark
  (`wrangler d1 time-travel info`) recorded in the deploy log; a failed migration is recovered
  by restoring to that bookmark and rolling back the Worker.
- **Disaster recovery:** documented runbook for (1) bad deploy, (2) bad migration, (3) data
  corruption/accidental deletion, (4) compromised admin account (revoke sessions, rotate
  `AUTH_SECRET`, review audit log), (5) provider outage (Resend/Gemini: degrade gracefully;
  enquiries still persist), (6) Cloudflare account compromise (account 2FA, scoped API tokens,
  audit). Targets: RTO < 1 hour for application, < 4 hours for data restore.
- **Drills:** quarterly restore of the latest export into staging, with the result recorded.
- **Maintenance mode** (setting + env override) serves a designed 503 with `Retry-After` to the
  public while signed-in staff with `maintenance.manage` can still work.

---

## 14. Testing strategy

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest (Node) | permission resolution, policies, Zod schemas, crypto/token utils, password policy, risk scoring, email escaping, URL/slug validation, AI response parsing (malformed/partial), error mapping |
| Integration | Vitest + `@cloudflare/vitest-plugin` (successor of `vitest-pool-workers`; real `workerd`, Miniflare D1/R2/KV/rate limiters, migrations + base seed applied per test file) | full HTTP requests through the Worker: login → 2FA → session, lockouts, recovery codes, reset, invitations, role × permission matrix, IDOR between client orgs, CSRF rejection, cookie flags, security headers, enquiry validation → persistence → outbox, CMS draft isolation/publish/rollback, media validation, AI failure modes with a mocked provider, health endpoints, maintenance mode |
| E2E | Playwright (Chromium; WebKit/Firefox in Phase 8) + axe | every public route renders, forms work with and without JS, auth flows via the dev mailbox, keyboard navigation, accessibility scans, screenshots at 1920/1440/1024/834/390 widths |
| Visual regression | Playwright screenshots | Phase 8 baselines for key templates and states |
| Manual | checklists | VoiceOver on your Mac, real phone on 4G, email rendering in real clients |

Rules: tests assert behaviour (status codes, DB rows, emails produced, headers) — no
count-padding. External services are mocked at the network boundary only. CI blocks merges on
any failure. Anything that cannot run in this environment is reported as **NOT VERIFIED** with
the exact command for you to run.

---

## 15. Security strategy

| Threat | Controls |
|---|---|
| XSS | React escaping; no raw HTML from CMS (structured blocks); strict CSP with per-request nonce (`script-src 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`); safe markdown subset for AI output; SVG sandboxing |
| CSRF | `SameSite=Lax` cookies + mandatory Origin / `Sec-Fetch-Site: same-origin` check on every non-GET request; `POST`-only logout |
| SQL injection | Drizzle parameterised queries only; raw SQL only through the tagged `sql` helper with bound values; review rule |
| Authentication bypass | server-side session validation on every request; `pending_mfa` sessions confined to 2FA routes; tests for each bypass path |
| Authorisation bypass / IDOR | permissions + resource policies inside services; repository-level visibility filters; role matrix + cross-organisation tests |
| Session attacks | hashed tokens, rotation, idle/absolute expiry, revocation, `__Host-` cookie, sign-out-everywhere |
| Brute force / credential stuffing | per-IP binding limits, per-account lockout, Turnstile escalation, IP-hash blocking, alerts |
| Account enumeration | identical responses and timing for unknown/known emails on login, reset, register |
| Unsafe uploads | size limits, magic-byte sniffing, allow-lists, SVG rules, private bucket, `nosniff`, attachment downloads |
| Exposed secrets | secrets only in Cloudflare/`.dev.vars` (git-ignored); secret scanning in CI; no secrets in client bundles (build check) |
| API abuse / rate-limit bypass | limits keyed on server-derived values (`CF-Connecting-IP` hash, user ID), not client headers; Turnstile verified server-side with hostname/action checks |
| AI abuse / prompt injection | §9 controls; no tools on the public channel; quotas; kill switch |
| Information leakage | error envelope without internals; generic auth errors; no stack traces; source maps not published; `X-Robots-Tag: noindex` on private areas; minimal response headers |
| Clickjacking / transport | `frame-ancestors 'none'`, HSTS (preload-ready), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal, `Cross-Origin-Opener-Policy: same-origin` |
| Privilege escalation | rank rules, last-Owner guard, step-up for role grants, audit of every grant |
| Supply chain | minimal dependencies, lockfile, `npm audit` in CI, pinned versions, Dependabot/Renovate |

Logging redaction: passwords, tokens, codes, cookies, `Authorization` headers and message
bodies of enquiries are never logged; emails are logged as HMACs. A security review (skills:
security-qa, production-hardening, secret-scanner, dependency-security) is a Phase 8 gate.

---

## 16. Performance strategy

- **Budgets (public pages):** HTML + critical CSS < 50 KB gz; JS before interaction < 120 KB gz
  (excluding the lazy experience chunk); LCP < 2.5 s and CLS < 0.05 on a mid-range phone over
  4G; INP < 200 ms.
- **Rendering:** SSR for every public page; islands of interactivity only where needed;
  route-level code splitting (admin/portal code never loads on public pages).
- **3D:** §11 tiers; compressed geometry/textures; streamed plates; poster-first; GPU work
  paused off-screen; frame-time governor.
- **Media:** AVIF/WebP via Image Transformations, correct `sizes`, lazy below the fold,
  `fetchpriority="high"` for the LCP image only, width/height always set.
- **Fonts:** at most three self-hosted WOFF2 files, subset, `font-display: swap` with metric
  overrides to avoid layout shift, preload only the display face.
- **Caching:** hashed static assets `immutable` for a year; anonymous public HTML cached at the
  edge briefly with `stale-while-revalidate`, purged on publish; nothing with a session is cached.
- **Database:** indexed queries for every list, pagination everywhere, batched reads, no N+1
  (asserted in integration tests by counting queries on key pages).

---

## 17. Accessibility strategy

Target **WCAG 2.2 AA**. Semantic landmarks and one `h1` per page; skip link; visible
`:focus-visible` styles designed as part of the brand; full keyboard support (menus, dialogs,
media library, tables); forms with programmatic labels, `aria-describedby` hints/errors and an
error summary that receives focus; colour contrast verified for text over imagery (scrims where
needed); `prefers-reduced-motion` honoured everywhere (no scroll-jacking, no autoplaying motion);
the 3D canvas is decorative with textual equivalents; touch targets ≥ 44 px; captions for any
film with dialogue; automated axe checks in CI plus a manual VoiceOver pass.

---

## 18. SEO strategy

- Per-route `meta` from loader data: title, description, canonical, Open Graph and Twitter
  cards (per-project OG images from the CMS; branded default).
- **Structured data (real fields only):** `Organization` (VORA), `WebSite`, `BreadcrumbList`,
  `CreativeWork` for case studies, `JobPosting` for open roles (only when salary/location data
  you provide is complete — otherwise omitted rather than guessed).
- `sitemap.xml` generated from published content with `lastmod`; `robots.txt` disallows
  `/admin`, `/client`, `/member`, `/account`, `/api`, `/preview`, `/login`, `/setup`; private
  routes also send `X-Robots-Tag: noindex, nofollow` and a robots meta tag.
- Semantic heading structure; descriptive link text; image alt text required for publication.
- Legacy URL 301s (§3.5) preserve existing equity; staging is behind Cloudflare Access and
  `noindex`.

---

## 19. Development phases

| Phase | Deliverables | Exit criteria |
|---|---|---|
| 0 Discovery | This document, discovery report, checklist | Your approval of §21 |
| 1 Foundation | Scaffold, env separation, full schema + migrations + seeds, Hono kernel (headers/CSP, CSRF, request IDs, logging, maintenance, flags, rate limits), auth (sessions, email 2FA, recovery codes, reset, invitations, bootstrap, login history, risk, alerts), RBAC + policies, email transports/outbox, enquiry pipeline, health/status, AI provider foundation, route shells, error pages, test infrastructure, backup runbook | typecheck, lint, unit + integration tests and build all pass |
| 2 Visual system | Tokens, type system (after logo + fonts), grid, navigation, transitions, surfaces, states, motion primitives | Responsive review at 4 breakpoints, a11y checks |
| 3 Hero / homepage | Environment pipeline from Blender, plates + real-time layer, tiers, storyboard stations | Not a prototype: performance budgets met on a real phone |
| 4 Public site | Services, Work + case studies, Our Story, Partners, Careers, Contact, legal, status | Content complete or explicit empty states; SEO in place |
| 5 Backend | CMS editors, versioning UI, media library, enquiries admin, careers/applications, users/roles, settings, audit views, webhooks, retention jobs | Integration tests for each workflow |
| 6 Portals | Admin polish, client portal (engagements, milestones, deliverables, files, messages), member area | IDOR and role-matrix tests pass |
| 7 VORA AI | Public assistant + admin tools, quotas, usage/cost dashboard | Failure-mode tests pass; kill switch verified |
| 8 QA | Full functional, security, accessibility, performance, visual regression, launch checklist | Launch-readiness report with no open blockers |

---

## 20. Risk list

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Blender Phase 2.2 files not yet available | High — hero can't honour the established world | Phase 3 blocked on the files; Phases 1–2 proceed |
| R2 | Logo not yet supplied | Medium | Isolated `Logo` component + neutral wordmark; type and palette finalised after |
| R3 | Pricing conflict (A$29.99 builds vs A$50k+ positioning) | High — credibility | Decision C1 |
| R4 | Service overlap with Solara | High — brand/partner trust | Decision C2; delivery model shown per service |
| R5 | Thin real portfolio (2 projects, media not supplied) | Medium | Honest, well-designed empty/limited states; no fabrication |
| R6 | Email-only 2FA inherits email-account security | Medium | Recovery codes, alerts; add TOTP/passkeys for Owner/Admin next |
| R7 | D1 has no interactive transactions | Low | `batch()` for atomic groups, conditional single-statement updates, idempotency keys |
| R8 | Gemini API churn (models/params change within months) | Medium | Adapter + admin-configurable model; health check; graceful degradation |
| R9 | 3D performance on low-end phones | Medium | Tiers T0–T3, plates, frame-time governor |
| R10 | Very new toolchain versions (React Router 8, Vite 8, TypeScript 7) | Medium | Pin versions; verify against package docs/types; CI on every change |
| R11 | Email deliverability / domain setup | Medium | Verify SPF/DKIM/DMARC in Resend before cutover |
| R12 | Cutover from Railway | Medium | Staging first, 14-day rollback window, redirects, data-migration mapping |
| R13 | Legal pages need real entity details | Medium | Structure drafted; content supplied/approved by you (not legal advice) |
| R14 | Single Owner account (bus factor) | High | Offline recovery codes; second Owner/Admin recommended |
| R15 | Image Transformations / Workers Paid / Access costs | Low | Documented; small monthly cost |
| R16 | Scope size | Medium | Phased delivery with verified exit criteria |

---

## 21. Decisions requiring your approval

| # | Decision | Recommendation |
|---|---|---|
| D1 | Platform | React Router 8 + Hono on Cloudflare Workers (Paid), D1, R2 |
| D2 | Authentication approach | Purpose-built auth on audited primitives (alternative: Better Auth) |
| D3 | Public pricing | Retire the A$29.99–189.99 price list; enquiry-led engagements; existing Premium maintenance clients supported through the portal |
| D4 | Branding / Motion / Film pages | Keep all four service pages; Branding, Motion and Film state "Creative by Solara. Digital by VORA." as the delivery model |
| D5 | Attached eye/star mark | Confirm whether it is VORA's mark; send the SVG master if so |
| D6 | Staff = privileged | Staff, Manager, Admin, Owner all require 2FA |
| D7 | Member sign-up | Off (feature flag) until a member offering exists |
| D8 | VORA AI scope | Public "Ask VORA" grounded in published content (off until content is final) + admin drafting tools |
| D9 | Hero rendering | Hybrid pre-rendered plates + real-time layer, confirmed after reviewing the Blender files |
| D10 | Typefaces | Commercial licences for the final display/text faces (budget TBC); open-source stand-ins meanwhile |
| D11 | Legacy routes | Retire /plans, /founders, /faq, /help, /process with 301s (§3.5) |
| D12 | Mark4 data | Tell me if existing enquiries or portal users must be migrated |
| D13 | Testimonials | Excluded until each is confirmed real, attributable and approved |
| D14 | Email senders | `hello@` for confirmations, `projects@` receives enquiry alerts, `careers@` applications |
| D15 | Enquiry budget ranges | You provide them; nothing is shown until set |
| D16 | Public `/status` page | Yes, coarse component states only |
| D17 | Flare Esports | Excluded unless you confirm it as VORA work |



