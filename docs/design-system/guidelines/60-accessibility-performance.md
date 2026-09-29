# Accessibility and performance

## Accessibility (WCAG 2.2 AA)

| Area | Rule |
|---|---|
| Structure | Landmarks, one `h1`, heading order, a skip link; focus moves to the new `h1` after navigation |
| Keyboard | Everything operable; dialogs (menu, lightbox, AI panel, drawers) trap focus, close on `Esc` and return focus |
| Focus | A 2 px `color-focus` outline at a 3 px offset (≥ 3:1 on every surface); `scroll-padding-top` equal to the header height so focus is never hidden |
| Contrast | Text ≥ 4.5:1 (large ≥ 3:1); control boundaries `color-line-control` ≥ 3:1; text on imagery checked against the brightest area, with a scrim |
| Not colour alone | Links underlined; status = square + label; errors = icon + "Error:" + text |
| Targets | 44 × 44 px controls; button equivalents for every swipe or drag |
| Forms | Visible labels, `aria-describedby` hints and errors, an error summary that takes focus, `autocomplete` tokens, input kept on errors and on form-token expiry |
| Authentication | Paste allowed, `current-password` / `new-password` / `one-time-code`, no puzzles |
| Motion | The full reduced-motion version; pause controls for movement over 5 s; nothing flashes |
| Media | Captions for speech; the 3D canvas is `aria-hidden`, with every station's meaning in text |

## Performance budgets

| Budget | Target |
|---|---|
| LCP | < 2.5 s at p75 on a mid-range phone over 4G |
| CLS / INP | < 0.05 / < 200 ms |
| HTML + critical CSS | < 50 KB gzipped |
| JS before interaction | < 120 KB gzipped |
| Lazy chunks | GSAP + ScrollTrigger ≈ 45 KB only where scrubbing is used; Three.js ≈ 150 KB only at the top tiers on Home |
| Fonts | 3 WOFF2 files, ≈ 161 KB in total; only Archivo is preloaded |
| Images | First-shot poster ≤ 150 KB on mobile / ≤ 300 KB on desktop; tiles ≤ 120 KB |
| Video | Loops ≤ 4 MB on mobile / ≤ 8 MB on desktop |
