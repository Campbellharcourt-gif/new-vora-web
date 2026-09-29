# TextLink

Links in running text are always underlined; arrow links carry navigation inside sections.

**Variants**

- **Inline:** 1 px underline at a 0.22em offset. On hover it thickens to 2 px and takes `color-accent`.
- **Arrow link:** "See the work" with a trailing arrow icon; the underline draws in on hover and the arrow moves 4 px.
- **External:** a north-east arrow icon, `rel="noopener noreferrer"`. When it opens a new tab, add the visually hidden "(opens in a new tab)".
- **Back link:** the parent section as a label above the title, with a left-arrow icon.

**Rules:** arrows are SVG icons (the font subsets have no arrow glyphs). Never rely on colour alone.
