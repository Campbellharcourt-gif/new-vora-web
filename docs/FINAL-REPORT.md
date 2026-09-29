# VORA — Railway migration + design-system rebuild: final report

**Branch** `claude/charming-newton-fuhcej` · **Code** `debffd5` (RW-1 `8ba10d0` + DS-1 + DS-2) · 29 Sep 2026 ·
details and every command's output summary: `docs/VERIFICATION-LOG.md` (RW-1, DS-1, DS-2, A11Y-1).

> **This is a staging-ready build, verified locally — not production-ready.** Nothing here has run
> on Railway, Cloudflare, R2, Resend, Turnstile or Gemini, in WebKit/Firefox, or with a screen
> reader. Those items are listed below as **requires Railway / Cloudflare / human verification**.
> Nothing was deployed, purchased, created or migrated, and no secret was read or changed.

---

## 1. Architecture

| Concern | Now |
|---|---|
| **Runtime** | One Node.js 24.21.0 service (`build/server/index.js`): the Hono kernel (headers, CSRF, sessions, maintenance, API) + React Router 8 SSR, served by `@hono/node-server`. Start-up: validate configuration (refuse unsafe values) → open SQLite → `quick_check` → snapshot + migrate → Argon2id self-test → listen. SIGTERM drains requests and background work (25 s), then closes the database. One JSON log line per entry (`level`, `message`). |
| **Railway** (planned, not created) | Builds the root `Dockerfile` (Node and Litestream pinned by digest, non-root, read-only `/app`); one service, one volume at `/data`, health check `/api/health/live`, sealed variables, Singapore region, spending limit. No config-as-code. |
| **Cloudflare** (planned, not configured) | DNS, TLS (Full), WAF, cache, Turnstile, R2 (media, private, backups), Access for staging; a Transform Rule adds `X-Vora-Origin-Auth` (the origin refuses requests without it, 403) and `X-Vora-ASN`; visitor-location headers. |
| **Database** | SQLite through libSQL on the volume: foreign keys ON (compile-time default + PRAGMA + start-up guard), WAL, `synchronous=NORMAL`, busy timeout, one connection; D1-shaped facade so services are unchanged; the same 3 migrations and `d1_migrations` ledger, one atomic batch per file, `VACUUM INTO` snapshot first (last 3 kept). |
| **Files** | R2 over its S3 API (aws4fetch SigV4); the app never creates buckets. |
| **Backups** | Litestream `replicate -exec` to the private R2 backups bucket (≈ 1 s RPO); an empty volume restores automatically; staging/production refuse to start without it. Plus Railway volume backups, pre-migration snapshots and manual exports. |
| **Auth** | Unchanged from CP-3 in behaviour: Argon2id passwords (native `crypto.argon2`, same parameters and PHC format), server-side sessions, email codes for privileged roles, recovery codes, lockouts, enumeration-safe messages. |
| **Background jobs** | In-process UTC scheduler (croner): `*/5 * * * *` email retry (25 per run), `17 3 * * *` daily clean-up/retention; a running job is never started twice; `waitUntil` work tracked and drained on shutdown. |
| **Rate limiting** | In-process sliding windows (auth 20, forms 6, API 120, AI 12 per 60 s; bounded memory) plus the database-backed login throttles. Per process — correct for one replica on a volume. |

## 2. Design

**Source of truth:** `docs/VORA-DESIGN-SYSTEM.md` and `docs/design-system/` (unchanged). Nothing was
reinterpreted: the component CSS is a port of `bundle.css`, the reveal behaviour follows
`bundle.js`, the tokens are Appendix A.

**Primitives built** (`app/styles/tokens.css`, `fonts.css`, `vora.css`; `app/components/vora/`,
`site/`, `ui/forms.tsx`, `workspace/`): colour and type tokens; Basalt / Mist / workspace roles; the
4 · 8 · 12-column grid and spacing scale; SurveyLine (static, drawn, determinate, indeterminate);
Aperture (ratios, focal point, `<picture>`, priority/lazy, placeholder colour, survey plate and
typographic plate); InstrumentLabel; buttons (primary/secondary/quiet/danger, s/m/l, disabled,
loading sweep); text, arrow, external and back links; text fields, textarea with polite counter,
select, choice groups, checkbox, error summary with links, field errors; status squares; notices;
tables that stack below 768 px; section header; invitation; ProjectFeature/Tile/Rows/Facts,
Credits, NextProject; ServiceList with delivery labels; ProcessLine; triptych; CareerList;
QuoteBlock; header (resting/scrolled/hidden, Mist switching, current tick, route and reading
progress); menu dialog (focus trap, Esc, inert page, `<details>` without JS); footer; View
Transitions; fire-once reveals; reduced motion; the Mist workspace shell with a drawer dialog,
panels, top bar and breadcrumbs; Ask VORA panel.

