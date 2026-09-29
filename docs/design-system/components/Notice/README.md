# Notice

A hairline box with a status square, a DM Mono label and one sentence: inline notices, maintenance banners, and portal confirmations.

**The consumer provides:** the kind (`NOTICE`, `ERROR`, `SAVED`), one sentence that says what happened and what to do, and an optional link.

**Rules**

- No tinted backgrounds on the public site and no coloured side-stripes.
- Toasts (portals only) sit bottom-left, one at a time, `aria-live="polite"`. They dismiss after 5 s, except errors.
- Errors explain the fix without apologising.
