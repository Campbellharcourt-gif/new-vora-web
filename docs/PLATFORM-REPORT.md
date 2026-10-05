# VORA — Full Platform, Accounts, Admin & AI · Report

Branch `claude/charming-newton-fuhcej` · work from `14592f4` to the commit that adds this file ·
build sandbox (Linux, Node 24.21.0, preinstalled Chromium 1194). **Not deployed** (see §10).

---

## 1. Completed

**Accounts**
- Sign-in shows “New to VORA? Create an account as a Client or Member.” with a **Create an
  account** button (`/register`). Client and Member are described with the agreed wording; Owner,
  Admin and Staff remain invite-only (a forged account type is refused server-side).
- Registration is two steps — details, then an emailed single-use link to set a password — so
  nobody can claim an address they don't control. Answers are identical whether or not the
  address already has an account (existing owners get a sign-in reminder). Rate-limited, honeypot,
  signed form token, Turnstile when configured, per-address hourly cap, `accounts.self_signup` flag.
- Optional emailed two-step codes for Clients and Members (Account › Security), with recovery codes;
  privileged roles keep mandatory two-step. No SMS (no provider exists) and nothing is faked.
- Account › Notifications and Account › Privacy (see below); welcome notice on first landing.

**Admin workspace** (every screen gated in the loader *and* every operation re-checked in its service)
- **Dashboard:** new/open enquiries, active client projects, clients, new users, failed sign-ins,
  recent enquiries, active projects, recent users, recent activity, unpublished content and system
  status — each module only with its permission.
- **Enquiries:** search (name, email, company, reference, message), status and assignee filters,
  assignment with an in-app notice to the assignee, notes, status changes, timeline with who acted,
  and an optional VORA AI summary.
- **Clients & client projects:** organisations, linking Client accounts (by email), projects with
  status, dates, summary, assigned team, services (`engagement_services`), milestones, updates
  (shared with the client or internal), private files and activity. Staff below Manager see only
  projects they're assigned to.
- **Client portal:** a client's own projects only — overview, services, team, milestones, shared
  updates (and replying), shared files.
- **Users, staff, members:** search and role/status filters; a page per person (roles, two-step,
  sessions, organisations, recent sign-ins, activity); role changes after password confirmation and
  rank rules; suspend/reactivate; “Sign out everywhere”. **Roles and permissions:** system roles are
  read-only; Owners can create/edit/delete custom roles (rank ≤ 90, never `roles.manage`; admin
  access forces two-step; editing signs holders out; delete blocked while held).
- **CMS:** case studies, services, pages, partners and careers share draft → publish → version.
  Publishing writes the immutable snapshot the public site reads; the last 20 drafts are kept; any
  version can be restored as a draft; unpublish and archive. Editors write plain text with simple
  formatting (validated into content blocks — never HTML). Content hub: pages, home-page lines,
  site announcement, social links.
- **Settings:** site details, contact addresses, features (flags), maintenance, retention, and an
  integrations panel that shows only whether each secret is present (names of the variables, never
  values). **Security:** events (filter, acknowledge) and sign-in activity. **Audit log:** filterable,
  append-only. **Privacy requests:** queue for deletion requests. **VORA AI:** status, limits, usage.

**VORA AI** — enquiry summaries and draft suggestions, server-side only, through the existing
guarded path (admin switch + `ai.admin_tools` flag + `ai.use` + per-record permission + rate limits +
daily budgets + usage ledger). Record text is sent as delimited data the model is told never to
obey; names and email addresses aren't sent; output is plain text a person reviews; every use is
audited. The key stays in the environment.

**Enquiry flow** — “What happens after sending” with exactly: *“Your enquiry is securely received
by our team, reviewed with care, and followed up with the next steps when there’s something to
discuss.”* on the form and after sending; the confirmation email uses the same words. No response
times anywhere. Existing validation, storage, confirmation email, spam protection and errors kept.

**Legal** — pages titled **Terms & Conditions** and **Privacy Policy**, with “Last updated” (the
publish date), contents list, cross-links, and the existing reading layout. Footer:
“Terms & Conditions · Privacy Policy”; also on the sign-in/registration pages; the Privacy Policy is
linked from the contact form, registration and Account › Privacy. **No legal text was written:**
until the supplied documents are published, the pages say “This page is being finalised.”

**Privacy controls** — Account › Privacy: account details, a JSON download of the person's own data
(after password confirmation; generated on request, never stored; no hashes/tokens), and a deletion
request confirmed by typing the email address (cancellable while pending). Admins with
`privacy.manage` complete it by anonymising the account (signed out, roles/links/notifications/
recovery codes removed, name and email replaced; audit kept) or decline with a note. No compliance
claims are made.

**Files** — private bucket only; type from the bytes plus an allowlist (PDF, images, Office,
ZIP, video, text/CSV); HTML/SVG/scripts/executables refused; 20 MB cap checked before the body is
read; EXIF/GPS and PNG text metadata stripped; id-only storage keys; downloads at `/api/v1/files/:id`
after a policy check, always as attachments with `nosniff`; 404 for anything not yours.