**Routes:** `/` (six stations, T0), `/work`, `/work/:slug`, `/services`, `/services/:slug`,
`/our-story`, `/partners` (Mist), `/careers`, `/careers/:slug`, `/contact`, `/terms` · `/privacy` ·
`/cookies` (Mist), `/status`, 404 and error boundary, kernel maintenance/unavailable pages, all
seven auth pages (Basalt), and the account, admin (dashboard, enquiries, enquiry, users, system),
client and member areas (Mist workspace).

**Open decisions — the approved fallbacks are in place:**

| Item | In the build |
|---|---|
| D5 logo | the text wordmark in `Logo` (the single place to swap in the SVG) |
| D9 hero renders | Home ships the T0 typographic stations; plates/3D slot in later without restructuring |
| D10 typefaces | Archivo (+ semi-expanded cut), Newsreader Italic, DM Mono — OFL, self-hosted |
| D13 testimonials | off; QuoteBlock renders only CMS quotes from real people |
| D18 Design page | none — Websites covers it (option b) |
| D19 Journal | not built (deferred) |
| D8 VORA AI | built and **off**; appears only with the flag + setting + server key |
| D15 budgets | the field stays hidden until ranges exist |
| Motion cookie `vora_motion` | not adopted (needs approval + a Cookies-page entry): the OS setting and Save-Data only |
| `dominantColor` | not added (schema change needs approval): basalt-900 placeholder |

**Major visual decisions (within the system):** the wordmark sits on the survey-line horizon in
the first shot, which animates only from visible states; labels are real indices counted per page;
projects fall back to a survey plate (features) or their title on basalt (tiles) because no media
can be delivered yet; every missing sentence is a visible dashed `v-slot` naming what it needs
(e.g. "Home invitation — copy slot"); the Partners and legal pages are whole-page Mist; the
Reflection station inverts to Mist and the header follows it.

**Deliberately not added:** GSAP, Lenis and Three.js (nothing is scrubbed in T0; the Process line
lights its ticks with the reveal observer instead), the lightbox, video players and embeds (no media
to show; embeds would also need a CSP decision), and admin AI tools (no CMS editors exist yet).

## 3. Testing

| Category | Status |
|---|---|
| Typecheck, lint (Biome, 238 files) | **Passed** |
| Unit + tooling | **Passed** 239/239 |
| Integration (Node, real SQLite/storage/limiter adapters) | **Passed** 160/160 |
| E2E Chromium (desktop + Pixel 7), production build | **Passed** 102/102 (83 CP-3 + 19 design-system), re-run on `debffd5` |
| E2E HTTPS production mode behind a local Cloudflare stand-in | **Passed** 7/7, re-run on `debffd5` |
| Accessibility (axe WCAG 2.2 A/AA): every public page, 404, sign-in, both motion modes, member/account and admin areas, menu open | **Passed** (no serious/critical) |
| Security scan (repository + client bundle) | **Passed** — no findings |
| Mutation check | **Passed** 20/20 regressions caught (on `4a7dcfc`) |
| Clean room (fresh clone, `npm ci`) | **Passed** — verify, E2E, HTTPS, scan (on `4a7dcfc`; not re-run for DS-2, which changes client packaging only) |
| Docker image build + rehearsal | **Passed** 25/25 (on `4a7dcfc`) |
| `deploy:check` (image validates both environment templates) | **Passed** (on `4a7dcfc`) |
| Restore rehearsal (Litestream file replica) | **Passed** 37/37 (on `4a7dcfc`) |
| Visual audit against the design system (1440 / 390 / 320 px) | **Passed** after fixes (log DS-1) |
| Ask VORA states in a browser (local provider stand-in) | **Passed** |
| Performance: CSS 11.7 KB, fonts 197 KB | **Passed** (budgets 50 KB HTML+CSS, 200 KB fonts) |
| Performance: JS before interaction 116.1–119.8 KB gzip on the marketing pages (was 120.3–124.0) | **Passed** — under 120,000 B on all 19; tightest: service pages 163 B under, Contact 214 B (DS-2) |
| Accessibility hardening pass (A11Y-1): keyboard, skip link, focus visibility, menu dialog (trap, Esc, return, `inert`), headings and landmarks, reduced motion | **Passed** after 2 fixes: focus after choosing a page from the mobile menu now reaches the new h1 (it landed on `<body>` since DS-1), and links inside project features / the case-study opening show their own focus ring again. Targeted re-run: typecheck, lint, unit 239/239, E2E design-system + a11y specs 34/34 |
| WebKit / Firefox E2E | **Requires human verification** (your Mac) |
| VoiceOver (macOS / iOS) | **Requires human verification** |
| Lighthouse (LCP/CLS/INP on a mid-range phone) | **Requires human verification** |
| Docker on your Mac | **Requires human verification** |
| Deploy, volume, health check, logs, `railway ssh`, draining | **Requires Railway** |
| Origin-auth and ASN Transform Rules, location headers, SSL Full, Access, WAF/Bot Fight Mode | **Requires Cloudflare** |
| R2 signing live, Litestream to R2 | **Requires Cloudflare** (R2) |
| Resend, Turnstile, Gemini live | **Requires Railway + provider accounts** |
| Intentionally skipped | the admin-area E2E runs in the Chromium desktop project only (sign-in codes: 60 s cooldown per account); no test was disabled to reach green |

