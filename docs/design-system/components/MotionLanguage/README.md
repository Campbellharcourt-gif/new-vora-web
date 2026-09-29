# MotionLanguage

The motion system in one place: line-mask text, the aperture opening, the drawn hairline and the capped row stagger — and the same shot in reduced motion.

**Tokens**

- `dur-micro` 120 · `dur-fast` 200 · `dur-base` 320 · `dur-medium` 560 · `dur-slow` 900 · `dur-cinematic` 1400 ms.
- `ease-out` for entrances, `ease-in-out` for moves and morphs, `ease-in` for exits only.

**Rules**

- Content never waits for motion.
- One gesture per shot.
- Reveal once.
- Only `transform`, `opacity` and `clip-path`.
- Stagger 40 ms between lines and 60 ms between items, capped at 320 ms in total.
- Nothing bounces, glows or follows the cursor, and there is no custom cursor.

**Reduced motion (T0)** is a first-class version: content appears in place, pins and parallax go, and focus and feedback states stay.

**Tools:**

- CSS transitions for states;
- a tiny IntersectionObserver helper (`VORA.reveal`) for reveals;
- View Transitions for route changes;
- GSAP ScrollTrigger (lazy) only where a sequence is scrubbed;
- Lenis only at the top tiers on fine pointers.
