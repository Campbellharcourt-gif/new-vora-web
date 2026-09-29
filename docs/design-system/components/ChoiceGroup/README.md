# ChoiceGroup

Checkboxes and radios as full-width hairline rows inside a `fieldset` with a `legend`: the label is the click target.

**The consumer provides:** the options (project types from `ENQUIRY_PROJECT_TYPES`; timelines, budgets and sources from the `enquiry.options` setting), the legend, and any error.

**Rules**

- Checkboxes are 20 px squares at `radius-s`; radios are circles (the one sanctioned circle).
- Checked: `color-text` fill with a `color-bg` tick drawing in over `dur-micro`.
- Rows are at least 52 px tall.
- No pill "chips" for choices.
