import { Notice } from "~/components/ui/forms";
import { ArrowLink } from "~/components/vora/primitives";

/** Shows freshly generated recovery codes exactly once, with clear guidance. */
export function RecoveryCodes({
  codes,
  continueTo,
}: {
  codes: readonly string[];
  continueTo?: string;
}) {
  return (
    <section aria-labelledby="recovery-title" className="v-stack" style={{ gap: "var(--space-5)" }}>
      <h2 id="recovery-title" className="v-heading-m">
        Save your recovery codes
      </h2>
      <Notice tone="warning">
        These codes are shown only once. Store them somewhere safe (a password manager is ideal).
        Each code signs you in once if you can't access your email.
      </Notice>
      <ul aria-label="Recovery codes" className="v-codes">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      {continueTo ? (
        <p>
          <ArrowLink to={continueTo}>I've saved my codes — continue</ArrowLink>
        </p>
      ) : null}
    </section>
  );
}
