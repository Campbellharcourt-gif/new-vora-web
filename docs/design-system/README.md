**Status: proposal under review.** Treat every value as provisional until the open decisions are
settled: D5 (logo), D9 (hero renders), D10 (commercial typefaces), D13 (testimonials), D18
("Design" page) and D19 (Journal).

VORA designs and builds websites and digital platforms. The visual idea is **digital architecture
in natural light**: precise structures set into a calm landscape of stone, water, mist and
controlled sunlight. Everything on screen is either *built* (type, grid, hairlines, apertures) or
*lit* (imagery, film, the environment). Nothing is decorated.

## Content and voice

- **Real content only.** Never invent a client, project, statistic, quote or logo. Where copy
  doesn't exist yet, mark it as a slot (`v-slot`) and leave it for a person to write.
- **Composed, confident, exact.** Short sentences in plain words, written in UK English.
  - No hype words: Unlock, Elevate, Seamless, Next-level.
  - No emoji, and no exclamation-mark enthusiasm.
- **Sentence case** everywhere — headings, navigation, buttons ("Start a project", "Send
  enquiry"). UPPERCASE only in DM Mono labels.
- **Name things the way the site already does:** Work, Services, Our Story, Partners, Careers,
  Contact.
  - The services are Websites, Branding, Motion and Film.
  - The partner line is "Creative by Solara. Digital by VORA.".
  - The process is Discover, Define, Design, Develop, Refine, Launch.
- **Instrument labels** carry real metadata only: `02 — SERVICES`, `ESPORTS`, `01 — ABOUT YOU`,
  `VR-7K2M9Q`. Never fake coordinates or "system online" theatre.
- **"Premium" is a quality bar, not a price claim.** No public price lists.

## Colour

- **Two themes:**
  - `basalt` (dark) is the default for public pages;
  - `mist` (light) is for chapter inversions (the partnership, legal pages) and for the whole
    workspace (admin and portals).
  - Switch a subtree with `data-theme="mist"`. Use at most two or three inversions per page.
- **Style components through roles, never raw palette steps:**
  - backgrounds: `color-bg`, `color-surface`, `color-surface-raised`, `color-well`;
  - text: `color-text`, `color-text-secondary`, `color-text-muted`;
  - lines: `color-line`, `color-line-strong`, `color-line-control`.
- **Text pairs meet WCAG AA in both themes** (the ratios are in each token's note). Use
  `color-text-muted` for metadata only; on `color-well` in Basalt it is 4.8:1, so keep it at 15 px
  or larger there.
- **Control boundaries** (inputs, checkboxes, secondary buttons) use `color-line-control`, which
  meets 3:1. `color-line` is decorative only.
- **The accent** (`color-accent`: `lagoon-300` on Basalt, `lagoon-800` on Mist):
  - marks state only — the active tick, selection, progress, the live survey line;
  - covers less than 5% of any screen;
  - is never a background block, gradient text or glow.
- **Gradients exist only as light:** in photography, film and the 3D environment, and as scrims
  behind text on images. No decorative gradients or mesh blobs.
- **Hover changes luminance or line, not hue:**
  - primary → `color-action-bg-hover`;
  - secondary border → `color-text`;
  - hairline → `color-line-strong`.
- **Status colours** (`color-success`, `color-warning`, `color-danger`) always come with a word or
  icon.
- **Environment-only hues:** `lagoon-100`, `lagoon-400`–`lagoon-600` and `dusk-600` belong to
  imagery grading and the 3D world, never to UI.
- **The visitor's OS colour scheme does not flip the public site;** its darkness is art direction.

## Type

- **Families:**
  - `display` — Archivo at the semi-expanded width, for the three display styles only;
  - `sans` — Archivo at normal width, for headings, body and UI;
  - `serif` — Newsreader Italic, for one emphasis word or a pull quote;
  - `mono` — DM Mono, for labels and data.
- **Styles:** display-xl / display-l / display-m, heading-l / -m / -s, lead, body, body-s, ui,
  label, data, quote. The sizes shown are the 1440 px maxima. In code they are fluid — use the
  `type-*` tokens (`clamp()`).
- **One typographic gesture per shot:** an expanded display line, *or* one italic word, *or* a
  chapter word.
- **Weight discipline:**
  - display 300–360;
  - headings 420–560;
  - body 400;
  - UI 500;
  - nothing above 600.

  Emphasis comes from scale, width and italic — not weight.
- **Measures and sizes:**
  - body at `measure` (64ch), leads at 52ch;
  - display lines set by hand with `text-wrap: balance`;
  - nothing smaller than 12 px.
- **Links in text** are always underlined (1 px at a 0.22em offset; 2 px and `color-accent` on
  hover).
- **Numerals:** tabular (`data` style) in tables, indices and statuses.
- **Glyph coverage:**
  - the font files are Latin subsets with no arrow glyphs — arrows are SVG icons;
  - Archivo's `×` is malformed at light weights above normal width, so wrap it in `v-times`
    (normal width) inside display lines.
- **In code**, Archivo is one variable file driven by `font-stretch: semi-expanded`. Here the
  semi-expanded width ships as a pinned instance (`Archivo SemiExpanded`), so every surface renders
  it without variation settings.

## Layout and spacing

- **Grid:** 4 columns below 768 px, 8 from 768 px, 12 from 1024 px, inside `container` (88rem);
  media-led chapters may use `container-wide`.
  - Outer margin `page-margin`; gutters `grid-gap`.
- **Asymmetry is the default:** text at columns 2–7 with media at 7–12, mirrored on the next shot.
  Centre only single statements (the hero, the partner line).
- **One strong alignment per shot:** labels and hairlines share the text's left edge.
- **Spacing:** use `space-1`…`space-12` only (4 px base); section rhythm uses `section-s`,
  `section-m` and `section-l`. A one-off value is a bug.
- **Full-bleed media ignores the container; text never does.**

## Shape, lines and depth

- **Radius:**
  - `radius-0` for media, apertures and sections;
  - `radius-s` (2 px) for controls, tags and portal panels;
  - `radius-round` for radio buttons only.

  No pills.
- **Hairlines:** 1 px only, no double borders, never a border plus a shadow.
- **Depth:**
  - no shadows on the public site — depth comes from light, overlap and scale;
  - in portals, `shadow-popover` for floating layers only.
- **Focus:** a 2 px `color-focus` outline at a 3 px offset on every focusable element, never
  removed. Over imagery, add `shadow-focus-halo`.

## Signature devices

1. **The survey line** — one hairline that is the divider, the loader, the progress rule and the
   horizon. Always straight and 1 px (SurveyLine).
2. **Apertures** — sharp windows onto real media that open with `clip-path`; the frame stays still
   and the view moves inside it (Aperture).
3. **Instrument labels** — DM Mono metadata paired with what it describes (InstrumentLabel).

## Imagery

- **Real work and VORA's own rendered world only:** no stock photography, no AI images presented
  as client work, no tilted-device mockups.
- **Ratios:** 21:9, 16:9, 3:2, 4:5, 9:16 (plus 1.91:1 for social images). Crops use the stored
  focal point, and portrait mobile gets its own crop.
- **Until real media exists,** show the survey-drawing plate (`v-plate`) with a slot label.

## Motion

Weighted and architectural: long `ease-out` entrances, no bounce, one gesture per shot, reveal
once, and content never waits for motion. The durations are the `dur-*` tokens and the curves are
the `ease-*` tokens. Reduced motion is a complete version of the site. See the Motion section and
the MotionLanguage preview.

## Iconography

- **Style:**
  - line icons at 16 px (20 px in portals), 1.5 px stroke, square caps, `currentColor`;
  - no fills, no duotone, no emoji, no sparkle icons.
- **The current set** is deliberately tiny and hand-drawn in the components: arrow (→), external
  (↗), back (←) and error (triangle). The source has no icon library yet. Add icons in the same
  drawing style, and every icon-only button needs an accessible name.

## Logo and mark

- **The eye/star mark** is in this system's assets (the image in the Other group). It is a white,
  single-ink mark on the lagoon light from which the palette is drawn.
  - It is **pending decision D5**: confirm it as VORA's logo and supply the SVG master.
  - The file here is a raster screenshot: use it as reference only, never in production.
  - Until the SVG master exists, never redraw, trace or approximate it.
- **Wordmark:** set **VORA** in type — the `display` family, weight about 460, 0.24em tracking.
- **Mark placement, when confirmed:**
  - single-ink (`color-text` on Basalt, `basalt-950` on Mist), or white on a lagoon image plate;
  - never on a UI gradient, never with a glow;
  - clear space of at least the mark's own height.
