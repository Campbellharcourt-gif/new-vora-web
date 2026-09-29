# VORA — Design System

Version 0.1 · 29 September 2026 · Status: **proposal for review — nothing implemented yet.**
Companion: the **VORA Design System** artifact, a private page on claude.ai. It holds live specimens of
the tokens and type, 28 components with previews in both themes, the motion demo and a brand
book. Its complete source is in `docs/design-system/`: `tokens.json`, `components/bundle.css`,
the previews, and the OFL font files with their licences.

This is the system Claude will build the VORA rebuild with. It replaces the Phase 1 placeholder
tokens (`app/styles/tokens.css`, marked "PHASE 1 PROVISIONAL") once you approve it. Semantic
token names already used in the code (`--color-bg`, `--color-text`, `--space-*`, `--ease-out` …)
are kept, so components written in Phase 1 keep working; only values and additions change.

**Evidence used.**

- **The four reference recordings.** R0 ALCHE, R1 "Ascend", R2 "FIND" and R3 "Creative
  Digital Experiences", analysed in `00-DISCOVERY.md` §2. R0 (`ScreenRecording_0.MP4`) was
  re-inspected for this document.
- **The eye/star mark and its lagoon colours** (`00-DISCOVERY.md` §3).
- **The approved experience direction** (`01-ARCHITECTURE.md` §11).
- **The code as it is:**
  - routes in `app/routes.ts`;
  - seeded content in `app/.server/db/seed/definitions.ts`;
  - the public layout, contact form and portals.
- **Stated business facts**, including how VORA must differ from Solara.

**Rules this document follows.**

- **Real content only.** Copy shown here is either real (from the live Mark4 site or your
  statements) or marked *slot*. Where the CMS provides the text, no business claim, statistic,
  client or project has been invented.
- **"Premium" is a quality bar, not a price claim.** Decision D3 retired the public price list.

**Open decisions this system depends on.** Each has a working default so design and build can
proceed.

| # | Open item | Working default until you decide |
|---|---|---|
| D5 | Is the eye/star mark VORA's logo? (SVG master needed) | Palette derived from it (§3); text wordmark placeholder (existing `Logo` component) |
| D9 | Hero rendering (Blender Phase 2/2.2 files not supplied) | Station storyboard with a typographic, no-WebGL tier that works on its own (§8, §16.1) |
| D10 | Commercial typefaces (licence budget) | Open-source faces below, chosen so a commercial upgrade is a drop-in (§2.7) |
| D13 | Testimonials | Pattern defined, switched off |
| D18 / D19 | "Design" and "Journal" pages (new decisions) | Neither exists in the code; direction given as proposals only (§10.3). Full list in Appendix C. |

**Contents.**

1. Brand direction
2. Typography
3. Colour system
4. Layout and grid
5. Navigation
6. Buttons, links and interaction states
7. Components
8. Motion system
9. Image and media
10. Public site structure
11. Portals (Admin, Account, Client, Member, VORA AI)
12. Responsive behaviour
13. Accessibility
14. Performance
15. DO NOT MAKE VORA LOOK LIKE THIS
16. Page-by-page direction

Appendices: A — token reference; B — what each reference contributes; C — open items.

---

## 1. Brand direction

### 1.1 The idea — *digital architecture in natural light*

VORA builds websites and digital platforms. The visual world is an architect's view of that work:
**precise structures set into a calm natural landscape — stone, water, mist, controlled
sunlight.** Precision (the survey line, the measured grid, the instrument label) meets atmosphere
(light, depth, water). Everything on screen is either *built* (typography, grid, hairlines,
apertures) or *lit* (imagery, film, the environment). Nothing is decorated.

Three signature devices make VORA recognisable without a logo on screen:

1. **The survey line.** A single 1 px hairline that is drawn, measured and extended: it becomes
   the loader, the scroll-progress rule, the underline, the section divider and the horizon in
   the hero. It comes from treatment B's drawing language in `01-ARCHITECTURE.md` §11.1. It never
   curls into decoration; it is always straight or follows a real edge.
2. **Apertures.** Media is shown through rectangular openings with sharp corners, the way
   architecture frames a view. They open (clip-path) rather than fade, and the frame stays
   still while the view moves (parallax *inside* the window, never the window itself).
3. **Instrument labels.** Small monospace labels carry real metadata: section index, chapter
   name, year, discipline, status. They express care and precision. They are never fake
   coordinates, fake statistics or "system online" theatre.

### 1.2 Atmosphere

- **Quiet, cinematic and monumental.** Large, calm compositions; one idea per screen.
- **Mostly dark ("Basalt"), with light "Mist" chapters.** The light chapters are editorial and
  reflective moments (partnership, legal reading). The hard inversion is taken as a *principle*
  from R0/R2, not copied.
- **Light is the protagonist.** Colour comes from light falling on material: a teal-green lagoon
  tint in highlights. It never comes from UI gradients.
- **Slow, weighted and architectural motion** (`01-ARCHITECTURE.md` §11.4):
  - long ease-outs;
  - no bounce;
  - one gesture per shot.

### 1.3 Design principles

1. **One world, scroll is the camera.** Pages are sequences of *shots* (stations), not stacks
   of unrelated blocks.
2. **Scale contrast with restraint.**
   - Monumental type or image next to tiny, precise UI.
   - Very few words per shot.
   - Negative space is the luxury signal.
3. **One typographic gesture per shot.** An expanded display line, *or* an italic emphasis word,
   *or* a chapter word — never several at once.
4. **Content sits in space along a path.** Projects are placed in depth along the camera path,
   never floating at random.
5. **Chapter inversions create rhythm.** Basalt ↔ Mist, used at most two or three times per
   page.
6. **The climax is staged.** The invitation to start a project lands at the most resolved moment
   of each page. It is not a generic band repeated identically.
7. **Precision is visible.** Hairlines, indices, measured spacing and aligned baselines are the
   craft signal.
8. **Real or nothing.**
   - Real projects, real people, real media.
   - An honest empty state beats a filler grid.
9. **Fast is premium.** Content paints first; the cinematic layer is an enhancement, never a gate
   (§14).
10. **Accessible by construction.** Every effect has a reduced-motion and keyboard equivalent
    (§13).

### 1.4 What VORA should feel like

Composed, confident and exact: like entering a well-made building at the right time of day. It
should be calm enough to read and precise enough to trust, with enough spectacle at a few key
moments that a visitor remembers it.

### 1.5 What VORA must not look like (summary — full list in §15)

- **A SaaS template or a React dashboard kit** on the public site.
- **The references.** No ALCHE triangle, violet volumetrics or wireframe loader; no Ascend
  ribbed arch; no R3 pixel type, neon space or particle flora; no FIND cloud descent or cropped
  footer wordmark.
- **Web3, gaming, crypto, neon or cyberpunk**, including glow orbs and gradient text. The old
  maintenance page used both; both are retired.
- **Solara.** No Poppins, no cream/gold palette, no Solara compositions. VORA is the
  *digital/architectural* studio; Solara is the *creative/visual* studio. Their visual languages
  must stay distinct.

---

## 2. Typography

### 2.1 Families (open-source now, commercial-ready)

| Role | Family | Why | File |
|---|---|---|---|
| **Display + UI + body** | **Archivo** (variable: `wght` 100–900, `wdth` 62–125; SIL OFL) | One family gives two voices. The **semi-expanded** width (`wdth` 112.5, CSS `font-stretch: semi-expanded`) at light weights reads as monumental and architectural for display. *Normal* width (100) at 400–500 reads as a clear, neutral grotesk for body and interface. It is not Inter or Poppins, avoids the default SaaS look, and uses no Solara face. | 1 variable WOFF2, Latin subset (≈90 KB) |
| **Editorial emphasis** | **Newsreader Italic** (variable `wght`; SIL OFL). The `opsz` axis is pinned at 48 when the file is built, which suits display-size emphasis and keeps the file small. | Only for the one-word italic emphasis inside a headline and for pull quotes. It adds a human counterpoint to the engineered grotesk. It is never used for whole paragraphs. | 1 variable italic WOFF2, Latin (≈56 KB, `wght` 300–500) |
| **Instrument labels + data** | **DM Mono** (SIL OFL) | Labels, indices, metadata, codes, table numbers. Its light, precise shapes suit the survey language. | 1 static WOFF2 (Regular), Latin (≈15 KB) |

That is three font files, about 161 KB in total — within the architecture budget (§14). The sizes
were measured on the Fontsource 5.3.0 builds (Archivo and Newsreader variable, DM Mono), with
Newsreader instanced using fontTools. All are self-hosted: no Google Fonts requests from the
production site. `font-display: swap` is used with fallback metric overrides (`size-adjust`,
`ascent-override`) so text doesn't jump when the fonts load.

- **Coverage:** the Latin subsets include `×`, `·`, `–`, `—`, curly quotes and Latin-1 accents, but
  **no arrows** and no Latin Extended-A (e.g. `ā`). Arrows are therefore SVG icons (§6.2), never
  typed glyphs. A Latin Extended subset is added behind `unicode-range` (downloaded only when a
  page uses those characters) if names or content need it.
- **One glyph defect:** Archivo's multiplication sign `×` renders malformed at light weights at
  any width above normal. This was seen in Chromium with the unmodified variable file. Inside
  display lines, set it at normal width (a `.t-times` span: `font-stretch: 100%; font-weight:
  300`) or replace it with a survey mark. Every other glyph in the subset was checked on a
  rendered sheet and is correct.

### 2.2 Type scale (fluid; minimum at a 360 px viewport, maximum at 1440 px)

| Token | Use | Size (`clamp`) | Family / axes | Weight | Tracking | Line height |
|---|---|---|---|---|---|---|
| `--type-display-xl` | Hero statements, chapter words | `clamp(3.25rem, 1.44rem + 8.05vw, 10rem)` | Archivo semi-expanded (`wdth` 112.5) | 300 | −0.04em | 0.9 |
| `--type-display-l` | Page titles on marketing pages | `clamp(2.75rem, 1.61rem + 5.07vw, 6.5rem)` | Archivo semi-expanded | 320 | −0.035em | 0.94 |
| `--type-display-m` | H1 on content pages, menu items | `clamp(2.25rem, 1.61rem + 2.84vw, 4.5rem)` | Archivo semi-expanded | 360 | −0.028em | 1.0 |
| `--type-heading-l` | H2 | `clamp(1.75rem, 1.39rem + 1.62vw, 3rem)` | Archivo (normal width) | 420 | −0.02em | 1.06 |
| `--type-heading-m` | H3 | `clamp(1.375rem, 1.23rem + 0.65vw, 1.875rem)` | Archivo | 480 | −0.012em | 1.16 |
| `--type-heading-s` | H4, card titles | `clamp(1.125rem, 1.09rem + 0.19vw, 1.25rem)` | Archivo | 560 | −0.006em | 1.25 |
| `--type-lead` | Intro paragraphs | `clamp(1.125rem, 0.99rem + 0.56vw, 1.5rem)` | Archivo | 360 | −0.006em | 1.42 |
| `--type-body` | Body copy | `clamp(1rem, 0.98rem + 0.09vw, 1.0625rem)` | Archivo | 400 | 0 | 1.6 |
| `--type-body-s` | Secondary copy, captions | `0.9375rem` | Archivo | 400 | 0.002em | 1.55 |
| `--type-ui` | Navigation, buttons, inputs | `0.9375rem` | Archivo | 500 | 0.004em | 1.3 |
| `--type-label` | Instrument labels (UPPERCASE) | `0.75rem` | DM Mono | 400 | 0.14em | 1.3 |
| `--type-data` | Tables, IDs, timestamps (portals) | `0.8125rem` | DM Mono | 400 | 0.02em | 1.45 |
| `--type-quote` | Pull quotes | `clamp(1.625rem, 1.25rem + 1.67vw, 2.75rem)` | Newsreader Italic | 380 | −0.012em | 1.18 |

Rules:

- **Italic emphasis.** Newsreader Italic replaces exactly **one word or short phrase** in a
  display or heading line, at the same size, optically matched with `font-size-adjust`. At most
  once per screen.
- **Reading widths:**
  - body `max-width: 64ch`;
  - lead `52ch`;
  - captions `48ch`;
  - display lines are set by hand (`text-wrap: balance`), never full-bleed paragraphs.
- **Minimum text size is 12 px** (labels). Nothing smaller, including legal and footer text.
- **Weight discipline:**
  - display 300–360;
  - headings 420–560;
  - body 400;
  - UI 500;
  - nothing above 600 on the public site.
  - Emphasis comes from scale, width and italic, not heaviness.
- **Numerals:**
  - `font-variant-numeric: tabular-nums` in tables, indices and status;
  - proportional numerals in prose.
- **Case:** sentence case for headings, navigation and buttons. UPPERCASE only for DM Mono labels.
- **Two widths only:** semi-expanded for the three display styles, normal for everything else.
  One expanded cut keeps the system simple and maps one-to-one onto a commercial family's
  Extended/Breit cut (§2.7).

### 2.3 Hierarchy by context

| Context | h1 | h2 | h3 | Body | Labels |
|---|---|---|---|---|---|
| Home stations | display-xl (one per station) | display-l | heading-m | lead / body | label |
| Marketing pages (services, work, story, partners, careers) | display-l | heading-l | heading-m | body | label |
| Case study | display-l | heading-l | heading-m | body + quote | label + data |
| Legal pages (Mist theme) | display-m | heading-l | heading-s | body | label |
| Auth pages | heading-l | — | — | body | label |
| Portals | heading-l (page) | heading-m | heading-s | body-s / body | label + data |

### 2.4 Navigation typography

- **Desktop nav:** `--type-ui`, sentence case, 32 px between items.
- **Mobile menu items:** `--type-display-m` (Archivo semi-expanded), each preceded by a DM Mono index
  (`01`–`05`).
- **Footer nav:** `--type-body-s`.

### 2.5 Labels

A DM Mono label is always paired with something it describes (a section, a field, a value).

- **Pattern:** `INDEX — NAME`, for example `03 — WORK`.
- **Where:**
  - above sections;
  - on project metadata (`2026 · WEBSITES`);
  - on status (`OPERATIONAL`);
  - on form sections (`01 — ABOUT YOU`).

### 2.6 Links in text

Always underlined:

- `text-decoration-thickness: 1px`, `text-underline-offset: 0.22em`;
- **hover:** thickness 2 px, colour `--color-accent`.

Never rely on colour alone.

### 2.7 Commercial upgrade path (D10)

If you licence commercial faces, only the `--font-*` variables change. Candidates of the same
character:

- **display/UI:** an expanded + regular grotesk family, e.g. *Monument Grotesk* or *Söhne* (+
  *Breit*);
- **italic:** *Signifier* or *GT Alpina Italic*;
- **mono:** *Söhne Mono* or *ABC Diatype Mono*.