**Notifications** — in-app only (no email spam): client project updates/files/status, assignments,
client messages to the assigned team, new client accounts and deletion requests to the people who
handle them. Read ones are pruned after 180 days by the daily job.

## 2. Existing and reused

- **Pushed admin modules (34 commits on this branch, 2 Oct):** their routes and navigation were kept
  (`/admin/clients`, `/engagements`, `/projects`, `/services`, `/content`, `/settings`, `/security`,
  `/audit`). They did not compile (a JSX syntax error in `services.tsx` and type errors), so their
  service layer (`admin-crud.ts`) was replaced by domain services that enforce permissions per call,
  and four per-type route files were replaced by one list and one editor route shared by all CMS
  types. `admin-workspace.ts` was kept and rewritten (overview, integrations, security reads).
- Reused rather than duplicated: the invitation machinery (self-registration), `runAi` and its
  guards, `content_versions` + published-content snapshot reads, the typed settings service and
  feature flags, audit log and security events, sessions/elevation (password step-up), rate
  limiters, form tokens, Turnstile, the email outbox and templates, the existing schema tables
  (privacy requests, notifications, milestones, files, messages, custom roles), WorkspaceShell and
  the form components.

## 3. Tests — exact commands and results (final commit)

| Command | Result |
|---|---|
| `npm run typecheck` | PASS (exit 0) |
| `npm run lint` | PASS — 282 files, no fixes |
| `npm run test:unit` | PASS — 244/244, 21 files |
| `npm run test:integration` | PASS — 220/220, 24 files |
| `npm run build` | PASS |
| `npm run security:scan` | PASS — 403 committable files + 79 bundle files, no findings |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e` | PASS — 117/117 (Chromium desktop + Pixel 7) |
| `PW_CHROMIUM_PATH=… npm run test:e2e:https` | PASS — 7/7 |
| `npm run test:e2e:browsers` (WebKit, Firefox) | **NOT VERIFIED** — those browsers aren't installed here |

New tests: registration (service + E2E), RBAC matrix for Owner/Admin/Staff/Client/Member with
denials (services + API) and portal isolation (E2E), data isolation between two clients
(projects, updates, files, downloads, notifications), CMS drafts/publish/restore/validation/XSS,
enquiry search/assignment and the after-sending copy, AI (unauthenticated, forbidden, disabled,
server-side data hygiene, per-record permission, budget, key exposure), privacy export/deletion,
notifications scoping, custom roles, uploads (type sniffing, size, metadata stripping), legal pages
and footer, the 0004 data migration, and an admin E2E covering every screen, publishing, a real
upload/download and staff refusals. No existing test was removed. Existing tests that changed:
`contact.spec` and `security.spec` (consent link now reads “Privacy Policy”), `settings-flags`
(the renamed sign-up flag), `sqlite-platform`, `health-jobs` and `server-lifecycle` (migration
counts now follow the migrations folder); `enquiries.test` gained tests.

## 4. Security review

| Area | Finding / status |
|---|---|
| Authentication, sessions | Unchanged core. Registration can't pre-hijack an address; confirmation links are single-use; role and custom-role changes revoke sessions. |
| CSRF | Global same-origin gate covers every POST, including the new export route and API. |
| XSS | No `dangerouslySetInnerHTML`; CMS text becomes validated blocks rendered by React; links limited to https/mailto/site paths. |
| SQL injection | Drizzle parameters only; search `LIKE` escapes wildcards; no new raw SQL. |
| Authorisation | Every service authorises; loaders also gate. Staff scoped to assigned projects; clients to their organisation; rank rules for user actions. |
| Privilege escalation | Self-registration can't select or complete staff invitations; custom roles capped below Admin and without `roles.manage`. |
| Enumeration | Registration answers identically; files/projects answer 404 for anything not yours. |
| Files | See §1. **Fixed during review:** none outstanding. Not available: antivirus scanning (no service). |
| AI endpoints | Admin-only, permission-checked twice, delimited untrusted data, budgets and rate limits; key never in responses or bundles. **Fixed:** a page component named the key's variable — moved server-side (bundle scan now clean). |
| Admin routes | No UI-only protection; 403 pages for portal accounts verified in the browser. |
| Rate limits | **Fixed:** client project messages are now limited per user. Registration, AI and existing forms already limited. |
| Open redirects | **Fixed:** announcement and notification links reject `/\…` as well as `//…`. |
| Environment variables / secrets | Integrations panel shows presence only; no secrets in settings; **fixed** a test literal the repo scanner flagged. |
| Audit | Admin, content, client, role, privacy and AI actions are audited without secrets or message bodies. |

Design note for review: Staff hold `clients.view` (existing role definition), so they can see all
client organisations and their contact people, while project access stays assignment-scoped.

## 5. Remaining configuration (your actions)

1. **Legal documents:** paste the supplied Terms & Conditions and Privacy Policy into Admin ›
   Content › Pages and publish (the date shown becomes “Last updated”).
2. **Self-registration:** `accounts.self_signup` is **on** by default — turn it off in Settings ›
   Features if you don't want public sign-ups yet. Link new Client accounts to their organisation
   (Clients shows who is waiting).
