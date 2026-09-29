# WorkspaceShell

The portal frame: a 240 px sidebar with the area label and navigation, a 56 px top bar with the page title and primary action, and flat panels — usability before cinema.

**The consumer provides:** the area (`ADMIN`, `ACCOUNT`, `CLIENT PORTAL`, `MEMBER AREA`), the permission-filtered navigation (the existing arrays), the "switch to" links, and the page content.

**Rules**

- Always the Mist/workspace roles.
- Motion only `dur-micro`, `dur-fast` and `dur-base`, with no reveals.
- Active item: a 2 px `color-accent` inset line, weight 560 and `aria-current`.
- **Below 1024 px:** the sidebar becomes a drawer (a dialog) opened from a Menu button in the top bar.
- Detail pages show breadcrumbs (`Enquiries / VR-…`).
- Destructive actions confirm in a dialog.