These are candidates only; nothing is bought without your decision.

---

## 3. Colour system

### 3.1 Palette

The neutrals are shifted slightly cool and green-grey (stone, mist, water) so VORA reads mineral,
never cream. That keeps it clearly apart from Solara's Paper Cream / Solar Gold. The accent ramp
is sampled from the eye/star mark's gradient (`00-DISCOVERY.md` §3).

**Basalt → Mist (neutrals)**

| Token | Hex | Main use |
|---|---|---|
| `--basalt-950` | `#0A0C0B` | Public page background (Basalt) |
| `--basalt-900` | `#111413` | Surfaces (footer, form fields, menu) |
| `--basalt-850` | `#171B1A` | Raised surfaces, hover wells |
| `--basalt-800` | `#1F2423` | Pressed wells, dividers on raised |
| `--basalt-700` | `#2E3432` | Disabled fills on dark |
| `--basalt-600` | `#454C4A` | — |
| `--basalt-500` | `#646B68` | Placeholder/disabled text on light |
| `--basalt-400` | `#88908D` | Muted text on dark (6.0:1) |
| `--basalt-300` | `#AEB5B2` | Secondary text on dark (9.4:1) |
| `--basalt-200` | `#D0D6D3` | Pressed primary button |
| `--basalt-100` | `#E6EAE8` | Primary text on dark (16.2:1), primary button |
| `--basalt-50` | `#F2F4F3` | Light-chapter background (Mist) |
| `--white` | `#FFFFFF` | Portal surfaces only |

**Lagoon (accent — from the mark)**

| Token | Hex | Main use |
|---|---|---|
| `--lagoon-100` | `#C7EEC4` | Rare highlight in imagery grading |
| `--lagoon-200` | `#A4E1AF` | Accent text on dark when larger than 18 px (13.1:1) |
| `--lagoon-300` | `#80D0A8` | **UI accent on dark:** focus ring, active marks, progress (10.8:1) |
| `--lagoon-400` | `#59BBA1` | Environment light, charts |
| `--lagoon-500` | `#479E93` | Jade — imagery and film grading, large display accents only |
| `--lagoon-600` | `#33747A` | Deep teal — environment shadows |
| `--lagoon-700` | `#2F6E73` | Accent on light for large text (5.3:1 on Mist) |
| `--lagoon-800` | `#235A5E` | **UI accent on light:** focus ring, links (7.1:1 on Mist) |
| `--dusk-600` | `#3D3964` | Indigo from the mark — only in environment light and film, never in UI |

**Status**

| Token | On dark | On light |
|---|---|---|
| `--danger` | `#FF8A7A` (8.6:1) | `#B3261E` (6.5:1 on white, 5.9:1 on Mist) |
| `--success` | `#9FD8B0` (12.1:1) | `#1E6B3A` (6.5:1 on white, 5.9:1 on Mist) |
| `--warning` | `#F0CF8A` (13.1:1) | `#7A5600` (6.6:1 on white, 6.0:1 on Mist) |
| `--info` | lagoon-300 | lagoon-800 |

All contrast figures were calculated with the WCAG 2.x formula against the stated backgrounds
(dark = `#0A0C0B`, light = `#F2F4F3` unless noted).

### 3.2 Semantic roles

| Role | Dark (public, default) | Light (Mist chapters, legal, workspace) |
|---|---|---|
| `--color-bg` | basalt-950 | basalt-50 (workspace: basalt-50) |
| `--color-surface` | basalt-900 | white |
| `--color-surface-raised` | basalt-850 | white |
| `--color-well` (hover/pressed backgrounds) | basalt-800 | `#E6EAE8` |
| `--color-text` | basalt-100 | basalt-950 |
| `--color-text-secondary` | basalt-300 | `#3A413E` (9.5:1) |
| `--color-text-muted` | basalt-400 | `#5A625F` (5.7:1) |
| `--color-line` (decorative hairline) | basalt-100 @ 14 % | basalt-950 @ 12 % |
| `--color-line-strong` (emphasised divider) | basalt-100 @ 32 % | basalt-950 @ 28 % |
| `--color-line-control` (field and control boundaries, ≥ 3:1) | basalt-100 @ 40 % (3.3:1) | basalt-950 @ 52 % (3.9:1) |
| `--color-accent` | lagoon-300 | lagoon-800 |
| `--color-focus` | lagoon-300 (10.8:1) | lagoon-800 (7.1:1) |
| `--color-action-bg` / `--color-action-text` | basalt-100 / basalt-950 | basalt-950 / basalt-50 |
| `--color-action-bg-hover` | white | `#1F2423` |
| `--color-danger` / `--color-success` / `--color-warning` | dark values above | light values above |
| `--color-scrim` (text over imagery) | basalt-950 @ 0 → 72 % gradient | — |

### 3.3 Rules

- **Accent budget:** lagoon covers **under about 5 % of any screen**. It marks:
  - state (active, focus, selected, progress);
  - the survey line when it is "live";
  - one highlight per image grade.
  - It is never a background block, never gradient text, never a glow.
- **Gradients exist only as light:**
  - in photography, film and the 3D environment;
  - scrims for legibility over images.
  - No decorative UI gradients, no mesh blobs.
- **Text over imagery** always has a scrim or a dark area in the plate. Contrast is checked
  against the brightest pixel behind the text (§13).
- **Hover states** change luminance or line, not hue:
  - secondary text → primary text;
  - line → line-strong;
  - primary button → white;
  - the accent appears only for active/focus.
- **Light/dark usage:**
  - **public:** dark by default, with Mist chapters for inversions (Reflection station,
    Partners, legal pages);
  - **workspace (portals, admin):** light by default (existing `data-theme="workspace"`), with a
    dark workspace theme optional later;
  - **auth pages:** dark;
  - **emails:** light.
- The OS `prefers-color-scheme` **does not flip the public site.** Its darkness is art direction.
  The workspace may follow it later, as an opt-in.

---

## 4. Layout and grid

### 4.1 Widths and gutters

| Token | Value | Use |
|---|---|---|
| `--page-margin` | `clamp(1.25rem, 0.53rem + 3.2vw, 3.5rem)` | Outer margin (20 px at 360 → 56 px at 1440+) |
| `--grid-gap` | `clamp(1rem, 0.72rem + 1.25vw, 1.75rem)` | Column gap |
| `--container` | `88rem` (1408 px) | Standard content width (existing token) |
| `--container-wide` | `110rem` (1760 px) | Media-led chapters on large screens |
| `--measure` | `64ch` | Body text |
| `--container-form` | `40rem` | Enquiry form column |
| `--container-auth` | `26rem` | Sign-in and account forms |

Full-bleed media ignores the container. Text never does.

### 4.2 Grid

| Breakpoint | Columns | Typical placements |
|---|---|---|
| Mobile `< 768 px` | 4 | Full (1–4); inset (1–4 with extra margin); media can break out to the viewport edge |
| Tablet `768–1023 px` | 8 | Text 1–6; media 3–8; paired 1–4 / 5–8 |
| Laptop `1024–1439 px` | 12 | Text 1–6 or 2–7; media 6–12; wide 2–11 |
| Desktop `≥ 1440 px` | 12 (within `--container`) | As laptop, with more air; media may use `--container-wide` |

Composition rules:

- **Asymmetry is the default:**
  - text column left (2–7) with media offset right (7–12);
  - then mirror it on the next shot.
- **Centred text** only for single-line statements (the hero, the invitation).
- **One strong alignment per shot.** A hairline or a label shares the text's left edge.
- **Overlap** (media under a headline, a label crossing a frame) is allowed on laptop and desktop
  where it adds depth. It never overlaps body copy.

### 4.3 Spacing scale (4 px base)

| Token | px | Token | px |
|---|---|---|---|
| `--space-1` | 4 | `--space-7` | 48 |
| `--space-2` | 8 | `--space-8` | 64 |
| `--space-3` | 12 | `--space-9` | 96 |
| `--space-4` | 16 | `--space-10` | 128 |
| `--space-5` | 24 | `--space-11` | 176 |
| `--space-6` | 32 | `--space-12` | 240 |

(`--space-1`…`--space-10` already exist; 11–12 are added.) Components use only the scale. Any
one-off value is a bug.

### 4.4 Section spacing

| Token | Value | Use |
|---|---|---|
| `--section-s` | `clamp(4rem, 2.94rem + 4.72vw, 7rem)` | Between related blocks |
| `--section-m` | `clamp(6rem, 4.25rem + 7.78vw, 11rem)` | Between sections |
| `--section-l` | `clamp(8rem, 5.17rem + 12.6vw, 16rem)` | Before and after chapter inversions and invitations |
| `--station-h` | `100svh` (min 36rem) | Home stations (pinned shots) |

### 4.5 Shape, borders, depth

- **Radius:**
  - 0 for media, sections and apertures;
  - 2 px (`--radius-s`, existing) for controls: buttons, inputs, tags;
  - nothing rounder;
  - no pills; circles only where the circle *is* the meaning: radio buttons (instantly
    recognisable) and avatar images (not used today).
- **Borders:** 1 px hairlines only (§3.2 line roles). No double borders; no border plus shadow.
- **Elevation:**
  - **public site:** no shadows. Depth comes from light, overlap and scale;
  - **portals:** one elevation, for popovers and menus only: `0 8px 24px rgb(10 12 11 / 0.14)`.
- **Grain:** a very fine, static film grain (≤ 3 % opacity) may sit on full-bleed plates only.
  It is never animated over text.

---

## 5. Navigation

The navigation is a quiet instrument panel: small type, hairlines and one accent tick. It never
competes with the shot behind it.

### 5.1 Structure (from `app/routes/public/_layout.tsx`)

| Slot | Content | Notes |
|---|---|---|
| Skip link | "Skip to content" → `#main` | Exists; first focusable element; visible on focus |
| Brand | Wordmark (`Logo`) → `/` | Eye/star mark added only if D5 confirms it |
| Primary | Work · Services · Our Story · Partners · Careers | The existing `NAV` array, order unchanged |
| Call to action | **Start a project** → `/contact` | The existing link, styled as the header button (§6.3) |

No mega-menu and no dropdowns: five destinations don't need them. The four service pages are
reached from Services, not from a hover menu.

### 5.2 Desktop header (≥ 1024 px)

- **Height:** `--header-h: 72px`, aligned to the page margins and the grid.
- **Layout:**
  - brand at column 1;
  - primary items right-aligned, 32 px apart;
  - the CTA 40 px after the last item;
  - everything on one baseline.
- **States:**

| State | When | Treatment |
|---|---|---|
| Over the opening shot | At the top of a page whose first shot is a full-bleed plate | Transparent; text `basalt-100`; a 0 → 40 % top scrim on the plate keeps contrast ≥ 4.5:1 on the brightest frame |
| Resting | At the top of any other page | `--color-bg`, no line |
| Scrolled | After one header height | `basalt-950` at 92 %, 1 px `--color-line` bottom border. **No backdrop blur.** |
| Hidden | Scrolling down, beyond two header heights | Slides up (`translateY(-100%)`, 320 ms `--ease-out`) |
| Revealed | Any upward scroll of 8 px or more, focus inside the header, or the menu open | Slides back in (320 ms) |
| Over a Mist chapter | The section under the header has `data-theme="mist"` | Switches to the light roles over 320 ms (colour and line only) |

- **Item hover** (fine pointers only): a 1 px underline in the text colour draws left → right
  (320 ms, `--ease-out`) and retracts to the right on leave.
- **Current section:**
  - a 12 × 2 px `lagoon-300` tick under the first letters of the label, plus
    `aria-current="page"`;
  - the parent item keeps the tick on child pages (a project marks **Work**); React Router's
    `NavLink` already does this.
- **Focus:** the global focus ring (§6.1), never removed.
- **CTA:**
  - the compact hairline button (§6.3);
  - on `/contact` it keeps its place (no layout shift), loses its arrow and carries
    `aria-current="page"`.

### 5.3 Tablet and mobile header (< 1024 px)

- **Height:** 64 px from 768 px; 60 px below.
- **Layout:**
  - brand left;
  - a text button **Menu** / **Close** right: a 44 × 44 px minimum target with `aria-expanded`
    and `aria-controls`. Text, not a hamburger icon — it is clearer and more in character;
  - from 600 px, the compact **Start a project** button also sits beside Menu. Below 600 px
    it lives in the menu and in each page's closing invitation.
- The scroll states match desktop.

### 5.4 Menu overlay

- **What it is:** a full-screen `basalt-950` layer (`role="dialog"`, `aria-modal="true"`, labelled
  "Menu").
- **Content, top to bottom:**
  1. the header row (brand and **Close**);
  2. the five destinations at `--type-display-m`, each preceded by a DM Mono index `01`–`05`,
     with hairlines between;
  3. **Start a project** as a full-width primary button;
  4. contact emails (the general and projects addresses from settings) and the social links
     (the `social_links` table: X and Discord today);
  5. one small line: Status · Terms · Privacy · Cookies · Sign in (or Account).
- **Open:**
  - the layer uncovers from the top (`clip-path: inset(0 0 100% 0)` → `inset(0)`, 560 ms
    `--ease-out`);
  - items rise through line masks with a 40 ms stagger, starting at 120 ms;
  - the whole gesture takes ≤ 800 ms, and items are usable at once — nothing waits for the
    animation.
- **Close:** 320 ms reverse, no stagger. Choosing a destination closes the menu as the page
  transition starts.
- **Behaviour:**
  - focus moves to the first item and is trapped inside the dialog;
  - `Esc` closes;
  - focus returns to the Menu button;
  - the page behind is `inert` and scroll-locked (Lenis `stop()`).
- **Progressive enhancement:** it is server-rendered as today's `<details>`/`<summary>`, so the
  menu works without JavaScript; the enhanced dialog takes over after hydration.
- **Reduced motion:** a 120 ms opacity fade only.

### 5.5 The header during page transitions

The header sits outside the transition. It has its own `view-transition-name`, so it stays still
while pages change (§8.3). Navigations slower than 150 ms show the survey-line progress along the
header's bottom edge (§8.8).

### 5.6 Footer

- **Surface:**
  - `--color-surface` (basalt-900) with a 1 px top line;
  - `--section-s` top padding.
- **Content** (existing data, re-composed):

| Columns (12-col) | Group |
|---|---|
| 1–4 | Wordmark, plus the partner line from settings ("Creative by Solara. Digital by VORA.") |
| 5–6 | Site: the five destinations and Contact |
| 7–9 | Contact: the general and projects email addresses, plus the social links (open in a new tab, announced) |
| 10–12 | Legal and system: Privacy · Terms · Cookies · Status · Sign in / Account, plus the **Motion** toggle (§8.10) |

