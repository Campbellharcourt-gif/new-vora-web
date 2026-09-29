# SiteHeader

The public header: the wordmark, five destinations and the Start a project button, quiet enough never to compete with the shot behind it.

**The consumer provides:** the current route (for `aria-current` and the tick) and the scroll state; the destinations come from the existing `NAV` array (Work, Services, Our Story, Partners, Careers).

**States**

- **Over the opening shot:** transparent, with a top scrim for contrast.
- **Resting:** `color-bg`, no line.
- **Scrolled:** `color-bg` at 92%, 1 px `color-line` bottom border. No backdrop blur.
- **Hidden / revealed:** it slides up while scrolling down and comes back on any upward scroll, or when focus enters it.
- **Over a Mist chapter:** it takes the Mist roles.

**Items:** the hover underline draws from the left (`dur-base`). The current section has a 12 × 2 px `color-accent` tick and `aria-current="page"`.

**Mobile (< 1024 px):** the wordmark and a text **Menu** button (see MenuOverlay). The compact CTA stays from 600 px.

**The wordmark** is set in type until the logo decision (D5) is made — never a drawn approximation.
