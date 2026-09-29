# Navigation and page anatomy

## Header

- **Contents:**
  - the wordmark (`/`);
  - Work · Services · Our Story · Partners · Careers;
  - **Start a project** (`/contact`) as the compact secondary button;
  - a skip link first.
- **Height:** 72 px from 1024 px, 64 px from 768 px, 60 px below.
- **States:**
  - transparent over the opening shot, with a top scrim;
  - `color-bg` at rest;
  - 92% `color-bg` with a hairline once scrolled (no blur);
  - hides while scrolling down and returns on any upward scroll or when focus enters it;
  - takes the Mist roles over Mist chapters.
- **Current section:** a 12 × 2 px `color-accent` tick plus `aria-current`. Parent items keep the tick on child pages.
- **Below 1024 px:**
  - a text **Menu** button opens the full-screen MenuOverlay, which is a dialog with a focus trap, `Esc` and focus return;
  - without JavaScript, it is the existing `<details>` menu.

## Footer

- **Contents:**
  - the wordmark and the partner line;
  - site links;
  - contact addresses and social links;
  - Privacy · Terms · Cookies · Status · Sign in/Account;
  - the **Motion: Full / Reduced** toggle.
- **Not included:** back-to-top buttons, newsletter boxes, a giant cropped wordmark.

## Page anatomy (marketing pages)

1. Header.
2. Opening shot: a label, the title, and one supporting element.
3. Body: shots on the grid with alternating asymmetry and 0–2 Mist inversions.
4. The closing Invitation, written for that page. Contact has none (it is one); legal pages end with a contact line.
5. Footer.

Each page has one `h1` and uses the `header`, `nav`, `main` and `footer` landmarks.
