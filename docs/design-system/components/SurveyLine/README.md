# SurveyLine

The single 1 px hairline that is drawn, measured and extended: VORA's divider, loader, progress rule and horizon.

**Use it for:** section dividers (`color-line`), emphasised dividers (`color-line-strong`), the route and asset loading line, scroll progress on long reads, and the horizon in the opening shot.

**The consumer provides:** the variant (static, drawn on entry, determinate progress with a 0–1 value, or indeterminate) and, for progress, an accessible name (`role="progressbar"`, `aria-label`, `aria-valuenow`).

**Rules**

- Always straight, always 1 px, always on the grid. It never curls, glows or turns into decoration.
- At rest it is `color-line`; it turns `color-accent` only when it is live (progress, loading, active).
- Drawn lines grow from their origin (left) over `dur-slow` with `ease-out`, once.
- Indeterminate sweeps are for waits with no progress data only, and stop in reduced motion.
