# Button

Buttons do one thing each: primary for the one main action on a screen, secondary for alternatives, quiet for low-emphasis actions in rows and toolbars.

**The consumer provides:** a verb-first, sentence-case label ("Start a project", "Send enquiry", "Sign in"), the variant, the size (`s` 40 px in the header and toolbars, `m` 48 px by default, `l` 56 px for the closing invitation) and, for loading, the progress word ("Sending…").

**States**

- **Hover** (fine pointers): primary → `color-action-bg-hover`; secondary border → `color-text`; the arrow moves 4 px.
- **Pressed:** 1 px down, `color-action-bg-pressed`.
- **Focus:** the 2 px `color-focus` outline at a 3 px offset.
- **Disabled:** `aria-disabled="true"` with the reason written next to it; `color-disabled-bg` / `color-disabled-text`.
- **Loading:** `aria-busy="true"`, the width is locked, the label changes to the progress word and a 1 px line sweeps the bottom edge.

**Don't:** pills, gradients, glows, ripples, magnetic effects, icon-only public buttons, or more than one primary per screen. Danger buttons exist in the portals only, always followed by a confirmation.
