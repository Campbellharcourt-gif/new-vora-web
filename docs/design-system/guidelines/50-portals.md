# Portals and VORA AI

**Usability comes first in the workspace.** It shares VORA's type, colour roles and precision, but none of the cinema.

- **Theme:** always `mist` (`data-theme="workspace"` in code). DM Mono for references, IDs and timestamps.
- **Shell (WorkspaceShell):**
  - a 240 px sidebar: the area label, permission-filtered navigation, the switch-to links, Back to site, Sign out;
  - a 56 px top bar: the title, breadcrumbs and the primary action.
  - Below 1024 px, the sidebar is a drawer.
- **Patterns:**
  - **List pages:** filters (reflected in the URL), a DataTable, and pagination at 50 rows.
  - **Detail pages:** the record on the left; Update and Timeline on the right.
  - **Panels:** flat, 1 px `color-line`, `radius-s`.
  - **Destructive actions:** confirmed in a dialog.
  - **Unsaved changes:** get a sticky save bar.
- **Motion:** `dur-micro`, `dur-fast` and `dur-base` only; skeletons are flat `color-well` blocks with a slow pulse (off in reduced motion).
- **Areas:**
  - Admin: Dashboard, Enquiries, Users, System, and later the CMS editors with a Draft → Preview → Publish bar;
  - Account: Overview, Security;
  - Client portal: Engagements;
  - Member area: Welcome.

## VORA AI (switched off today — D8)

- **Public "Ask VORA" (AskVora):**
  - reached from the header, the mobile menu and Contact — a way in, not a floating widget;
  - an editorial transcript (`YOU` / `VORA AI` labels, no bubbles or avatars);
  - linked sources, a Stop button while streaming, the input counter, a permanent disclosure and a Talk to a person route.
- **Admin tools:**
  - output lands in a well labelled `AI DRAFT` and is never auto-applied or auto-published — a person accepts, edits or discards it;
  - the configuration screen puts the kill switch first;
  - the usage screen shows today's requests and tokens against the limits.
- **Never:** sparkle icons, gradient orbs or chat bubbles.
