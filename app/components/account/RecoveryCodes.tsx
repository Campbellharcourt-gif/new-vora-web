import { Link } from "react-router";
import { Notice } from "~/components/ui/forms";

/** Shows freshly generated recovery codes exactly once, with clear guidance. */
export function RecoveryCodes({
  codes,
  continueTo,
}: {
  codes: readonly string[];
  continueTo?: string;
}) {
  return (
    <section aria-labelledby="recovery-title" className="stack">
      <h2 id="recovery-title" style={{ fontSize: "var(--text-xl)" }}>
        Save your recovery codes
      </h2>
      <Notice tone="warning">
        These codes are shown only once. Store them somewhere safe (a password manager is ideal).
        Each code signs you in once if you can't access your email.
      </Notice>
      <ul
        aria-label="Recovery codes"
        style={{
          listStyle: "none",
          padding: "var(--space-4)",
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "var(--space-2) var(--space-4)",
          fontFamily: "var(--font-mono)",
          border: "1px solid var(--color-line-strong)",
          borderRadius: "var(--radius-s)",
        }}
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      {continueTo ? (
        <p>
          <Link to={continueTo}>I've saved my codes — continue</Link>
        </p>
      ) : null}
    </section>
  );
}
