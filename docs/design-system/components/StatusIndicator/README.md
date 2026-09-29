# StatusIndicator

An 8 px square in a status colour plus a DM Mono label — never colour alone, never pills.

**The consumer provides:** the state and its label. The labels are the existing ones:

- **Public status:** Operational · Degraded · Unavailable · Not in use.
- **Enquiries:** Received · Processing · Contacted · Qualified · Won · Lost · Archived.
- **Content:** Draft · Published · Archived, plus Changes when there are unpublished edits.

**Colours:**

- `color-success`: Operational, Qualified, Won, Published.
- `color-warning`: Degraded, Processing, Changes.
- `color-danger`: Unavailable.
- `color-accent`: Received, Contacted.
- `color-text-muted`: Not in use, Lost, Archived, Draft.