## 4. Security

| Control | State |
|---|---|
| **Authentication** | unchanged; login/verify/recovery/reset/invite/setup pages restyled only — same actions, same messages, still enumeration-safe (E2E proves identical responses) |
| **Argon2id** | native, same m=19456 · t=2 · p=1 · 32-byte tag · 16-byte salt · NFKC · PHC; byte-identical to `@noble/hashes`; start-up known-answer self-test; bounded queue → 503 with nothing recorded |
| **Sessions** | `__Host-vora_session` (Secure, HttpOnly, SameSite=Lax) in production; stored hashed; revocation, expiry and step-up unchanged |
| **CSRF** | kernel Origin/Sec-Fetch-Site gate on every unsafe method (including the new `/api/v1/ai/ask`, tested) + signed form tokens |
| **Rate limiting** | auth/forms/API/AI limiters and DB login throttles; the AI endpoint also has daily request/token budgets and a circuit breaker |
| **Request trust** | staging/production require `X-Vora-Origin-Auth` (constant-time, ≥ 32 chars, 403 otherwise); Cloudflare headers trusted only behind it; the URL comes from `APP_ORIGIN`, never Host/X-Forwarded-*; Access JWT verified on staging |
| **Secrets** | none in the repository, image or client bundle (scan); sealed Railway variables; the Gemini key is server-only — the browser posts to the app, never to the provider |
| **Headers** | CSP with per-request nonce (unchanged; fonts are same-origin, so `font-src 'self'` still holds), HSTS, `nosniff`, `X-Frame-Options: DENY`, CORP; hashed assets immutable |
| **Turnstile** | enquiry form and login challenge unchanged; test keys refused at start-up in staging/production |
| **2FA / recovery** | email codes for privileged roles, 10 recovery codes, no back door (runbook) — unchanged |
| **New surface** | `POST /api/v1/ai/ask`: off by default; JSON only, 64 KB cap, schema-validated; answers rendered as text; source links limited to published site paths |

## 5. Data

