/**
 * The system's icons: 16 px, 1.5 px stroke, square caps (design system §6.2). The font subsets
 * have no arrow glyphs, so arrows are always these SVGs. Decorative: the text carries meaning.
 */
export function ArrowRight({ size }: { size?: 20 }) {
  return (
    <svg
      className={size ? "v-icon v-icon--20" : "v-icon"}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1.5 8h12M9.5 4l4 4-4 4" />
    </svg>
  );
}

export function ArrowLeft() {
  return (
    <svg className="v-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M14.5 8h-12M6.5 4l-4 4 4 4" />
    </svg>
  );
}

export function ArrowUpRight() {
  return (
    <svg className="v-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 12l8-8M5.5 4H12v6.5" />
    </svg>
  );
}

export function ErrorIcon() {
  return (
    <svg className="v-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.5l6.5 12h-13z M8 6v3.5 M8 11.2v.8" />
    </svg>
  );
}
