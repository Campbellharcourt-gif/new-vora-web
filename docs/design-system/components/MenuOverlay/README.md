# MenuOverlay

The full-screen menu below 1024 px: five destinations set large, the Start a project button, and the contact lines.

**The consumer provides:** the destinations (the `NAV` array), the contact addresses from settings, and the social links from the `social_links` table.

**Behaviour**

- It is a dialog (`aria-modal="true"`, labelled "Menu"). Focus moves to the first item and is trapped; `Esc` closes it and focus returns to the Menu button; the page behind is `inert`.
- **Open:** the layer uncovers from the top (560 ms) and the items rise through line masks with a 40 ms stagger. Items are usable immediately.
- **Close:** 320 ms, no stagger.
- **Reduced motion:** a 120 ms fade.
- **Without JavaScript** it is the server-rendered `<details>` menu that exists today.