- **Base row:** `© {year} VORA` as a label (existing).
- **Not included:** no back-to-top rocket, no newsletter box (no such feature exists) and no
  giant cropped wordmark (an R2 signature, excluded).
- **Mobile:** stacked groups divided by hairlines; the Motion toggle stays visible.

Portal navigation is a sidebar, not this header (§11).

---

## 6. Buttons, links and interaction states

### 6.1 Global interaction rules

- **Focus ring:**
  - `outline: 2px solid var(--color-focus); outline-offset: 3px` on `:focus-visible`;
  - never removed, never replaced by colour alone;
  - on imagery it keeps a 1 px `basalt-950` halo (`box-shadow`) so it survives bright frames.
- **Targets:** at least 44 × 44 px for anything tappable. Inline text links are exempt (WCAG 2.2
  2.5.8), but keep them well spaced.
- **Hover** is an enhancement for `(hover: hover) and (pointer: fine)`. Touch never gets
  stuck-hover states.
- **Pressed:** 1 px down (`translateY(1px)`) plus a darker fill — immediate, 0 ms in and 120 ms
  out.
- **Duration:** feedback ≤ 200 ms (§8.1). Nothing bounces, glows, ripples or follows the cursor
  ("magnetic").
- **Cursor:** the system cursor, always (`01-ARCHITECTURE.md` §11 — no custom cursor).

### 6.2 Button hierarchy

| Variant | Use | Default (dark) | Hover | Pressed |
|---|---|---|---|---|
| **Primary** | The one main action on a screen: Start a project, Send enquiry, Sign in, Save | `basalt-100` fill, `basalt-950` text, trailing arrow | Fill → white; arrow moves 4 px right (200 ms) | `basalt-200` fill, 1 px down |
| **Secondary** | Alternatives: See the work, Cancel, Download | Transparent, 1 px `--color-line-control` border, `--color-text` | Border → `--color-text` | `--color-well` fill, 1 px down |
| **Quiet (text)** | Low-emphasis actions in rows, tables and toolbars | Text only, underline on hover | 1 px underline draws in | Text → `--color-text-secondary` |
| **Danger** (portals only) | Irreversible actions, always confirmed in a dialog | Light theme: `#B3261E` fill, white text | Darkens by 8 % | 1 px down |

On light themes (Mist, workspace), primary becomes `basalt-950` fill with `basalt-50` text, and
hover moves to `#1F2423`.

**Sizes:**

| Size | Height | Padding | Type | Where |
|---|---|---|---|---|
| `s` | 40 px (44 px hit area via padding) | 0 16 px | `--type-ui` | Header CTA, portal toolbars |
| `m` (default) | 48 px | 0 24 px | `--type-ui` | Forms, content |
| `l` | 56 px | 0 32 px | `--type-ui` at 1.0625rem | The closing invitation on each page |

**Shape:**

- radius 2 px (`--radius-s`);
- no pills, no gradient fills or borders, no drop shadows;
- icon at 16 px with a 1.5 px stroke; label-to-icon gap 12 px.

### 6.3 States every control implements

| State | Treatment |
|---|---|
| Focus | Global ring (§6.1) |
| Disabled | `aria-disabled="true"` (the control stays focusable and can explain why); `basalt-700` fill and `basalt-400` text on dark (light: `#E6EAE8` and `basalt-500`); no hover or arrow motion. The reason sits next to it as text. The native `disabled` attribute is used only where the value must not submit. |
| Loading | The label stays in place and the width is locked, so nothing jumps. The arrow gives way to a 1 px survey line sweeping the bottom edge (1.2 s linear loop). Set `aria-busy="true"`; the label changes to a progress word ("Sending…" — existing copy); repeat submits are ignored. **Reduced motion:** static label, no sweep. |
| Success | Never shown on the button itself: the result replaces the form or appears as a message (§7.14). |
| Error | Never shown as a red button: the message sits by the field or in the error summary (§7.11). |

**The header CTA (compact secondary):**

- `s` size; label "Start a project" with an arrow;
- hover: the border goes to full `--color-text` and the arrow moves 4 px;
- over a full-bleed plate it keeps a `basalt-950` at 40 % fill for legibility.

### 6.4 Links

- **In running text:** always underlined (§2.6).
- **Arrow links** ("See the work →"):
  - `--type-ui`, with the underline drawn on hover;
  - the arrow moves 4 px;
  - used for secondary navigation inside sections.
- **External links:**
  - a north-east arrow (↗) instead of →;
  - `rel="noopener noreferrer"`;
  - when a link opens a new tab, a visually hidden "(opens in a new tab)" — the existing pattern.
- **Back links:** a label above the title, e.g. `CAREERS` preceded by a left-arrow icon (the
  pattern exists on role pages).
- **Block links** (a whole project tile):
  - one real `<a>` on the title, stretched over the tile with a pseudo-element;
  - no nested interactive elements;
  - the focus ring wraps the whole tile.

### 6.5 Icon buttons

- 44 × 44 px target around a 20 px, 1.5 px-stroke icon.
- An accessible name is required (`aria-label` or visually hidden text).
- Hover: `--color-well` fill.
- Used in portals, the lightbox and video controls. No icon-only buttons in public navigation.

### 6.6 Micro-interactions (the complete list)

The only micro-interactions are:

- the arrow nudge;
- the underline draw;
- the 1 px press;
- the survey-line loading sweep;
- the checkbox tick drawing in (120 ms);
- the focus ring appearing instantly.

Anything else needs a reason tied to meaning (§8).

---

## 7. Components

The components separate content with **space and hairlines, not boxes**. The public site has no
"card" component: no rounded, bordered or shadowed tiles in grids. Portals may group data in flat
panels (§11).

### 7.1 Section header

- **Structure:**
  - a label (`02 — SERVICES`);
  - a title (display-l or heading-l);
  - an optional lead (≤ 52ch);
  - an optional arrow link.
- **Layout:** the label shares the title's left edge. On desktop the label may sit in the left
  columns (1–3) with the title at 4–11 — the "margin label" editorial layout.
- **Rule:** section indexes count only sections that exist on that page. Never pad the numbering.

### 7.2 Project components

The content model provides:

- `title`, `category`, `summary`, `year`, `clientName`, `externalUrl`, `credits` and `body`
  blocks;
- `coverMediaId` (with alt text, dimensions and focal point);
- `isFeatured`.

Today's seeded, real projects are **SAIL Gaming** (Esports) and **EON Clothing** (Commerce), both
drafts.

| Component | Layout | Content | Hover / motion |
|---|---|---|---|
| **ProjectFeature** (Home Chambers, top of Work) | Full-bleed or `--container-wide` aperture at 21:9 (mobile 4:5), title at display-l overlapping the bottom-left of the frame over a bottom scrim (Basalt only; in a Mist chapter the title sits below the frame), index `01 / 02` | Cover media, title, `CATEGORY · YEAR`, summary (≤ 2 lines), arrow link | Aperture opens on entry (§8.6); image drifts inside the frame with scroll (≤ 8 %) |
| **ProjectTile** (Work index) | Aperture at 4:5 or 3:2, alternating and offset vertically in a two-column rhythm (not a uniform grid); text below | Label `CATEGORY · YEAR`, title (heading-m), summary (one line on desktop) | Fine pointers: image settles from 1.04 to 1.0 scale inside a still frame; the title underline draws |
| **ProjectRow** (text index, ≥ 6 projects) | Hairline rows: index · title · category · year · → | Text only | Row well on hover; a small aperture preview may follow the row (not the cursor) on desktop |
| **ProjectFacts** (case study) | DM Mono definition list across the grid: Client · Year · Category · Services · Website ↗ | Real fields only; empty fields are omitted, never "—" | None |
| **Credits** | Two-column list: role (label) · name | `credits` JSON | None |
| **NextProject** | Full-width aperture strip leading to the next published project | Title and category | Aperture opens as it enters; the whole strip is one link |

**Rules:**

- **Two projects is the current reality.** Below four published projects, Work uses a *sequence*
  of ProjectFeatures — one per shot — never a half-empty grid.
- **No filters until they mean something:** at least 6 projects and at least 2 categories.
- **Every project needs a real cover** before it can be featured. Without one, the tile shows a
  typographic plate (title at display-m on basalt-900) — never a stock image.

### 7.3 Case-study body blocks (`shared/content/blocks.ts`)

| Block | Rendering |
|---|---|
| `paragraph` | Body at `--measure`, grid columns 3–8 (desktop) |
| `heading` | Levels 2–4 → heading-l / heading-m / heading-s, with a label index if the page uses them |
| `list` | Hairline-separated items for ≤ 6 short items (e.g. the six process steps); normal list otherwise |
| `quote` | QuoteBlock (§7.6) |
| `image` | Aperture figure; caption in `--type-body-s` + optional label; width from the block, one of full-bleed / wide / text column |
| `gallery` | 2–3 apertures in an asymmetric pairing (e.g. 7 + 5 columns), with aligned tops or a deliberate offset |
| `video` | VideoPlate (§9.4) |
| `embed` | Click-to-load frame with a poster and the provider name (no third-party requests until chosen) |
| `divider` | A survey line that draws across the grid on entry |

### 7.4 Service components

The four services are Websites, Branding, Motion and Film, each with a delivery model and a
partner (the `services` table).

- **ServiceRow** (Services index):
  - one full-width row per service between hairlines:
    - index `01`;
    - name at display-m;
    - summary (the seeded one-liner);
    - delivery label (below);
    - arrow;
  - **hover** (fine pointers): the row's hairline turns `--color-line-strong`, and an aperture
    opens at columns 9–12 showing that service's real image, if the CMS has one. No image means
    no window.
  - **Touch:** the row is a plain link.
- **Delivery label** (from `deliveryModel`):
  - `vora` → `DELIVERED BY VORA`;
  - `partner` → `CREATIVE BY SOLARA STUDIOS · DIGITAL BY VORA`;
  - `joint` → `VORA × SOLARA STUDIOS`.

  It states who does the work, exactly as decision C2 requires.
- **ServiceHero:** the service name at display-l, the summary as the lead, the delivery label,
  and one real plate or film (or a typographic plate until media exists).
- **Process:**
  - the six real steps — Discover, Define, Design, Develop, Refine, Launch;
  - shown as a horizontal survey line with six ticks on desktop (a vertical line on mobile);
  - each step's text appears as its tick is reached;
  - no invented durations.

### 7.5 PartnerBlock (Partners page, Mist chapter)

- **Statement:** "Creative by Solara. Digital by VORA." at display-l, set as two lines. It is
  the existing seeded statement; italic is allowed on one word.