| | |
|---|---|
| **Schema / migrations** | unchanged (3 files); no migration was added by the rebuild |
| **Foreign keys** | enforced on every connection; start-up refuses if off; tests and mutations prove it |
| **Triggers** | unchanged (append-only audit/security tables, last-Owner protection) — verified to refuse on restored databases |
| **Backup** | Litestream to R2 + volume backups + pre-migration snapshots + exports (runbook) |
| **Restore** | rehearsed: Litestream restore and snapshot restore identical to the source (every table's SHA-256, schema, `integrity_check`, 0 FK violations), and the Owner signs in afterwards |
| **Integrity** | `quick_check` at start-up; `node build/server/index.js integrity` in the container |
| **Content** | seeds unchanged: everything is draft; public pages show their honest empty states until content is published |

## 6. Files

**RW-1** (`8ba10d0`, 50 created / 41 changed / 17 deleted / 2 renamed): the Node runtime
(`server/`), platform adapters, native Argon2id, libSQL, R2, scheduler, trust, Docker/Litestream,
scripts and tests — itemised in `VERIFICATION-LOG.md` RW-1 and `docs/railway/TEST-MAPPING.md`.
Deleted with justification: `wrangler.jsonc`, `worker-configuration.d.ts`, `workers/app.ts`,
`public/_headers` (Workers-only), `app/.server/auth/password-hasher.ts` (the Durable Object — replaced
by native Argon2id after its replacement passed), `scripts/predeploy-check.ts`, `scripts/confirm.mjs`,
`scripts/lib/jsonc.ts`, `scripts/e2e-servers.mjs`, `scripts/https-server.mjs` (replaced by `.ts`
versions for Node), and the Cloudflare-only tests — each replaced by equivalent coverage
(`TEST-MAPPING.md`).

**DS-1** (`59ae614`, `aeac42e`, `4a7dcfc`, 23 created / 42 changed / 5 deleted):

| | Files | Why |
|---|---|---|
| Created | `app/styles/fonts.css`, `app/styles/vora.css`; `app/assets/fonts/*` (4 WOFF2 + 3 OFL licences, byte-identical to the design system); `app/components/vora/{primitives,icons,projects,services,careers,reveal}`; `app/components/site/{SiteHeader,SiteFooter,AskVora,AskVoraPanel}`; `app/components/workspace/status.tsx`; `app/.server/ai/assistant.ts`; `tests/integration/ask-vora.test.ts`; `tests/e2e/design-system.spec.ts` | the design-system layer, shell, assistant and their tests |
| Changed | `app/styles/{tokens,base}.css`; `app/root.tsx`; every route under `app/routes/{public,auth,account,admin,client,member}`; `app/components/{ui/forms,ui/Logo,content/Blocks,account/RecoveryCodes,workspace/WorkspaceShell}.tsx`; `app/.server/kernel/pages.ts` (styles); `app/.server/services/published-content.ts` (3 read-only queries over published rows); `app/.server/api/routes.ts` (the AI endpoint); `app/.server/auth/login.ts`, `app/routes/auth/login.tsx` (stale comments only) | presentation on the design system; no change to route logic, validation, auth or data rules |
| Deleted | `app/routes/public/site.module.css`, `app/routes/auth/auth.module.css`, `app/components/ui/forms.module.css`, `app/components/ui/Logo.module.css`, `app/components/workspace/workspace.module.css` | Phase 1 provisional styles, superseded by the token + component layer |
| Docs | `README.md`, `docs/CHECKLIST.md`, `docs/VERIFICATION-LOG.md`, this report | status and evidence |

**DS-2** (`debffd5`, 1 created / 5 changed): the JavaScript budget.

| | Files | Why |
|---|---|---|
| Created | `app/components/vora/aperture.tsx` | Aperture moved out of the primitives, byte-identical, so pages without media never download it |
| Changed | `vite.config.ts` (two client chunk groups); `app/components/vora/{primitives,projects}.tsx`, `app/routes/public/{service,project}.tsx` (imports; `cx`/`Style` exported) | packaging only — no behaviour, style or test change |
| Docs | `docs/VERIFICATION-LOG.md` (DS-2), this report | measurements and evidence |

## 7. Checkpoints

| | |
|---|---|
| CP-3 ZIP (`vora-cp3-cloudflare-free.zip`) | untouched — SHA-256 `b8127146…59281dd`; the extracted reference copy still 224 files; imported unchanged as `5b67c21` |
| Phase 1 ZIP, CP-2.1 skip-link patch, docs patch, design-system and Railway documents, CP-3 compatibility note | untouched — SHA-256 unchanged (`VERIFICATION-LOG.md`) |
| CP-2.1 frozen ZIP | not supplied to this session, so it could not be hashed here; nothing in this work can reach it (its fix is part of CP-3 and reverse-applies cleanly) |
| Production resources | none touched: no Railway project, no Cloudflare/R2 resource, no DNS change, Mark4 untouched |
| Secrets | none read, created, rotated or exposed; only throwaway local test values |
| Real data | none migrated; all databases were local, throwaway and git-ignored |

## 8. Remaining work

**Before Railway staging (your decisions/approval — R8):** D20 plan + spending limit, D21 region,
D22 staging protection, D24 database; create the Railway project/volume/variables and the R2
buckets, token, Turnstile widget, Transform Rules and Access application (`runbooks/deployment.md`
§1–2). Run WebKit/Firefox E2E and the Docker rehearsal on your Mac. The JavaScript budget is met since DS-2, with thin margins on the service pages (163 B) and
Contact (214 B). Rebuild the release ZIP from the final commit (the DS-1 ZIP is `0230357`).

**Staging verification (R9):** everything marked *requires Railway/Cloudflare* above — deploy,
origin refusal without the header, client IP and location, Resend codes, Turnstile, Access,
Litestream to R2 and a restore drill, logs, health checks, `railway ssh` operator commands; a
Lighthouse run and a VoiceOver pass on staging, with Lighthouse CI budgets on Home, Work, a case
study, Contact and Sign in (design system §14) to hold the JavaScript budget.

**Production (R10, separate approval):** the cutover plan (`runbooks/deployment.md` §6), D12 Mark4
data decision, Mark4 kept 14 days.

**Final content launch:** approved Terms/Privacy/Cookies (listing `__Host-vora_session`), the copy
slots (positioning line, Approach final copy, per-page invitations, page leads, service bodies and
who-does-what, partner principle bodies, "what happens next"), case-study material and client
approval (captures, covers, year, credits) for SAIL Gaming and EON Clothing, service plates, the
media delivery route (Phase 5), the logo (D5) and Blender renders (D9), budget ranges (D15), and
publishing each item in the CMS.
