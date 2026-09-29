# TextField

Inputs, textareas and selects: 48 px, a hairline control border that meets 3:1, the label above, the hint below, and the error in words.

**The consumer provides:** a visible label, an optional hint, the `autocomplete` token (`name`, `email`, `organization`, `url`), the error message ("Enter an email address like name@example.com") and, for textareas, the maximum length.

**States**

- **Hover:** `color-line-strong`.
- **Focus:** the border turns `color-text`, plus the focus outline.
- **Invalid:** `color-danger` border, `aria-invalid`, and the message with an icon and the word "Error".
- **Read-only / disabled:** the well fill.

**Rules**

- Inputs use 16 px text (no iOS zoom).
- Never placeholder-only labels.
- Native `<select>` and date inputs.
- The counter speaks politely only near the limit.