- **Partner entry:**
  - name (heading-l);
  - relationship label (`CREATIVE PARTNER`);
  - description (seeded: "A creative studio focused on design and visual work.");
  - a link out only if a verified URL is supplied (Solara's domain does not resolve today).
- **Principles:** "Clear roles / One experience / Shared standards" (real, from Mark4). Show them
  as three hairline-separated columns with label indices. Body copy for each is a *slot*.
- **Rule:** no Solara colours, type or imagery inside VORA's system. The partnership is shown in
  VORA's language.

### 7.6 QuoteBlock (and testimonials — D13, switched off)

- **Layout:**
  - Newsreader Italic at `--type-quote`, hung punctuation, ≤ 32ch per line;
  - attribution as a label: `NAME — ROLE, ORGANISATION`.
- **Allowed now:** quotes from a real person's own statement, e.g. the founder line from Mark4,
  "Don't wait for the future. Build it." — Strive, Founder (subject to your review of the Our
  Story draft).
- **Testimonials:**
  - the pattern exists but is off until each quote is confirmed as real, attributable and
    approved (conflict C5);
  - no carousels;
  - at most one testimonial per page, placed next to the project it concerns.

### 7.7 Journal entry (proposal only — no route or content type exists)

A journal is not built. §10.3 explains what adding one would take. If you approve it, the
component is:

- a hairline row with the date (`--type-data`), title (heading-m), a one-line standfirst and a
  category label;
- or, for a lead article, a 3:2 aperture with the title below.

No cards, no author avatars, no "5 min read" chips unless you want reading time.

### 7.8 Careers components

The content model provides the role title, summary, body, `employmentType`, `locationType`,
`locationText` and `applicationMode` (form / email / external). The seeded, draft roles are Web
Designer, UI/UX Designer, Motion Designer and Developer. The Mark4 values are Craft, Taste and
Reliability.

- **CareerRow:**
  - hairline row: title (heading-m) · `REMOTE`/`HYBRID`/`ONSITE` · employment type · location
    text · →;
  - the whole row is one link.
- **Role page:**
  - title at display-m;
  - facts row (label + data);
  - body at `--measure`;
  - "How to apply", matching `applicationMode`:
    - an external link ↗;
    - an email link (existing);
    - or the application form once it ships (Phase 4/5).
- **Empty state:** "There are no open roles right now." plus the careers email for speculative
  applications. It shows when no role is published — never fake roles.
- **Application form** (when built): the same form system as the enquiry form (§7.10). The file
  input is for a CV sent to private storage, with a hint about size and type.

### 7.9 The closing invitation ("Horizon")

- **What it is:** the last shot of each marketing page, and the page's resolved moment.
  - a label (`NEXT — START A PROJECT`);
  - one sentence at display-l (**copy is a slot per page**, written for that page's context);
  - the primary `l` button **Start a project**;
  - the projects email as a secondary text link.
- **Layout:**
  - on Home, it's the Horizon station (§16.1);
  - elsewhere, a `--section-l` block;
  - optionally over a real landscape plate.
- **It must differ per page:** its sentence and composition change, never the identical band on
  every page (§1.3 principle 6).

### 7.10 Enquiry form (the real fields, grouped)

The form has one column (`--container-form`), sections labelled with instrument labels, and
submits once. Labels and hints are the existing copy.

| Section | Fields (existing names) |
|---|---|
| `01 — ABOUT YOU` | Your name* · Email* · Company or organisation · Current website |
| `02 — THE PROJECT` | What do you need?* (checkboxes: Website or digital platform / Branding / Motion / Film / Not sure yet) · About the project* (≤ 5,000 characters, with a counter) |
| `03 — BUDGET AND TIMING` | Budget (**shown only once you approve budget ranges** — C9) · Timeline* (radios, from settings) · Target date (enabled when "By a specific date" is chosen) |
| `04 — FINALLY` | How did you hear about VORA? · Details · Consent* (with the privacy link) |
| — | Turnstile (labelled "Security check"; `theme: auto` matched to the dark form) · **Send enquiry** |

- **Success:**
  - the form is replaced in place by the existing "Enquiry received / Thank you." state with
    the reference (in DM Mono);
  - focus moves to the heading;
  - a survey line draws under the reference — the only celebration.
- **Hidden spam trap:** the existing hidden field stays visually hidden and out of the tab
  order.
- **Mobile:** the same order; the sections become shots divided by hairlines; the submit stays
  in the flow (not sticky), so it can't cover fields.

### 7.11 Form controls

| Control | Spec |
|---|---|
| Text input / email / url / date | 48 px high; `--color-surface` fill; 1 px `--color-line-control` border (≥ 3:1); radius 2 px; text `--type-body`; 16 px inside padding; label above (`--type-ui`), hint below (`--type-body-s`, secondary text). **Never placeholder-only labels.** |
| Textarea | Min 6 rows; vertical resize; character counter in DM Mono (`0 / 5000`) announced politely near the limit only |
| Select | Native `<select>` (accessible, platform pickers on mobile) with `appearance: none` and a 1.5 px chevron |
| Checkbox | 20 px square, 1 px control border, 2 px radius; checked: `basalt-100` fill with a `basalt-950` tick drawing in (120 ms); the label is the click target; a group uses `fieldset`/`legend` |
| Radio | 20 px circle (the one sanctioned circle, §4.5); checked: 8 px inner dot |
| File input (portal uploads, the future CV) | A secondary button "Choose file" + selected file name + size; upload progress as a survey line; accepted types and max size stated in the hint |
| Turnstile | Sits above the submit button with its label; a no-JS fallback message exists and is kept |

**States:**

| State | Treatment |
|---|---|
| Hover | Border → `--color-line-strong` |
| Focus | Global ring plus border → `--color-text` |
| Invalid | Border → `--color-danger`; message below with a 16 px icon and the text "Error: …" (never colour alone); `aria-invalid` and `aria-describedby` |
| Disabled / read-only | Well fill, muted text; read-only values stay selectable |
| Autofill | Browser autofill colours overridden to the surface colour, so fields don't flash yellow |

**Error summary:**

- On a failed submit, a summary appears at the top of the form: an `ERROR` label, a count and a
  link to each field. It gets `role="alert"` and focus (the existing behaviour).
- Messages say what to do ("Enter an email address like name@example.com"), not what went wrong
  in the system.

### 7.12 Status indicators, tags and badges

- **Pattern:** an 8 px square in the status colour, plus a DM Mono label. The labels are the
  existing ones: `OPERATIONAL`, `DEGRADED`, `UNAVAILABLE`, `NOT IN USE` on the Status page;
  `RECEIVED`, `QUALIFIED` … for enquiries. Never colour alone, never pills.
- **Content status in portals:** `DRAFT` (muted), `PUBLISHED` (success), `ARCHIVED` (muted,
  struck line), and `CHANGES` (warning) when there are unpublished edits.

### 7.13 Tables (portals, Status page)

- **Rows and header:**
  - hairline rows;
  - header row in `--type-label`, sticky under the portal top bar;
  - numbers right-aligned in DM Mono with tabular numerals.
- **Row states:**
  - row hover `--color-well`;
  - selected row has a 2 px left inset line in `--color-accent` plus `aria-selected`.
- **Mobile (< 768 px):** each row becomes a stacked definition list, with the primary column as
  its heading. No horizontal scrolling for primary data.

### 7.14 Messages (notices, alerts, toasts)

- **Inline notice:** a hairline box in `--color-line-strong` with a status square, a DM Mono label
  (`NOTICE`, `ERROR`, `SAVED`) and a single sentence. No tinted backgrounds on the public site.
- **Maintenance and read-only banners:** full-width, `--color-surface`, one line, a link to
  Status.
- **Toasts** (portals only):
  - bottom-left, one at a time;
  - `aria-live="polite"`;
  - auto-dismiss after 5 s, except errors, which stay until dismissed.

### 7.15 Empty states

One honest sentence and at most one action. For example:

- Work before anything is published: the existing "Case studies are being prepared for
  publication." + "get in touch" link.
- Careers with no open roles: see §7.8.
- Admin enquiries with no enquiries: "No enquiries yet."

No illustrations of empty boxes, no mascots.

---

## 8. Motion system

Motion is part of the art direction: it is **the camera, the light and the craftsman's hand**. It
reveals hierarchy, gives feedback, creates continuity between pages and sets atmosphere — and it
does nothing else. It is slow and weighted where it tells the story, and instant where the
visitor is trying to do something.

### 8.1 Rules

1. **Content never waits for motion.** Text is in the HTML and readable at first paint. Every
   animation starts from a state that is already legible or finishes in under 900 ms.
2. **One gesture per shot.** A shot reveals its headline *or* opens its aperture *or* draws its
   line as the lead gesture; anything else is a quiet follower.
3. **Entrances ease out, exits ease in, and exits are faster** (about 60 % of the entrance).
4. **Nothing bounces, overshoots, wobbles, spins, glows or follows the cursor.**
5. **Reveal once.** Entrance animations don't replay when scrolling back up. Scrubbed sequences
   are reversible by nature.
6. **Motion follows meaning:** things enter along the reading direction (up and left → right),
   and lines draw from their origin.
7. **Animate only `transform`, `opacity` and `clip-path`,** plus colour for state changes.

### 8.2 Tokens

| Token | Value | Use |
|---|---|---|
| `--dur-micro` | 120 ms | Checkbox tick, colour and border changes, exits of micro-feedback |
| `--dur-fast` | 200 ms | Hover, arrow nudge, button feedback, tooltip |
| `--dur-base` | 320 ms | Underline draw, header hide/reveal, menu close, portal transitions |
| `--dur-medium` | 560 ms | Text line reveals, menu open, page transition, label fades |
| `--dur-slow` | 900 ms | Aperture openings, hairline draws, image settle |
| `--dur-cinematic` | 1400 ms | The first shot's title settle, chapter inversions (time-based versions) |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | All entrances and reveals (existing token) |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Camera-like moves, morphs, crossfades (existing token) |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | Exits only |
| (linear) | `ease: "none"` | Scroll-scrubbed sequences and progress |

- **Distances:**
  - UI enters from 12–24 px;
  - text lines rise one full line height inside a mask;
  - images settle from a scale of 1.04–1.08;
  - parallax inside an aperture is ≤ 8 % of the frame height.
- **Stagger:** 40 ms between lines, 60 ms between items, **capped at 320 ms in total** — a list of
  20 never takes a second to appear.
- **Portals:** only `--dur-micro`, `--dur-fast` and `--dur-base`. No reveals.

### 8.3 Page transitions (View Transitions API through React Router's `viewTransition`)

| Transition | Choreography | Duration |
|---|---|---|
| **Default** (any public page → any public page) | The old `main` fades out and lifts 16 px (`--ease-in`). The new page's title lines rise through masks; its first aperture opens 120 ms later. The header and the persistent canvas stay still. | Out 200 ms, in 560 ms; **the new page is interactive at once** |
| **Work → Project** (shared element) | The chosen project's cover aperture morphs into the case-study hero frame (`view-transition-name: project-<slug>`), and the title morphs to the hero title. Everything else crossfades. | 700 ms `--ease-in-out` |
| **Project → Next project** | The NextProject strip expands upwards into the next hero | 700 ms `--ease-in-out` |
| **Nav tick** | The active tick slides from the old item to the new one (`view-transition-name: nav-tick`) | 320 ms `--ease-in-out` |
| **Into or out of the portals, auth or 404** | Plain 120 ms crossfade. Workspace pages never inherit the cinematic transitions. | 120 ms |
| **No View Transitions support** | Instant navigation with a 200 ms opacity fade-in of `main`. Nothing breaks. | 200 ms |

- **Navigating back** restores the scroll position with no replayed entrances.
- **Focus:** after each navigation it moves to the new page's `h1` (announced by React Router's
  route announcer pattern), and the transition never delays that.

### 8.4 Scroll behaviour

- **Smooth scrolling (Lenis):**
  - only on public pages, at tiers T2/T3, for fine pointers (mouse or trackpad);
  - settings: `lerp ≈ 0.1`, no touch smoothing, native momentum on touch devices;
  - off in portals, forms, dialogs and T0;
  - keyboard scrolling, find-in-page, anchor links and the scroll bar keep working.
- **No scroll-jacking:**
  - no forced snapping between stations;
  - no wheel hijacking;
  - no horizontal-scroll traps.
  - Pinned shots are allowed: a sticky stage whose content is scrubbed by normal scrolling, at
    most 150 vh per pin.
- **Entrance reveals** (IntersectionObserver, once, when the element is 15 % in view):

| Element | Reveal |
|---|---|
| Display / heading lines | Rise through line masks (`translateY(100%)` → 0), 900 ms `--ease-out`, 40 ms stagger |
| Labels | Fade in and rise 8 px, 560 ms |
| Body copy | **Not animated** (it's already there — the reader shouldn't wait) or a single 320 ms fade for the whole block |
| Hairlines / survey lines | `scaleX(0)` → 1 from the left, 900 ms `--ease-out` |
| Apertures | `clip-path: inset(10% 0 10% 0)` → `inset(0)`, 900–1200 ms `--ease-out`, while the image inside settles from 1.08 to 1.0 |
| Lists and rows | Each row's hairline draws, then its text fades in, with a 60 ms stagger (capped) |

- **Scrubbed** (GSAP ScrollTrigger, `ease: "none"`):
  - Home station plates (§16.1);
  - the Process line on service pages;
  - parallax inside apertures (≤ 8 %);
  - the Basalt → Mist chapter inversion;
  - the scroll-progress rule on case studies and legal pages (a 1 px `lagoon-300` line at the
    header's bottom edge).
- **Chapter inversion:**
  - the Mist chapter rises behind a horizon line — its `clip-path` opens from a 1 px line to the
    full section over about 40 % of the viewport of scroll;
  - the header adopts the Mist roles as the line passes under it;
  - **T0:** an immediate cut.

### 8.5 Hover and focus (summary of §6)

| Element | Motion |
|---|---|
| Buttons | The arrow moves 4 px (200 ms); fill → white; pressed 1 px |
| Nav items and links | Underline draws (320 ms) |
| Project tiles | The image settles from 1.04 → 1.0 inside a still frame (560 ms); the title underline draws |
| Service rows | The hairline strengthens; the aperture opens (560 ms) if media exists |
| Focus | **Instant** — never animated in |

### 8.6 Image and media transitions

| Case | Treatment |
|---|---|
| Image enters the viewport | The aperture opens (§8.4). The placeholder colour is visible until decode, then the image fades in (320 ms). |
| Gallery image change | Crossfade 560 ms `--ease-in-out`; no sliding carousels |
| Lightbox open / close | The figure morphs from its place to full screen (same-document View Transition, 560 ms `--ease-in-out`); it closes in 320 ms |
| Video in view | The poster crossfades to playback on the first frame (no black flash) |
| Environment plates (Home) | Scrubbed by scroll, as the station sequence dictates (§16.1) |

### 8.7 Navigation transitions

- **Header hide/reveal:** 320 ms (§5.2).
- **Menu open/close:** 560 / 320 ms (§5.4).
- **Nav tick:** slides between items (§8.3).
- **Colour switch over Mist chapters:** 320 ms.

### 8.8 Loading

- **No splash loader and no intro sequence** that holds content back. The references' loaders are
  deliberately not adopted.
- **Home experience assets** (T1–T3):
  - the typographic first shot is complete without them;
  - while the plates and 3D layer stream in, a 1 px survey line along the bottom of the first
    shot fills with **real** loading progress;
  - when the layer is ready, it fades in beneath the typography (900 ms) and the line retracts;
  - failure or a timeout leaves the T0 still shot in place. No fake percentages.
- **Route changes:**
  - nothing for the first 150 ms;
  - after that, the survey line runs along the header's bottom edge (determinate if the loader
    can report progress, a slow indeterminate sweep otherwise);
  - it completes and retracts on arrival.
- **Buttons:** the loading sweep (§6.3).
- **Images:** a dominant-colour placeholder, then a fade on decode (§9.7).
- **Portals:** skeletons are flat `--color-well` blocks at the content's real size with a slow
  opacity pulse (1.6 s). No shimmer gradients. The pulse is off in T0.

### 8.9 Cursor

**No custom cursor, no cursor followers, no magnetic buttons** (`01-ARCHITECTURE.md` §11 and the
old site's custom cursor is on the "remove" list). Standard cursors: `pointer` on links and
buttons, `text` in fields, `zoom-in` on lightbox-able images, `grab` only on draggable surfaces.

### 8.10 Reduced motion (T0) — a first-class version, not a degraded one

- **Triggers:**
  - `prefers-reduced-motion: reduce`;
  - Save-Data;
  - no WebGL2 or low device memory (for the 3D layer only);
  - the footer **Motion: Full / Reduced** toggle.
- **The toggle:**
  - it is stored in a functional preference cookie (`vora_motion`), so the server renders the
    right version with no flash of motion. *This cookie must be listed on the Cookies page.*
  - the setting is also available in account settings for signed-in users.
- **What T0 changes:**

| Everything that… | …becomes |
|---|---|
| Translates, scales or clips on entry | Appears in place (or a ≤ 200 ms opacity fade) |
| Is scrubbed or pinned | Composed still frames per station, crossfading at station boundaries; pins removed (normal document flow) |
| Uses parallax | Static |
| Uses Lenis | Native scrolling |
| Uses View Transitions | A 120 ms crossfade, or none |
| Autoplays or loops (video, environment) | Poster with a play button; no autoplay |
| Uses the loading sweep | A static label ("Sending…") |
| Opens the menu with clip and stagger | A 120 ms fade |

- **What T0 never changes:**
  - content and reading order;
  - focus visibility;
  - pressed, selected and error states;
  - the ability to play a film on request.

### 8.11 Implementation choices (the smallest tool that does the job)

| Need | Tool | Why |
|---|---|---|
| Hover, focus, pressed, colour | CSS transitions + tokens | Zero JavaScript |
| Entrance reveals | A ~1 KB IntersectionObserver helper + CSS classes / Web Animations API | No library for fire-once reveals |
| Page transitions | View Transitions API (React Router `viewTransition`) | Native, progressive |
| Scrubbed and pinned sequences | GSAP 3 + ScrollTrigger, **lazy-loaded only on pages that use them** (Home, case studies, service Process) | Robust scrub, pin and refresh handling |
| Smooth wheel scrolling | Lenis, T2/T3 fine pointers only, sharing GSAP's ticker (one rAF loop) | Weighted camera feel without breaking native behaviour |
| Environment layer | Three.js (§11.2 of the architecture), T2/T3 only | Already decided |
| **Not used** | Framer Motion, Locomotive Scroll, jQuery plugins, particle libraries | Nothing they would add is needed |

**Performance guard-rails:**

- `will-change` only during an animation;
- no layout reads inside animation frames;
- at most three concurrent `clip-path` animations per viewport — if T1 devices drop frames, swap
  to a transform-based mask (a covering panel that translates away);
- loops pause off-screen and in hidden tabs;
- heavy setup waits for `requestIdleCallback`, so INP stays under 200 ms.

---

## 9. Image and media

### 9.1 Aspect ratios

| Ratio | Use |
|---|---|
| **21:9** | ProjectFeature and case-study hero on laptop/desktop; chapter plates |
| **16:9** | Film and video players, embeds, landscape plates on tablet |
| **3:2** | Project tiles (landscape), gallery images, lead journal image (if approved) |
| **4:5** | Project tiles (portrait), mobile features and heroes, service plates on mobile |
| **9:16** | Mobile station plates (Home), vertical film |
| **1.91:1** | Open Graph / social images (generated per page, 1200 × 630) |

There are no other ratios. Square only for avatars (not used).

### 9.2 Cropping and art direction

- **`<picture>` with a source per breakpoint.** Portrait mobile gets its own crop or render
  (architecture §11.2) — never the desktop image squeezed or centre-cropped.
- **Focal point:**
  - media assets store `focalX`/`focalY` (0–1, validated in the schema);
  - every crop uses them (`object-position: calc(var(--fx) * 100%) calc(var(--fy) * 100%)`);
  - editors set them in the media library.
- **Website captures** (VORA's actual work):
  - never cropped through text, logos or UI in a way that misrepresents the site;
  - long pages are shown as tall captures that scroll *inside* an aperture.
- **Mockups:** no fake device mockups (tilted laptops, floating phones). Screens are presented
  flat and full-bleed, like architectural drawings, or as short screen recordings.

### 9.3 Project imagery rules

- **Real work only.** Captures and recordings of the delivered sites (e.g. sailgaming.store,
  eonclothing.store) are used with the client's approval, and their colours are kept accurate.
- **Environment imagery** comes from VORA's own Blender world — not stock and not AI-generated
  imagery presented as client work.
- **Grading:** environment plates and film share one grade (cool mineral shadows, a lagoon
  highlight). Client captures are **not** graded.
- **Alt text** is required before publishing (the existing `missingAltText` check). Decorative
  environment layers use `alt=""` / `aria-hidden`. Captions add context; they never replace alt
  text.

### 9.4 Video (VideoPlate)

- **Ambient loops** (≤ 12 s, no meaning of their own):
  - `muted playsinline loop`, `preload="none"`, with a poster;
  - they play only while ≥ 50 % in view and pause off-screen;
  - no sound;
  - a visible pause control when longer than 5 s (WCAG 2.2.2);
  - **T0:** poster only.
- **Films with meaning** (Film service, case-study films):
  - 16:9 (or 9:16 on mobile when the film is vertical);
  - they never autoplay with sound;
  - controls: play/pause, scrubber, time (DM Mono), mute, captions, fullscreen — keyboard
    operable, 44 px targets;
  - **captions are required** for speech (WebVTT); transcripts for longer films.
- **Formats:** MP4 (H.264) plus AV1/WebM where it saves weight, served from R2 with range
  requests. Mobile loops ≤ 4 MB, desktop loops ≤ 8 MB. Posters in AVIF/WebP.

### 9.5 Hover on media

- **Allowed:** the settle (1.04 → 1.0) inside a still frame, and the title underline.
- **Not allowed:** colour → greyscale flips, tilt/3D card effects, zoom beyond 1.08, or
  play-on-hover with sound.

### 9.6 Fullscreen / lightbox

- **When:** case-study images and galleries are expandable (`cursor: zoom-in`, with a visually
  hidden "Expand image" on the trigger button).
- **The dialog:**
  - a `<dialog>` on a `basalt-950` backdrop at 96 %;
  - the image fitted with `object-fit: contain` at full resolution (loaded on open);
  - caption, an index (`03 / 12`), close, previous and next.
- **Controls:** `Esc` closes; the arrow keys move; swipe on touch; pinch-zoom is never blocked;
  focus is trapped and returned to the trigger.
- **Motion:** the morph from its place (§8.6); a fade in T0.

### 9.7 Loading and delivery

- **No layout shift:** `width`/`height` are always set from the stored media dimensions.
- **Lazy loading:** `loading="lazy"` and `decoding="async"` below the fold.
- **The LCP image:**
  - one image per page gets `fetchpriority="high"` (and a preload of its correct source);
  - nothing else is prioritised.
- **Placeholder:**
  - a dominant-colour fill behind every aperture, then a 320 ms fade on decode;
  - the media table has no colour field yet, so the rebuild adds `dominantColor`, computed on
    upload (schema proposal, not implemented).
- **Responsive sources:**
  - `srcset` widths 480 / 768 / 1080 / 1440 / 1920 / 2560;
  - AVIF → WebP → JPEG;
  - accurate `sizes`;
  - served through Cloudflare Image Transformations on the zone (works with any origin — see the
    Railway plan) or pre-generated derivatives if the free quota (5,000 unique transformations a
    month) is exceeded.
- **Formats:** SVG for the wordmark and icons (inline, `currentColor`); never raster text.

---

## 10. Public site structure

**Source of truth:** `app/routes.ts` and the seeded content (`app/.server/db/seed/definitions.ts`).
Every page listed as existing below is already routed in the code (mostly as Phase 1 shells).
The design rebuild changes presentation, not the route map.

### 10.1 Site map

```
/                         Home (stations)
├── /work                 Work index
│   └── /work/:slug       Case study          (seeded drafts: sail-gaming, eon-clothing)
├── /services             Services index
│   └── /services/:slug   Service page        (seeded: websites, branding, motion, film)
├── /our-story            Our Story           (CMS page "our-story", draft)
├── /partners             Partners            (seeded partner: Solara Studios)
├── /careers              Careers index
│   └── /careers/:slug    Role page           (seeded drafts: web-designer, ui-ux-designer,
│                                              motion-designer, developer)
├── /contact              Start a project (enquiry form)
├── /terms · /privacy · /cookies   Legal (CMS pages, drafts)
└── /status               Service status
System: /login … /setup (auth), /account, /admin, /client, /member (portals),
        404 (catch-all route), error boundary, kernel maintenance/unavailable pages,
        /sitemap.xml, /robots.txt. Legacy Mark4 URLs 301 in the kernel (D11).
```

### 10.2 The requested pages mapped to the code

| Requested page | Route | In the code? | Theme | Notes |
|---|---|---|---|---|
| Home | `/` | Yes (placeholder) | Basalt + one Mist chapter | Station sequence, §16.1 |
| Work / Projects | `/work` | Yes | Basalt | §16.2 |
| Individual project | `/work/:slug` | Yes | Basalt | §16.3 |
| Services | `/services` | Yes | Basalt | §16.4 |
| Branding | `/services/branding` | Yes (seeded service; partner delivery) | Basalt | §16.5 |
| **Design** | — | **No.** No `design` service or route exists. | — | Decision **D18**, §10.3 |
| Motion | `/services/motion` | Yes (seeded; partner delivery) | Basalt | §16.5 |
| Film | `/services/film` | Yes (seeded; partner delivery) | Basalt | §16.5 |
| (Websites) | `/services/websites` | Yes (seeded; VORA delivery) | Basalt | Not in the request list, but it is VORA's core service, §16.5 |
| Our Story | `/our-story` | Yes | Basalt, Mist quote | §16.6 |
| Partners | `/partners` | Yes | **Mist** | §16.7 |
| **Journal** | — | **No.** No route, table or content type. | — | Decision **D19**, §10.3 |
| Careers | `/careers`, `/careers/:slug` | Yes | Basalt | §16.9 |
| Contact / Enquiries | `/contact` | Yes | Basalt | §16.10 |
| Terms · Privacy · Cookies | `/terms`, `/privacy`, `/cookies` | Yes (one `legal.tsx`) | **Mist** | §16.11 |
| Status | `/status` | Yes | Basalt | §16.12 |

### 10.3 Pages that don't exist yet (proposals only — nothing will be built without your decision)

**D18 — "Design".**

- **Options:**
  - **(a)** Publish a `design` entry in the Services CMS. `/services/design` then works with
    **no code change**, because service pages are data-driven. It needs a delivery model:
    design is one of Solara's four disciplines, so decision C2/D4's wording applies.
  - **(b)** Treat design as part of **Websites** (interface and experience design are how VORA
    builds websites) and don't add a page.
- **Recommendation:** (b) until you decide. A separate "Design" page next to Branding risks
  blurring the VORA/Solara split that D4 set up.

**D19 — "Journal".**

- **What building it would take:**
  - a new content type (a `journal_entries` table with the same draft → publish lifecycle,
    versions and permissions as pages);
  - routes `/journal` and `/journal/:slug`;
  - sitemap entries;
  - an RSS feed;
  - CMS editor screens;
  - tests.

  That is roughly 3–5 days of work, and **it needs a real publishing commitment** — an empty
  or stale journal reads worse than none.
- **Recommendation:** defer it until at least 3 articles exist. The design direction is
  specified (§7.7, §16.8), so it slots in without redesign.

### 10.4 Page anatomy (all marketing pages)

1. **Header** (§5).
2. **Opening shot:** a label, a title and one supporting element (plate, film or a typographic
   plate).
3. **Body:** shots and sections on the grid, with alternating asymmetry and 0–2 Mist inversions.
4. **Closing invitation** (§7.9) — except on Contact (it *is* the invitation) and the legal
   pages (they end with a contact line instead).
5. **Footer** (§5.6).

One `h1` per page, landmarks (`header`, `nav`, `main`, `footer`) and the skip link to `#main`
(existing).

---

## 11. Portals (Admin, Account, Client, Member, VORA AI)

**Usability comes first.** The portals share VORA's typefaces, colour roles and precision, but
none of the cinema: no environment, no smooth scrolling, no reveals, no page-transition
choreography. Motion is ≤ 320 ms feedback (§8.2).

### 11.1 Workspace theme

- **Light by default** (the existing `data-theme="workspace"`):
  - background `basalt-50`;
  - surfaces white;
  - text `basalt-950`;
  - accent `lagoon-800`;
  - hairlines at 12 %.
- **Density:**
  - body at `--type-body-s` (15 px) in tables and dense panels, `--type-body` elsewhere;
  - 40 px controls (`s`) in toolbars, 48 px in forms.
- **Data:** DM Mono (`--type-data`) for references, IDs, timestamps, counts, IP and device
  strings; tabular numerals.
- **Dark workspace:** later and optional, following `prefers-color-scheme` only once built and
  tested.

### 11.2 Shell (`WorkspaceShell`)

- **Sidebar** (≥ 1024 px, 240 px wide):
  - the wordmark (small);
  - the area label (`ADMIN`, `ACCOUNT`, `CLIENT PORTAL`, `MEMBER AREA`);
  - the area's navigation — the existing arrays, permission-filtered;
  - at the bottom, the "switch to" links (existing: Your account, Admin, Client portal, Member
    area), then **Back to site** and **Sign out**.
- **Active item:** a 2 px `lagoon-800` inset line on the left, weight 560 and
  `aria-current="page"`.
- **Top bar** (56 px): the page title (heading-m), breadcrumbs for detail pages
  (`Enquiries / VR-…`) and the page's primary action on the right.
- **Below 1024 px:**
  - the sidebar becomes a drawer opened from a **Menu** button in the top bar (a dialog with a
    focus trap and `Esc`);
  - the primary action stays in the top bar.
- **Session and security cues:**
  - "Signed in as …" in the sidebar foot;
  - a visible notice when a privileged action needs re-authentication (step-up) — never a silent
    redirect.

### 11.3 Page patterns

| Pattern | Spec |
|---|---|
| **List page** (Enquiries, Users) | Page header → filter bar (status select, search, date range; filters reflected in the URL) → table (§7.13) → pagination (`Page 2 of 5` in DM Mono, Previous/Next) |
| **Detail page** (Enquiry) | Two columns ≥ 1024 px: left 8 columns for the record (**Details** panel: all submitted fields as a definition list, message at `--measure`); right 4 columns for **Update** (status control offering only the allowed transitions from `ENQUIRY_TRANSITIONS`, internal note) and **Timeline** (audit events, DM Mono timestamps). One column on smaller screens, with Update first. |
| **Panel** | White surface, 1 px line, radius 2 px, a 16 px heading row (`--type-label` title and an optional action link). Flat — no shadows, no nested panels. |
| **Settings forms** | One column at `--container-form`, grouped with labelled sections, a sticky Save bar only when there are unsaved changes (with a "You have unsaved changes" label) |
| **Destructive actions** | Danger button → confirm dialog restating the object ("Deactivate Jane Doe?"); a typed confirmation for irreversible bulk actions |
| **System** (`/admin/system`) | The health table (Component · State · Latency · Detail), then flags and settings; status squares plus labels |
| **Security** (`/account/security`) | Panels exist: Change password, Recovery codes, Signed-in sessions (Device · Location · Last active · Revoke), Recent sign-in activity (When · Result · Device · Location). Keep this order; add the 2FA panel when more factors ship. |
| **Charts** (AI usage and cost, when built) | Minimal line or bar charts in `lagoon-700` on basalt hairline grids, with a DM Mono axis, a data table alternative and no gradients or 3D |

### 11.4 Area specifics

- **Admin:**
  - Dashboard: the Enquiries panel with counts by status (existing), later content and system
    summaries;
  - Enquiries: list and detail;
  - Users: the People table, plus the "Invite someone" form with roles;
  - System.
  - Future CMS editors (pages, projects, services, careers, media library) follow the same
    patterns, plus an edit/preview split and a **Draft → Preview → Publish** bar that always
    shows the state (`DRAFT` / `CHANGES` / `PUBLISHED`).
- **Account:** Overview (Access: which areas the person can open) and Security (above).
- **Client portal:** "Your engagements", with the existing honest empty state. Engagements
  appear as a list: engagement name · status tag · last update. Files and messages come later.
- **Member area:** Welcome (existing); member sign-up is off (D7).

### 11.5 VORA AI (D8 — both channels switched off by flags and settings today)

**What exists in code:**

- the Gemini provider and `runAi` service;
- flags `ai.public_assistant` and `ai.admin_tools` (default off);
- the `ai.config` setting (model, limits, `publicEnabled`/`adminEnabled` false);
- permissions `ai.use`, `ai.manage` and `ai.usage.view`;
- daily request and token limits;
- a circuit breaker.

There is no AI UI yet. When it's built:

- **Public "Ask VORA"** (only when switched on):
  - **Entry points:** AI as *a way in, not a widget* (`00-DISCOVERY.md` §2.2, principle 10):
    - an **Ask VORA** text item in the header, after the primary items and before the CTA, and
      in the mobile menu;
    - a line on Contact (*slot*, e.g. "Have a question first? Ask VORA");
    - never a floating chat bubble, never a sparkle icon.
  - **Panel:**
    - a right-hand sheet on desktop (440 px), full screen on mobile;
    - dialog semantics, `Esc`, focus trap;
    - VORA's dark roles.
  - **Transcript:**
    - editorial, not chat bubbles: a label `YOU` above the question (`--type-ui`), a label
      `VORA AI` above the answer (body);
    - hairlines between turns;
    - no avatars.
  - **Streaming:** text appears progressively; screen readers get the completed answer (a
    polite live region on completion, not per token); a **Stop** button while streaming.
  - **Grounding and honesty:**
    - answers link their sources (published pages);
    - a permanent line under the input: "VORA AI answers from published pages on this site and
      can be wrong." + a privacy link;
    - a **Talk to a person** action leading to Contact.
  - **Limits:**
    - an input counter against `maxInputChars`;
    - friendly rate-limit and "unavailable" messages (the existing `AI_USER_MESSAGES`) with a
      way forward (email).
- **Admin AI tools** (only with `ai.use` and the flag on):
  - "Draft with VORA AI" actions inside editors;
  - output lands in a well labelled `AI DRAFT` and is **never** auto-applied or auto-published —
    a person accepts, edits or discards it, and the audit log records that it was AI-assisted.
- **AI administration:**
  - `ai.manage`: the configuration form (model, limits, channels) with the kill switch at the
    top;
  - `ai.usage.view`: today's requests and tokens against the limits, the estimated cost and a
    30-day chart.

---

## 12. Responsive behaviour

Each breakpoint gets its own composition. **Mobile is designed first for the portals and forms,
and as its own art-directed composition for the cinematic pages** — never a shrunken desktop.

| | **Desktop ≥ 1440** | **Laptop 1024–1439** | **Tablet 768–1023** | **Mobile < 768 (designed at 360–430)** |
|---|---|---|---|---|
| Grid | 12 col in `--container`; media may use `--container-wide` | 12 col | 8 col | 4 col |
| Header | Full nav + CTA, 72 px | Same | Menu + compact CTA, 64 px | Menu only (CTA < 600 px moves to the menu), 60 px |
| Display type | Max of the clamp | Fluid | Fluid; lines re-broken by hand for 8 col | Minimum sizes (display-xl ≈ 52 px); headlines rewritten into 2–4 short lines where needed (`text-wrap: balance`) |
| Home stations | Plates 21:9 with the real-time layer (T3), pins ≤ 150 vh | Plates + layer (T2) | Portrait or landscape plates by orientation (T1–T2) | **Portrait 9:16 plates with their own framing** (T1); shorter pins (≤ 100 vh); type sits in the plate's planned negative space |
| Work | Feature sequence; staggered 2-col tiles when ≥ 4 | Same | Sequence; tiles 2-col from 4 | Single-column sequence of 4:5 apertures with the label above the title; no hover dependency |
| Case study | Asymmetric text/media pairs; galleries 7 + 5 | Same | Pairs become stacked with alternating insets | Single column; some images full-bleed, some inset by a column, to keep rhythm |
| Services | Rows with hover apertures | Same | Rows without hover apertures | Rows: name, summary, delivery label; tap → page |
| Forms | 1 column (`--container-form`) with section labels in the left margin | Same | Labels above sections | Full width; inputs at 16 px (no iOS zoom); submit in the flow |
| Portals | Sidebar 240 px | Sidebar 240 px | Drawer nav | Drawer nav; tables → stacked definition lists; primary action in the top bar |

**Also designed for:**

- **Large screens (≥ 1920 px):**
  - the type stops growing at its clamp maximum;
  - media may widen to `--container-wide`;
  - text never widens beyond its measure.
- **Short viewports (height < 700 px):**
  - stations use `min-height: 36rem`;
  - pinned sequences become unpinned (normal flow) under 600 px of height;
  - the header hides sooner.
- **Landscape phones:** stations use landscape plates; the menu overlay switches to two columns
  of destinations.
- **Zoom and reflow:** 200 % text zoom and 320 CSS px reflow (WCAG 1.4.10) without loss — no
  fixed heights on text containers.
- **Touch versus pointer:** hover effects only under `(hover: hover) and (pointer: fine)`, and
  every hover reveal has a tap/visible equivalent.
- **Safe areas:** `env(safe-area-inset-*)` on the header, the menu and full-bleed media.

---

## 13. Accessibility (WCAG 2.2 AA, built in)

The architecture already commits to WCAG 2.2 AA (`01-ARCHITECTURE.md` §17). This is how the
design system meets it.

| Area | Requirement in this system |
|---|---|
| **Structure** | Landmarks (`header`, `nav`, `main`, `footer`); one `h1` per page; headings in order (the visual size comes from tokens, not from skipping levels); skip link first (existing) |
| **Route changes** | Focus moves to the new `h1` after navigation; titles are unique per page; View Transitions never delay focus (§8.3) |
| **Keyboard** | Everything operable by keyboard. Menu, lightbox, AI panel and portal drawers follow the WAI-ARIA dialog pattern (focus trap, `Esc`, focus return). No keyboard traps elsewhere. Native controls (select, date) are preferred over custom widgets. |
| **Focus** | The ring from §6.1 on every focusable element (≥ 3:1 against both adjacent colours; `lagoon-300` is 10.8:1 on Basalt). **Focus not obscured (2.4.11):** `scroll-padding-top: var(--header-h)` and the header reveals when focus enters it. |
| **Contrast** | Text ≥ 4.5:1 (body) and ≥ 3:1 (≥ 24 px, or ≥ 18.66 px bold); control boundaries and meaningful icons ≥ 3:1 (`--color-line-control`). All token pairs are pre-computed (§3). Text over imagery is checked against the plate's brightest area, with a scrim where needed. |
| **Not colour alone** | Links underlined; status = square + label; errors = icon + "Error:" + text; the active nav item has a tick and `aria-current`, not just a colour |
| **Motion** | The complete T0 version (§8.10); the footer toggle; pause controls for any movement longer than 5 s (2.2.2); nothing flashes more than 3 times a second (2.3.1) |
| **Target size** | 44 × 44 px for controls (exceeds the 24 px of 2.5.8); spacing between adjacent targets |
| **Dragging** (2.5.7) | Every swipe or drag (lightbox, galleries) has button equivalents |
| **Forms** | Visible labels; hints and errors linked with `aria-describedby`; an error summary that takes focus (existing); `autocomplete` tokens (`name`, `email`, `organization`, `url`); input is kept on validation errors and **when the signed form token expires** (the form re-issues a token and keeps what was typed — 2.2.1, 3.3.7) |
| **Authentication** (3.3.8) | Paste allowed in password and code fields; `autocomplete="current-password"`, `"new-password"` and `"one-time-code"`; password-manager friendly; no puzzles (Turnstile runs in managed/invisible mode) |
| **Consistent help** (3.2.6) | Contact details and "Start a project" sit in the same places on every page (header, footer) |
| **Media** | Captions for speech; transcripts for long films; no autoplaying sound; the 3D canvas is `aria-hidden` with every station's meaning in real text |
| **Reflow and zoom** | 320 px reflow and 200 % text zoom without loss (§12); no text in images |
| **Language** | `lang` set on `<html>`; plain, sentence-case language; abbreviations explained once |

**How it's verified** (extending the existing tests):

- the axe checks in `tests/e2e/a11y.spec.ts` run on every public route, the auth pages and each
  portal area, in both motion modes;
- keyboard-only journeys for the menu, the enquiry form, the lightbox and sign-in with 2FA;
- a manual VoiceOver (macOS and iOS) pass on Home, a case study, Contact and the enquiry detail;
- a contrast script over the token pairs, which already exists as a scratch tool and moves into
  `tests/tooling`.

---

## 14. Performance

"Fast is premium" (§1.3). These budgets come from `01-ARCHITECTURE.md` §16, made specific to this
system.

| Budget | Target |
|---|---|
| **LCP** | < 2.5 s at p75 on a mid-range Android phone over 4G (the first shot is HTML text plus one compressed poster) |
| **CLS** | < 0.05 (dimensions on all media, font metric overrides, no late-injected banners) |
| **INP** | < 200 ms (no long tasks on interaction; heavy setup waits for idle time) |
| **HTML + critical CSS** | < 50 KB gzipped per public page |
| **JavaScript before interaction** | < 120 KB gzipped (React, the router and the page), excluding lazy chunks |
| **Lazy: motion** | GSAP + ScrollTrigger (about 45 KB gzipped) only on pages that scrub; Lenis (about 4 KB) only at T2/T3 |
| **Lazy: experience** | Three.js (about 150 KB gzipped) plus scene code, only at T2/T3 on Home, loaded after first paint and idle |
| **Fonts** | 3 WOFF2 files, Latin subsets, ≤ 200 KB in total (≈161 KB measured, §2.1); only Archivo is preloaded |
| **Images** | First-shot poster ≤ 150 KB (mobile AVIF) / ≤ 300 KB (desktop); tiles ≤ 120 KB; everything below the fold lazy |
| **Video** | Ambient loops ≤ 4 MB (mobile) / ≤ 8 MB (desktop); plates streamed in segments; never preloaded before the first shot is interactive |
| **Portals** | Area-level code splitting (no portal code on public pages); tables paginated at 50 rows; charts as hand-built SVG, or a library ≤ 30 KB gzipped |
| **Caching** | Hashed assets `immutable`, one year; anonymous public HTML edge-cached briefly with `stale-while-revalidate` and purged on publish; nothing with a session cookie is cached |

**How it's enforced:**

- Lighthouse CI budgets on Home, Work, a case study, Contact and Sign in (mobile profile);
- a bundle-size check in the test run;
- the frame-time governor in the experience layer (architecture §11.3);
- optional real-user monitoring with Cloudflare Web Analytics (free, cookieless). It is not
  enabled without your approval, and must appear in the cookie/privacy notices if used.

**Hosting note:** the origin is planned to be in Singapore (see `VORA-RAILWAY-MIGRATION.md`).
Anonymous pages are served from Cloudflare's cache near the visitor. Signed-in and form traffic
pays the round trip to the origin, so server responses must stay lean (≤ 200 ms at the origin).

---

## 15. DO NOT MAKE VORA LOOK LIKE THIS

Every screen is checked against this list before it ships. If a screen could be mistaken for a
template, it is redesigned, not polished.

| ✗ Never | What it looks like | What VORA does instead |
|---|---|---|
| **A generic SaaS dashboard** | Rounded white cards in a bento grid, pastel stat tiles, blue primary buttons, sidebar icons in circles, charts with gradients | A flat workspace with typographic hierarchy, hairlines, DM Mono data and one accent (§11) |
| **A template agency website** | Gradient headline + two buttons + a laptop mockup; "Trusted by" logo wall; three icon cards for "services"; a stats band ("200+ projects"); a testimonial carousel; FAQ accordion filler; "Let's work together" band repeated on every page | Stations with one idea each; real work in apertures; the services as editorial rows; a closing invitation written for each page (§7, §16) |
| **Excessive glassmorphism** | Frosted blurred panels, translucent cards over busy imagery, backdrop blur on the header | Solid surfaces; the header at 92 % Basalt with a hairline and **no blur** (§5.2) |
| **Excessive rounded cards** | 12–24 px radii everywhere, pills, cards inside cards, shadows to separate things | 0 px for media and sections, 2 px for controls; separation by space and hairlines (§4.5, §7) |
| **Random gradients** | Mesh blobs, purple-to-blue buttons, gradient text, gradient borders | Colour comes from *light* in photography, film and the environment only (§3.3) |
| **Glowing effects** | Neon outlines, glow orbs, box-shadow halos, "cyber" scanlines, light leaks on UI | Light belongs to the world (plates), never to the interface. The accent is a flat colour under 5 % of the screen. |
| **Excessive animation** | Everything fading up, letter-by-letter confetti, parallax on every layer, scroll-jacking, a splash loader, cursor followers, magnetic buttons, tilt cards | One gesture per shot, reveal once, content first, no custom cursor, a full reduced-motion version (§8) |
| **Poor typography** | Default Inter/Poppins, everything bold, centred paragraphs, tiny grey text, headings wrapping badly, fake small caps | Archivo's expanded and regular widths, 300–560 weights, measured line lengths, balanced hand-set display lines, DM Mono labels, one italic word (§2) |
| **Clutter** | Several CTAs per screen, badges, emojis, icon rows, multiple accent colours, banners stacked on banners | One idea and one action per shot; negative space as the luxury signal (§1.3) |
| **AI-generated-looking sections** | "Unlock / Elevate / Seamless / Next-level" copy, sparkle icons, generic 3D blobs, AI stock people, identical section heights, a three-column feature grid with icon circles, a centred symmetric layout on every section, invented metrics or logos | Real content or marked slots; asymmetric compositions that change shot to shot; VORA's own rendered world; no invented numbers, clients or quotes (§1.3 principle 8) |
| **Inconsistent spacing** | Arbitrary pixel values, different gaps between the same elements, misaligned left edges | The spacing scale only (§4.3); one strong alignment per shot; one-off values treated as bugs |
| **Mobile as compressed desktop** | Shrunken three-column grids, 10 px text, desktop crops centre-squeezed, hover-only information, a hamburger that opens a tiny dropdown | Portrait plates with their own framing; rewritten line breaks; single-column sequences; the full-screen menu; tap equivalents for every hover (§12) |

**Also excluded:**

- **The references themselves:**
  - ALCHE's triangle, violet volumetrics and wireframe loader;
  - Ascend's ribbed arch;
  - R3's pixel type, neon space and particle flora;
  - FIND's cloud descent and giant cropped footer wordmark.

  VORA takes *principles* from them, never motifs.
- **Solara's identity:** no Poppins, no cream/gold palette, no Solara compositions.
- **Web3, crypto, gaming or cyberpunk styling**, including the old maintenance page's glow orbs
  and gradient text.

**The anti-generic gate** (asked at every design review):

1. Could this screen belong to any other studio if the logo were removed?
2. Does the opening shot belong specifically to VORA's world (survey line, aperture, stone, water,
   light)?
3. Is the section rhythm predictable (same height, same layout, same entrance) three times in a
   row?
4. Is the typography doing real work — scale, width, one italic, labels — or is it just "a
   heading and a paragraph"?
5. Is every image real and doing compositional work?
6. Does mobile have its own composition?
7. Is there anything on screen that isn't true?

A weak answer to any of them means the screen is redesigned.

---

## 16. Page-by-page direction

Each page is described by: **purpose · opening shot · layout · content hierarchy · interactions ·
imagery · motion · CTA · responsive**. Copy in quotes is real (from the code, the seeds or the
live Mark4 site). *Slot* marks copy you still need to write or approve. Nothing here invents a
client, project, statistic or quote.

**A rule for every page's first shot:** the element likely to be the LCP (headline or poster) is
**visible at first paint**. Its entrance animates from an already-visible state (a transform, not
from `opacity: 0`), and a safety timeout shows everything if scripts are slow. Motion must never
cost LCP.

### 16.1 Home `/` — the station sequence

- **Purpose:** in about a minute of scrolling, a first-time visitor understands that VORA designs
  and builds premium websites and digital platforms. They see real work, understand who delivers
  which discipline, and are invited to start a project.
- **Tiering:**
  - The storyboard below is the architecture's (§11.1), locked against the Blender blockout when
    it arrives (D9).
  - **Until the files exist, Home ships as the T0 typographic version:** each station is a
    composed typographic shot on Basalt, with the survey line as its horizon and real project
    captures in Chambers. It is complete and good on its own. The plates and real-time layer are
    added on top later, without restructuring the page.

| # | Station | Content (real or *slot*) | Composition | Motion (T1–T3) | T0 and mobile |
|---|---|---|---|---|---|
| 1 | **Threshold** | Wordmark (real logo, D5); one positioning line — *slot*, with the real Mark4 line "Design × Technology × Identity." as the working option | Full-viewport plate: mist over water, the monument in silhouette. The survey line *is* the horizon; the wordmark sits on it; the line of copy below at display-m. A thin vertical scroll rule at the bottom (no bouncing arrow). | The horizon draws (900 ms), then the wordmark settles (≤ 1.4 s total); light breaks as scrolling begins (scrubbed) | T0: the still frame, with text present at first paint. Mobile: a 9:16 portrait plate framed for it, and the wordmark in the upper third. |
| 2 | **Approach** | What VORA is — **two sentences at most** (*slot*; real sources: "Great ideas. Average presence.", "VORA starts with websites.") | The camera dollies toward the monument; text at columns 2–7 at display-m with **one** italic word | The plate scrubs; lines rise through masks | T0: a still, with a crossfade from Threshold. Mobile: text in the plate's top negative space. |
| 3 | **Chambers** | Featured work: published `isFeatured` projects (SAIL Gaming and EON Clothing, once published) · "See all work →" | Openings in the monument frame each project: one ProjectFeature per opening, index `01 / 02` | The camera moves along the openings; each aperture opens as it aligns; clicking morphs into the case study (§8.3) | **No published projects → the chamber shows the existing empty-state line and the invitation — no placeholders.** Mobile: stacked 4:5 apertures with a sticky index label. |
| 4 | **Terraces** | Services: Websites · Branding · Motion · Film, with delivery labels (§7.4) · "All services →" | A lateral camera move across terraces and water channels; one terrace per service, each a ServiceRow at display-m | A lateral scrub; each row reveals as its terrace passes | T0 and mobile: a vertical list of rows over one still plate |
| 5 | **Reflection** (Mist) | "Creative by Solara. Digital by VORA." · "About the partnership →" (Partners) | The camera meets the water; the page **inverts to Mist**; the statement is centred at display-l (a single-statement exception to asymmetry) | The horizon-line inversion (§8.4) | T0: a hard cut to Mist |
| 6 | **Horizon** | The invitation: label `NEXT — START A PROJECT`, one sentence (*slot*), **Start a project** (`l`), the projects email | The camera turns to open landscape; the sun aligns on the horizon line | The sun's alignment is scrubbed; the button is the last thing to settle | Mobile: a full-width button; the email below |

- **Content hierarchy:** the wordmark → what VORA is → proof (work) → capability (services) →
  relationship (partnership) → action.
- **CTA:** the header CTA throughout, plus the Horizon.

### 16.2 Work `/work`

- **Purpose:** show real delivered work credibly and lead into the case studies.
- **Opening shot:**
  - label `WORK` plus a live count (`02 PROJECTS` — real data, an instrument label);
  - the title "Work" at display-l;
  - a lead (*slot*, one sentence).
- **Layout:**
  - fewer than 4 published projects → a sequence of ProjectFeatures, one per shot, alternating
    left and right;
  - 4 or more → the staggered two-column tile rhythm (§7.2);
  - a text index (ProjectRow) from 6 projects;
  - filters only with at least 6 projects and at least 2 categories.
- **Hierarchy:** featured projects first (`sortOrder`), then the rest, then the invitation.
- **Interactions:** tile hover (§7.2); the shared-element transition into a case study; external
  "Visit site ↗" links only on the case study, not on tiles (one action per tile).
- **Imagery:** real covers only; a typographic plate where a cover is missing.
- **Motion:** apertures open on entry; parallax inside the frames.
- **CTA:** the closing invitation (*slot* sentence about starting a project).
- **Responsive:** a single-column 4:5 sequence on mobile.
- **Empty:** the existing copy — "Case studies are being prepared for publication." and "get in
  touch".

### 16.3 Case study `/work/:slug`

- **Purpose:** tell the true story of one project: the context, what VORA built, how it looks and
  works, and who made it. It uses only facts you supply. Case-study material is an open input
  (`00-DISCOVERY.md` §7, item 3).
- **Opening shot:**
  - the 21:9 hero aperture with the cover (morphing from Work);
  - the title at display-l overlapping the frame's lower-left edge;
  - label `CATEGORY · YEAR` (e.g. `ESPORTS`, plus the year once it has been entered);
  - the summary as the lead (seeded, real);
  - "Visit site ↗" (`externalUrl`).
- **Layout:**
  1. hero;
  2. ProjectFacts strip (Client · Year · Category · Services · Website);
  3. body blocks in an alternating text/media rhythm (§7.3);
  4. Credits;
  5. NextProject.
- **Hierarchy:** what it is → the facts → the story and visuals → the people → where next.
- **Interactions:**
  - the lightbox for images;
  - films with controls;
  - the scroll-progress rule at the header edge;
  - the NextProject strip is one link.
- **Imagery:** real captures and recordings of the delivered site (flat, no mockups), long pages
  scrolling inside apertures, and short recordings of the real interactions.
- **Motion:** the hero morph; apertures open; paired images offset by parallax (≤ 8 %).
- **CTA:** a closing invitation written in the project's context (*slot*), then NextProject.
- **Responsive:**
  - the facts become a two-column definition list;
  - galleries go to a single column with alternating insets;
  - the hero switches to 4:5 with the title below the frame.

### 16.4 Services `/services`

- **Purpose:** make clear what VORA does, and exactly who delivers each discipline (decisions
  C2/D4).
- **Opening shot:**
  - label `SERVICES`;
  - the title "Services" at display-l;
  - a lead (*slot*);
  - the existing partner label "Creative by Solara. Digital by VORA.".
- **Layout:**
  1. four ServiceRows in `sortOrder` (Websites first);
  2. the Process (the six real steps on a survey line);
  3. the invitation.
- **Interactions:** row hover apertures (desktop, only if media exists); rows are plain links on
  touch.
- **Imagery:** one real image per service, if you have it; otherwise none.
- **Motion:** the row hairlines draw; the Process line is scrubbed, with ticks lighting as they're
  reached.
- **CTA:** the closing invitation.
- **Responsive:** rows stack name → summary → delivery label; the Process line turns vertical.

### 16.5 Service pages `/services/:slug` — Websites, Branding, Motion, Film (Design: D18)

**The shared template:**

1. ServiceHero: name at display-l, summary as the lead, delivery label, and one real plate or a
   typographic plate.
2. "What this covers": CMS body, *slot*.
3. **Who does what:**
   - for partner-delivered services, a two-column split — "Creative by Solara" / "Digital by
     VORA" — describing each side's responsibilities (*slot*; needs your and Solara's approval);
   - for Websites, VORA end to end.
4. Related work: published projects whose services include this slug. Hidden when there are
   none.
5. The Process.
6. The invitation. A proposed enhancement is `/contact?type=<slug>` to pre-tick the matching
   project type (a small code change, not built).

**Each page's own direction** (within the template):

| Service | Delivery (seeded) | Art direction |
|---|---|---|
| **Websites** | VORA | VORA's own discipline, so the richest page. Real site captures scroll inside apertures; the "built" language (grid, survey lines, instrument labels) is strongest here; related work: SAIL Gaming and EON Clothing (both `websites`). |
| **Branding** | Solara (partner) | VORA's view of identity: how a brand becomes a digital system (type, colour tokens, components). Any Solara imagery must be real, approved by Solara, and shown in VORA's layout language (§7.5). |
| **Motion** | Solara (partner) | Real motion samples as ambient loops with pause controls; the page itself stays restrained, so the work is the motion. |
| **Film** | Solara (partner) | The hero is a 16:9 film player (poster + play, captions, never autoplaying with sound); stills from real productions only. |
| **Design** | — (does not exist) | If D18 = (a): the same template, with its delivery model stated. If (b): no page; Websites covers interface design. |

- **Responsive:** as Services; players and plates switch to their mobile ratios (§9.1).

### 16.6 Our Story `/our-story`

- **Purpose:** why VORA exists, how it works and who founded it.
- **Content:** the seeded CMS page (draft, "review and rewrite before publishing"). Its real
  material:
  - "Why should great organisations settle for average websites?"
  - "Great ideas. Average presence."
  - "Design × Technology × Identity."
  - the six process steps;
  - "VORA starts with websites."
  - "Founded by Strive."
  - and, from Mark4, Strive's line "Don't wait for the future. Build it.".
- **Opening shot:** label `OUR STORY`; the title at display-l; the first question ("Why should
  great organisations settle for average websites?") as the opening statement.
- **Layout:** a chaptered long-read in which each heading is a shot:
  - label `01 — THE BEGINNING`;
  - the chapter's one-line statement at display-l;
  - supporting paragraphs (*slot*) at the measure.
  - "Design × Technology × Identity" becomes a **typographic triptych** with survey lines
    between the words.
  - "How we work" is the Process line.
- **Founder:** the QuoteBlock ("Don't wait for the future. Build it." — Strive, Founder) in one
  Mist moment. A portrait only if you supply one — no placeholder silhouette.
- **Interactions:** none beyond reading and the invitation.
- **Motion:** line reveals per chapter statement; the triptych lines draw; the Process scrubs;
  the Mist inversion for the quote.
- **CTA:** the closing invitation.
- **Responsive:** the triptych stacks vertically with horizontal survey lines; chapter statements
  are re-broken into short lines.

### 16.7 Partners `/partners` (Mist page)

- **Purpose:** explain the VORA × Solara partnership plainly and transparently.
- **Opening shot:** the whole page in the Mist theme; label `PARTNERS`; the statement "Creative
  by Solara. Digital by VORA." at display-l (PartnerBlock, §7.5).
- **Layout:**
  1. the statement;
  2. the Solara entry (name, `CREATIVE PARTNER`, the seeded description);
  3. the principles "Clear roles / One experience / Shared standards" (bodies are *slots*);
  4. **what's delivered together**, derived from the data: the services whose partner is Solara
     Studios (Branding, Motion, Film);
  5. partnership enquiries.
- **Imagery:** optional — a single Mist plate from the environment (the Reflection frame). No
  Solara branding assets.
- **Motion:** calm — the statement's lines rise, and the principle hairlines draw.
- **CTA:** "Partnership enquiries" with the general address from settings, plus Start a project.
- **Responsive:** the statement over 4 short lines; the principles stack.

### 16.8 Journal (proposal only — D19; no route exists)

If you approve it:

- **Index `/journal`:**
  - a lead article in a 3:2 aperture;
  - then a hairline list (date · title · standfirst · category).
- **Article `/journal/:slug`:**
  - Mist theme (reading = light, like the legal pages);
  - title at display-m, a standfirst lead, date and category labels;
  - body blocks with the same renderer as case studies;
  - related articles;
  - an RSS feed.
- **Motion:** minimal — reading pages don't perform.

### 16.9 Careers `/careers` and role pages `/careers/:slug`

- **Purpose:** attract people with craft and list open roles honestly.
- **Opening shot:** label `CAREERS`; the title "Careers" at display-l; a lead (*slot*); the real
  Mark4 values **Craft · Taste · Reliability** as a typographic triptych.
- **Layout:** values → open roles (CareerRows, published roles only; the four seeded roles are
  drafts) → the empty state when there are none (existing copy) → the closing shot.
- **Role page:**
  - the title at display-m;
  - a facts row (employment type · location type · location text);
  - the body at the measure;
  - **How to apply**, matching `applicationMode`: external ↗, email (existing), or the form when
    it ships.
- **Interactions:** rows are single links; the email link carries the role as its subject
  (existing).
- **Imagery:** none by default. Real studio or team imagery only if supplied.
- **Motion:** row hairlines draw; values lines draw.
- **CTA:** this page's invitation is **"Introduce yourself"** with the careers email, not "Start a
  project" (principle 6).
- **Responsive:** the triptych stacks; rows show the title with the facts beneath.

### 16.10 Contact `/contact` — Start a project

- **Purpose:** turn intent into a well-formed enquiry with no friction and total clarity.
- **Opening shot:**
  - label `CONTACT`;
  - h1 "Start a project" (existing);
  - the existing lead: "Tell us what you're planning. Prefer email? Write to …" with the projects
    address.
- **Layout:**
  - **Desktop:** columns 1–4 hold a sticky context column: what happens after sending (*slot* —
    no invented response times) and the other real addresses from settings (general enquiries,
    careers, and support for existing clients). Columns 6–11 hold the form (§7.10).
  - **Mobile:** the heading, a short context line, the form, then the rest of the context.
- **Hierarchy:** the heading → the form sections in order → Send enquiry.
- **Interactions:**
  - the conditional target date;
  - the conditional budget field (D15);
  - Turnstile;
  - the error summary;
  - the in-place success state with the reference (`VR-XXXXXX` in DM Mono).
- **Imagery:** none — focus.
- **Motion:** section hairlines draw once; **no motion on inputs**; on success, a survey line
  draws under the reference.
- **CTA:** "Send enquiry" (existing label).
- **Responsive:** single column; inputs at 16 px; the submit in the flow.

### 16.11 Legal — `/terms`, `/privacy`, `/cookies` (Mist pages)

- **Purpose:** legal text that is easy to read and easy to trust.
- **Layout:**
  - Mist theme;
  - label `LEGAL`;
  - the title at display-m;
  - "Last updated" as a data label (from the publish date);
  - desktop: a sticky contents list built from the `h2`s at columns 1–3, with the text at the
    measure in columns 4–10;
  - mobile: a collapsible contents list at the top.
- **Content:** the CMS pages (drafts). **The seeded placeholders say the notices must be written
  and approved before publishing**, and the design never publishes a placeholder.
  - The Cookies page must list every cookie the site sets, including the session cookie
    (`__Host-vora_session`) and the motion preference cookie if adopted (§8.10).
- **Motion:** none beyond the scroll-progress rule.
- **CTA:** a closing contact line ("Questions about this notice?" + the general address) instead
  of the project invitation.
- **Responsive:** single column; the contents list collapses.

### 16.12 Status `/status`

- **Purpose:** honest, coarse system status (D16).
- **Layout:**
  - label `STATUS`;
  - h1 "All systems operational" or "Some systems are affected" (existing);
  - "Checked …" as a DM Mono timestamp;
  - the component table with status squares and labels;
  - a "Refresh" link (no auto-refresh motion).
- **Theme:** Basalt, minimal, no imagery.
- **Responsive:** the table becomes a stacked list.

### 16.13 System and auth pages

- **404** (catch-all route and the error boundary's 404 case):
  - label `404 — NOT FOUND`;
  - the existing copy at display-m: "This page doesn't exist." with "It may have moved, or the
    link may be incorrect.";
  - links to Home, Work and Contact;
  - the survey line as a horizon;
  - no jokes or illustrations.
- **Error boundary** (`app/root.tsx`):
  - the existing label `Error {status}` and per-status copy ("Something went wrong on our
    side.", "You don't have access to this.", "Please sign in to continue." …);
  - "Return to the homepage" (existing), plus "Sign in" for 401;
  - *proposed addition:* the request ID in DM Mono so support can trace the failure;
  - never technical details in production (existing behaviour kept).
- **Maintenance and unavailable** (kernel HTML in `app/.server/kernel/pages.ts`):
  - static, no scripts;
  - the text wordmark on Basalt;
  - one message and a Status link;
  - it inherits these tokens as inline styles.
- **Auth** (`/login`, `/login/verify`, `/login/recovery`, `/forgot-password`,
  `/reset-password/:token`, `/invite/:token`, `/setup`):
  - Basalt;
  - one centred column (`--container-auth`), the wordmark above, the title at heading-l;
  - forms per §7.11;
  - the one-time code in a single DM Mono field (`one-time-code`, paste allowed);
  - a recovery-code link on the verify step;
  - no environment imagery and no motion beyond feedback;
  - messages that never reveal whether an account exists (existing security behaviour — the
    design must not add hints).

---

## Appendix A — Token reference (implementation-ready)

These tokens replace the values in `app/styles/tokens.css` (the "PHASE 1 PROVISIONAL" file) when
the rebuild starts. **They are not applied yet.**

```css
@layer tokens {
  :root {
    /* Palette — Basalt → Mist */
    --basalt-950: #0a0c0b; --basalt-900: #111413; --basalt-850: #171b1a; --basalt-800: #1f2423;
    --basalt-700: #2e3432; --basalt-600: #454c4a; --basalt-500: #646b68; --basalt-400: #88908d;
    --basalt-300: #aeb5b2; --basalt-200: #d0d6d3; --basalt-100: #e6eae8; --basalt-50: #f2f4f3;
    --white: #ffffff;
    /* Palette — Lagoon (from the mark) */
    --lagoon-100: #c7eec4; --lagoon-200: #a4e1af; --lagoon-300: #80d0a8; --lagoon-400: #59bba1;
    --lagoon-500: #479e93; --lagoon-600: #33747a; --lagoon-700: #2f6e73; --lagoon-800: #235a5e;
    --dusk-600: #3d3964; /* environment light and film only — never UI */

    /* Semantic roles — Basalt (public default) */
    --color-bg: var(--basalt-950);
    --color-surface: var(--basalt-900);
    --color-surface-raised: var(--basalt-850);
    --color-well: var(--basalt-800);
    --color-text: var(--basalt-100);
    --color-text-secondary: var(--basalt-300);
    --color-text-muted: var(--basalt-400);
    --color-line: rgb(230 234 232 / 0.14);
    --color-line-strong: rgb(230 234 232 / 0.32);
    --color-line-control: rgb(230 234 232 / 0.4);
    --color-accent: var(--lagoon-300);
    --color-focus: var(--lagoon-300);
    --color-action-bg: var(--basalt-100);
    --color-action-bg-hover: var(--white);
    --color-action-bg-pressed: var(--basalt-200);
    --color-action-text: var(--basalt-950);
    --color-disabled-bg: var(--basalt-700);
    --color-disabled-text: var(--basalt-400);
    --color-danger: #ff8a7a;
    --color-success: #9fd8b0;
    --color-warning: #f0cf8a;
    --color-info: var(--lagoon-300);
    --scrim-bottom: linear-gradient(to top, rgb(10 12 11 / 0.72), rgb(10 12 11 / 0));
    --scrim-top: linear-gradient(to bottom, rgb(10 12 11 / 0.4), rgb(10 12 11 / 0));

    /* Typography */
    --font-sans: "Archivo", "Archivo Fallback", ui-sans-serif, system-ui, sans-serif;
    --font-serif: "Newsreader", "Newsreader Fallback", ui-serif, Georgia, serif;
    --font-mono: "DM Mono", "DM Mono Fallback", ui-monospace, SFMono-Regular, Menlo, monospace;
    --type-display-xl: clamp(3.25rem, 1.44rem + 8.05vw, 10rem);
    --type-display-l: clamp(2.75rem, 1.61rem + 5.07vw, 6.5rem);
    --type-display-m: clamp(2.25rem, 1.61rem + 2.84vw, 4.5rem);
    --type-heading-l: clamp(1.75rem, 1.39rem + 1.62vw, 3rem);
    --type-heading-m: clamp(1.375rem, 1.23rem + 0.65vw, 1.875rem);
    --type-heading-s: clamp(1.125rem, 1.09rem + 0.19vw, 1.25rem);
    --type-lead: clamp(1.125rem, 0.99rem + 0.56vw, 1.5rem);
    --type-body: clamp(1rem, 0.98rem + 0.09vw, 1.0625rem);
    --type-body-s: 0.9375rem;
    --type-ui: 0.9375rem;
    --type-label: 0.75rem;
    --type-data: 0.8125rem;
    --type-quote: clamp(1.625rem, 1.25rem + 1.67vw, 2.75rem);
    --tracking-label: 0.14em;

    /* Spacing (4 px base) */
    --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem;
    --space-5: 1.5rem; --space-6: 2rem; --space-7: 3rem; --space-8: 4rem;
    --space-9: 6rem; --space-10: 8rem; --space-11: 11rem; --space-12: 15rem;
    --section-s: clamp(4rem, 2.94rem + 4.72vw, 7rem);
    --section-m: clamp(6rem, 4.25rem + 7.78vw, 11rem);
    --section-l: clamp(8rem, 5.17rem + 12.6vw, 16rem);

    /* Layout */
    --page-margin: clamp(1.25rem, 0.53rem + 3.2vw, 3.5rem);
    --grid-gap: clamp(1rem, 0.72rem + 1.25vw, 1.75rem);
    --container: 88rem;
    --container-wide: 110rem;
    --container-form: 40rem;
    --container-auth: 26rem;
    --measure: 64ch;
    --header-h: 60px; /* 64px from 768px, 72px from 1024px (set in media queries) */
    --station-h: max(100svh, 36rem);

    /* Shape and depth */
    --radius-s: 2px;
    --shadow-popover: 0 8px 24px rgb(10 12 11 / 0.14); /* portals only */

    /* Motion */
    --dur-micro: 120ms; --dur-fast: 200ms; --dur-base: 320ms;
    --dur-medium: 560ms; --dur-slow: 900ms; --dur-cinematic: 1400ms;
    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
    --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  }

  /* Light roles: Mist chapters, legal pages, and the workspace */
  [data-theme="mist"],
  [data-theme="workspace"] {
    --color-bg: var(--basalt-50);
    --color-surface: var(--white);
    --color-surface-raised: var(--white);
    --color-well: var(--basalt-100);
    --color-text: var(--basalt-950);
    --color-text-secondary: #3a413e;
    --color-text-muted: #5a625f;
    --color-line: rgb(10 12 11 / 0.12);
    --color-line-strong: rgb(10 12 11 / 0.28);
    --color-line-control: rgb(10 12 11 / 0.52);
    --color-accent: var(--lagoon-800);
    --color-focus: var(--lagoon-800);
    --color-action-bg: var(--basalt-950);
    --color-action-bg-hover: var(--basalt-800);
    --color-action-bg-pressed: var(--basalt-800);
    --color-action-text: var(--basalt-50);
    --color-disabled-bg: var(--basalt-100);
    --color-disabled-text: var(--basalt-500);
    --color-danger: #b3261e;
    --color-success: #1e6b3a;
    --color-warning: #7a5600;
    --color-info: var(--lagoon-800);
  }

  /* T0 — reduced motion: the OS setting (unless the visitor chose "Full") or the site toggle */
  @media (prefers-reduced-motion: reduce) {
    :root:not([data-motion="full"]) {
      --dur-medium: 0ms; --dur-slow: 0ms; --dur-cinematic: 0ms;
    }
  }
  :root[data-motion="reduced"] {
    --dur-medium: 0ms; --dur-slow: 0ms; --dur-cinematic: 0ms;
  }
}
```

**Type style recipes** (utility classes built on the tokens). `font-stretch` drives Archivo's `wdth`
axis only if the self-hosted `@font-face` declares the range — `font-stretch: 62% 125%`;
without it, browsers clamp to normal width:

| Class | Recipe |
|---|---|
| `.t-display-xl` | `font: 300 var(--type-display-xl)/0.9 var(--font-sans); font-stretch: semi-expanded; letter-spacing: -0.04em; text-wrap: balance` |
| `.t-display-l` | `font: 320 var(--type-display-l)/0.94 var(--font-sans); font-stretch: semi-expanded; letter-spacing: -0.035em; text-wrap: balance` |
| `.t-display-m` | `font: 360 var(--type-display-m)/1 var(--font-sans); font-stretch: semi-expanded; letter-spacing: -0.028em; text-wrap: balance` |
| `.t-heading-l` / `-m` / `-s` | Weights 420 / 480 / 560; line heights 1.06 / 1.16 / 1.25; tracking −0.02 / −0.012 / −0.006em |
| `.t-lead` | `font: 360 var(--type-lead)/1.42 var(--font-sans); letter-spacing: -0.006em; max-width: 52ch` |
| `.t-body` | `font: 400 var(--type-body)/1.6 var(--font-sans); max-width: var(--measure)` |
| `.t-label` | `font: 400 var(--type-label)/1.3 var(--font-mono); letter-spacing: var(--tracking-label); text-transform: uppercase` |
| `.t-data` | `font: 400 var(--type-data)/1.45 var(--font-mono); letter-spacing: 0.02em; font-variant-numeric: tabular-nums` |
| `.t-quote` / `em.t-italic` | `font-family: var(--font-serif); font-style: italic; font-weight: 380` (the quote size, or inherited size with `font-size-adjust` for emphasis words) |
| `.t-times` | `font-stretch: 100%; font-weight: 300` — the `×` inside display lines (§2.1 glyph defect) |

In T0 the header also stops hiding on scroll (it stays in the "Scrolled" state), and reveal classes
are not applied at all — the durations above only cover CSS transitions.

**Migration from the Phase 1 tokens** (mechanical: 62 usages in 10 files outside `tokens.css`, counted on the CP-3 copy):

| Phase 1 token | Becomes |
|---|---|
| `--stone-*` | `--basalt-*` (values shift cooler: mineral, never cream) |
| `--color-text-muted` (Phase 1 meaning: *secondary* text) | `--color-text-secondary` |
| `--color-text-subtle` | `--color-text-muted` |
| `--color-focus` (off-white) | `lagoon-300` / `lagoon-800` via the same role |
| `--text-xs` … `--text-3xl` | The `--type-*` scale (§2.2) |
| `--leading-*` | Line heights inside the type recipes |
| `--tracking-label: 0.18em` | `0.14em` (DM Mono is wider than the system mono) |
| `--gutter` | `--page-margin` (outer) and `--grid-gap` (between columns) |
| `--radius-m: 4px` | Retired → `--radius-s` (2 usages) |
| `--duration-fast/base/slow` (160/320/720 ms) | `--dur-fast/base/slow` (200/320/900 ms) |
| `--ease-out`, `--ease-in-out`, `--container`, `--measure`, `--space-1…10`, `--radius-s`, `--color-bg`, `--color-surface`, `--color-surface-raised`, `--color-text`, `--color-line`, `--color-line-strong`, `--color-action-*`, `--color-danger/success/warning` | **Unchanged names** (some values change) |

---

## Appendix B — What each reference contributes (principles, never motifs)

| Reference | Taken as a principle | Explicitly not taken |
|---|---|---|
| **R0 ALCHE** | One continuous world; chapter words as monumental type; the hard inversion to a light chapter; precise instrument-like micro detail | The triangle, the wireframe-grid loader, violet volumetric light, the glitch wordmark, curved 3D project screens, crosshairs as decoration |
| **R1 "Ascend"** | One sculptural subject carrying the page; raking light doing the design work; one italic word per line; the call to action staged at the climax | The ribbed/fluted arch, the monochrome vortex and sphere, small pill buttons, the "Powering the *next* generation" rhythm |
| **R2 "FIND"** | Scroll as a camera through a world; type as a window onto imagery; a light ↔ dark chapter change; a large typographic services list with images under the words | The cloud-to-city descent as a literal sequence, the scrambled headline, the chevron image masks, the giant cropped footer wordmark |
| **R3 "Creative Digital Experiences"** | Content placed along the camera path; nature meeting precise screens; AI as a way into the site | Pixel/dot-matrix type, neon-purple space, particle flora, glassy rounded project cards, glitch dissolves |

VORA's own signatures — **the survey line, apertures and instrument labels, in a stone, water and
light world** — appear in none of the references.

---

## Appendix C — Open items this document depends on

| # | Item | Needed from you | Until then |
|---|---|---|---|
| D5 | Is the eye/star mark VORA's logo? SVG master | Yes/no + file | Text wordmark; palette already derived from the mark |
| D9 | Blender Phase 2/2.2 files and renders | Files | Home ships as the T0 typographic stations |
| D10 | Commercial typefaces | Budget decision | Archivo, Newsreader and DM Mono (open source) |
| D13 | Testimonials | Confirmed, approved quotes | QuoteBlock off for testimonials |
| D15 | Enquiry budget ranges | The ranges | The budget field hidden |
| **D18** | A "Design" page | (a) CMS service entry or (b) part of Websites | (b) |
| **D19** | A Journal | Build it now or defer | Deferred; the design is specified |
| — | Case-study material for SAIL Gaming and EON Clothing (captures, year, scope, credits, client approval) | Material | Drafts stay unpublished; Work shows its empty state |
| — | *Slot* copy: positioning line, Approach sentences, per-page invitations, service bodies, Our Story paragraphs, partner principle bodies | Copy or approval of drafts | Slots stay marked in the CMS as drafts |
| — | Motion preference cookie `vora_motion` (§8.10) | Approval (it must be listed on the Cookies page) | The OS setting only |
| — | `dominantColor` on media assets (§9.7) | Approval of a small schema addition | A neutral `basalt-900` placeholder |
| — | Optional Cloudflare Web Analytics (§14) | Approval | Off |
