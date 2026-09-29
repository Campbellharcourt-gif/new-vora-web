# Motion

Motion is the camera, the light and the craftsman's hand. It reveals hierarchy, gives feedback, links pages and sets atmosphere — nothing else.

## Rules

1. **Content never waits for motion.** Text is in the HTML and readable at first paint. The likely LCP element animates from an already-visible state, never from `opacity: 0`, and a safety timeout shows everything if scripts are slow.
2. **One gesture per shot.** The headline, the aperture *or* the line leads; everything else follows quietly.
3. **Entrances ease out, exits ease in,** and exits are faster (about 60% of the entrance).
4. **Nothing bounces, overshoots, spins, glows or follows the cursor.** There is no custom cursor.
5. **Reveal once.** Scrubbed sequences reverse naturally; entrances don't replay.
6. **Animate only `transform`, `opacity` and `clip-path`,** plus colour for state changes.

## Tokens

| Token | Use |
|---|---|
| `dur-micro` 120 ms | Checkbox tick, colour and border changes |
| `dur-fast` 200 ms | Hover, arrow nudge, button feedback |
| `dur-base` 320 ms | Underline draw, header hide/reveal, menu close |
| `dur-medium` 560 ms | Line reveals, menu open, page transition in |
| `dur-slow` 900 ms | Aperture openings, hairline draws, image settle |
| `dur-cinematic` 1400 ms | The first shot's title settle, chapter inversions |
| `ease-out` | Entrances and reveals |
| `ease-in-out` | Camera moves, morphs, crossfades |
| `ease-in` | Exits only |

- **Distances:**
  - UI 12–24 px;
  - text rises one line height inside a mask;
  - images settle from 1.04–1.08;
  - parallax is at most 8% of the frame, inside the aperture.
- **Stagger:** 40 ms between lines and 60 ms between items, capped at 320 ms in total.
- **Portals:** only `dur-micro`, `dur-fast` and `dur-base`, with no reveals.

## Choreography

| Moment | Treatment |
|---|---|
| Page change | The old page fades out and lifts 16 px (200 ms); the new title lines rise (560 ms) and the first aperture opens 120 ms later. The header stays still. |
| Work → project | The cover aperture morphs into the case-study hero (700 ms `ease-in-out`, View Transitions) |
| Scroll reveals | Titles rise through line masks; labels fade up 8 px; hairlines draw from the left; apertures open. Body copy is not animated. |
| Scrubbed | Home station plates, the Process line, the Basalt → Mist inversion, parallax inside apertures, the reading-progress line |
| Hover | Arrow +4 px; underline draws; the image settles inside a still frame. Focus is instant. |
| Loading | No splash loader. Home shows real asset progress on a survey line; routes show the line after 150 ms; buttons sweep a 1 px line. |
| Menu | It uncovers from the top (560 ms) with a 40 ms item stagger; closes in 320 ms |

## Reduced motion (T0)

- **Triggers:** `prefers-reduced-motion`, Save-Data, or the footer toggle (`data-motion="reduced"`).
- **What changes:**
  - content appears in place (or with a fade of at most 200 ms);
  - pins become normal flow;
  - parallax, smooth scrolling and autoplay stop;
  - page changes crossfade in 120 ms.
- **What stays:** content, order, focus, and the pressed, selected and error states.

## Tools

| Need | Tool |
|---|---|
| States | CSS transitions |
| Fire-once reveals | A small IntersectionObserver helper (`VORA.reveal` here) |
| Route changes | View Transitions |
| Scrubbed or pinned sequences | GSAP ScrollTrigger, lazy-loaded where used |
| Wheel smoothing | Lenis, only at the top tiers on fine pointers |

Not used: Framer Motion, Locomotive, particle libraries.
