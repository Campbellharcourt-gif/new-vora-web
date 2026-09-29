# DataTable

Hairline tables for the portals and the public Status page: DM Mono headers and data, tabular numerals, row hover and selection.

**The consumer provides:** column definitions (with `scope="col"` headers and a caption for screen readers), rows, and which column is primary on mobile.

**Rules**

- The header row is sticky under the portal top bar; numbers are right-aligned.
- Selection: a 2 px `color-accent` inset plus `aria-selected`.
- **Below 768 px:** each row becomes a stacked definition list headed by the primary column. No sideways scrolling for primary data.
- Paginate at 50 rows.

**Example:** the public Status components, with their real names and labels. VORA AI shows "Not in use", as it does while switched off.
