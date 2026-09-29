import { enquiryFromFormData } from "@shared/validation/enquiry";
import { useEffect, useRef } from "react";
import { Form, useActionData, useNavigation, useRouteLoaderData } from "react-router";
import { actionError, formString, load } from "~/.server/guards";
import { getEnquiryFormConfig, submitEnquiry } from "~/.server/services/enquiries";
import { getSetting } from "~/.server/services/settings";
import {
  Button,
  Checkbox,
  ChoiceGroup,
  ErrorSummary,
  Select,
  TextArea,
  TextField,
} from "~/components/ui/forms";
import type { loader as rootLoader } from "~/root";
import type { Route } from "./+types/contact";
import styles from "./site.module.css";

export async function loader({ context }: Route.LoaderArgs) {
  const { server } = load(context);
  const [form, emails] = await Promise.all([
    getEnquiryFormConfig(server),
    getSetting(server, "contact.emails"),
  ]);
  // Turnstile is rendered only when the server can actually verify it.
  const turnstileSiteKey = server.config.turnstile.secretKey ? form.turnstileSiteKey : null;
  return { ...form, turnstileSiteKey, projectsEmail: emails.projects };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { server } = load(context);
  const form = await request.formData();
  try {
    const outcome = await submitEnquiry(server, {
      fields: enquiryFromFormData(form),
      formToken: formString(form, "formToken"),
      honeypot: formString(form, "nickname"),
      turnstileToken: formString(form, "cf-turnstile-response") || null,
    });
    return { ok: true as const, reference: outcome.kind === "accepted" ? outcome.reference : null };
  } catch (error) {
    return actionError(error);
  }
}

export function meta(): Route.MetaDescriptors {
  return [
    { title: "Start a project — VORA" },
    { name: "description", content: "Tell VORA about your project." },
  ];
}

export default function Contact({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const nonce = useRouteLoaderData<typeof rootLoader>("root")?.nonce;
  const summaryRef = useRef<HTMLDivElement>(null);
  const fields = result && !result.ok ? result.fields : {};

  useEffect(() => {
    if (result && !result.ok)
      summaryRef.current?.querySelector<HTMLElement>("[role=alert]")?.focus();
  }, [result]);

  if (result?.ok) {
    return (
      <section className={`container ${styles.page}`} aria-labelledby="thanks">
        <div className={styles.pageHeader}>
          <p className="label">Enquiry received</p>
          <h1 id="thanks" tabIndex={-1}>
            Thank you.
          </h1>
          <p>Your enquiry has been received and will be reviewed by the VORA team.</p>
          {result.reference ? (
            <p className="muted">
              Your reference is <strong>{result.reference}</strong>. A confirmation email is on its
              way.
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className={`container ${styles.page}`} aria-labelledby="contact-title">
      <header className={styles.pageHeader}>
        <p className="label">Contact</p>
        <h1 id="contact-title">Start a project</h1>
        <p className="muted">
          Tell us what you're planning. Prefer email? Write to{" "}
          <a href={`mailto:${loaderData.projectsEmail}`}>{loaderData.projectsEmail}</a>.
        </p>
      </header>

      <Form method="post" className={styles.formGrid} noValidate>
        <div ref={summaryRef}>
          {result && !result.ok ? (
            <ErrorSummary message={result.message} fields={result.fields} />
          ) : null}
        </div>

        <input type="hidden" name="formToken" value={loaderData.formToken} />
        <div className={styles.honeypot} aria-hidden="true">
          <label>
            Leave this field empty
            <input type="text" name="nickname" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <div className={styles.twoCol}>
          <TextField
            name="name"
            label="Your name"
            required
            autoComplete="name"
            maxLength={120}
            error={fields.name}
          />
          <TextField
            name="email"
            label="Email"
            type="email"
            required
            autoComplete="email"
            maxLength={254}
            error={fields.email}
          />
        </div>
        <div className={styles.twoCol}>
          <TextField
            name="company"
            label="Company or organisation"
            autoComplete="organization"
            maxLength={160}
            error={fields.company}
          />
          <TextField
            name="website"
            label="Current website"
            type="url"
            inputMode="url"
            autoComplete="url"
            maxLength={2048}
            error={fields.website}
          />
        </div>

        <ChoiceGroup
          type="checkbox"
          name="projectTypes"
          label="What do you need?"
          required
          options={loaderData.projectTypes}
          error={fields.projectTypes}
        />

        {loaderData.budgets.length > 0 ? (
          <Select name="budget" label="Budget" options={loaderData.budgets} error={fields.budget} />
        ) : null}

        <ChoiceGroup
          type="radio"
          name="timeline"
          label="Timeline"
          required
          options={loaderData.timelines}
          error={fields.timeline}
        />
        <TextField
          name="timelineDate"
          label="Target date"
          type="date"
          hint="Only needed if you chose “By a specific date”."
          error={fields.timelineDate}
        />

        <TextArea
          name="message"
          label="About the project"
          required
          minLength={20}
          maxLength={5000}
          rows={8}
          hint="Goals, audience, scope, anything we should know."
          error={fields.message}
        />

        {loaderData.sources.length > 0 ? (
          <div className={styles.twoCol}>
            <Select
              name="source"
              label="How did you hear about VORA?"
              options={loaderData.sources}
              error={fields.source}
            />
            <TextField
              name="sourceDetail"
              label="Details"
              maxLength={200}
              error={fields.sourceDetail}
            />
          </div>
        ) : null}

        <Checkbox
          name="consent"
          required
          error={fields.consent}
          label={
            <>
              I've read the <a href="/privacy">privacy notice</a> and agree to VORA using these
              details to respond to my enquiry.
            </>
          }
        />

        {loaderData.turnstileSiteKey ? (
          <>
            <div
              className="cf-turnstile"
              data-sitekey={loaderData.turnstileSiteKey}
              data-action="enquiry"
            />
            <script
              src="https://challenges.cloudflare.com/turnstile/v0/api.js"
              async
              defer
              nonce={nonce}
            />
            <noscript>
              <p className="muted">
                This form needs JavaScript for spam protection. You can email{" "}
                <a href={`mailto:${loaderData.projectsEmail}`}>{loaderData.projectsEmail}</a>{" "}
                instead.
              </p>
            </noscript>
          </>
        ) : null}

        <div>
          <Button busy={busy}>{busy ? "Sending…" : "Send enquiry"}</Button>
        </div>
      </Form>
    </section>
  );
}