3. **VORA AI:** set `GEMINI_API_KEY` on the server if not already; then switch on admin tools in
   Admin › VORA AI and the `ai.admin_tools` feature; set provider prices for cost estimates.
4. **Email / bot protection:** real delivery needs the Resend variables; staging/production forms
   need the Turnstile keys (already documented in `docs/railway/variables.md`).
5. **Content:** seeded case studies, services, partners and roles are drafts — publish what's
   approved; set the home-page invitation line (Content › Home page).
6. Migrations `0003_engagement_services` and `0004_legal_titles` run automatically at start-up.

## 6. Not completed

- WebKit and Firefox runs (not installed here): run `npm run test:e2e:browsers` on a machine with
  them — important given the earlier Safari fixes.
- Upload virus scanning (no scanning service in this stack).
- A media library for public CMS images (`media.*` permissions exist; image blocks can reference
  existing media only), draft preview links (`preview_tokens` exists, unused), and an admin screen
  for job applications (careers currently apply by email).
- Email copies of client-project notifications (in-app only, deliberately, to avoid spam).
- Member-area features beyond the account itself (none were specified).
- Deleting an account doesn't remove enquiries sent from that address; the request form asks
  people to say so if they want that.

## 7. Files changed (98, from `14592f4`)

Services: `app/.server/services/{activity,admin-workspace,content-admin,engagements,files,
notifications,privacy,roles,social-links}.ts` (new); `client-portal, enquiries, flags, settings,
users` (changed); `app/.server/services/admin-crud.ts` (removed). Auth: `auth/registration.ts`
(new); `account.ts`, `invitations.ts`. AI: `ai/admin-tools.ts` (new). API: `api/routes.ts` (file
downloads). Shared: `shared/content/{kinds,text-format}.ts` (new); `enums.ts`,
`validation/{auth,enquiry}.ts`. Routes: admin `ai, audit, client, clients, content, content-item,
content-list, engagement, engagements, privacy, roles, security, settings, user` (new or rebuilt),
`_layout, dashboard, enquiries, enquiry, users`; account `notifications, privacy, privacy-export`;
auth `register, verify-email`, `_layout, login`; client `project`, `_layout, index`; member
`_layout, index`; public `_layout, contact, home, legal`. Components: `SiteFooter, forms,
WorkspaceShell, status`; styles `vora.css`. Data: `migrations/0003*, 0004*`, journal and snapshots;
seed definitions. Scripts: `e2e-prepare.ts`, `restore-rehearsal.ts`. Tests: 6 new integration
files, 4 new E2E specs, 1 new unit file, 9 updated. Full list: `git diff --name-status 14592f4`.

## 8. Database changes

- `0003_engagement_services` — new table `engagement_services` (engagement ↔ service, cascade).
- `0004_legal_titles` — data only: renames never-published `terms`/`privacy` pages still titled
  “Terms”/“Privacy”; edited or published pages untouched.
- New settings keys (rows created on first save): `home.copy`, `site.announcement`. New flag key
  `accounts.self_signup` (replaces the unused `members.self_signup`).
- Everything else uses existing tables (privacy requests, notifications, milestones, engagement
  files/messages, roles and role permissions, content versions).

## 9. Environment variables (names only — none added)

`APP_ENV`, `APP_ORIGIN`, `AUTH_SECRET`, `AUTH_SECRET_PREVIOUS`, `EMAIL_TRANSPORT`, `EMAIL_FROM`,
`EMAIL_REPLY_TO`, `TEAM_NOTIFY_EMAIL`, `CAREERS_NOTIFY_EMAIL`, `RESEND_API_KEY`,
`RESEND_WEBHOOK_SECRET`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `GEMINI_API_KEY`,
`AI_GATEWAY_BASE_URL`, `SETUP_TOKEN`, `MAINTENANCE_MODE`, `LOG_LEVEL`, and the platform's
`R2_*` storage variables — as documented in `docs/railway/variables.md` and `.dev.vars.example`.

## 10. Deployment status

**Deployed to Railway (staging) by push; health-checked by Railway; not verified from outside.**

- Railway's GitHub integration deploys every push to `claude/charming-newton-fuhcej` (project
  “resplendent-truth”, Railway environment named “production” — the service behind
  staging.vorawebsites.store, `APP_ENV=staging`). `main` was not touched.
- GitHub deployment records: `8a497f6` (this work's final code) → **success**, 5 Oct 2026 12:38 UTC.
  Every push from `7de01ee` on succeeded. Two did not build and never went live: `fd7fdc8` (a
  build error fixed in `7de01ee`) and the pushed admin commits of 1 Oct (`411b8d4` and others) —
  Railway kept the previous version running for those.
- Railway only marks a deploy successful after `/api/health/live` passes, which requires every
  migration to be applied, so `0003` and `0004` ran on the staging database at start-up.
- **Not verified:** the live site itself. This build sandbox's network policy blocks
  staging.vorawebsites.store, so no page or health check was fetched from here.
- No Railway, Cloudflare, R2, Resend, Turnstile or Gemini settings were changed and no secrets were
  created. This is a staging deployment, not a production-ready claim.
