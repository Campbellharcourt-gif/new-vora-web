import { enquiryFromFormData } from "@shared/validation/enquiry";
import { useEffect, useRef } from "react";
import { data, Form, useActionData, useNavigation, useRouteLoaderData } from "react-router";
import { failureFrom, formString, load } from "~/.server/guards";
import { getEnquiryFormConfig, submitEnquiry } from "~/.server/services/enquiries";
import { getSetting } from "~/.server/services/settings";
import { AskVoraButton, useAskVora } from "~/components/site/AskVora";
import {
  Button,
  Checkbox,
  ChoiceGroup,
  ErrorSummary,
  FormScope,
  Select,
  TextArea,
  TextField,
} from "~/components/ui/forms";
import { Label, Lines, Slot, SurveyLine } from "~/components/vora/primitives";
import type { loader as rootLoader } from "~/root";
import type { Route } from "./+types/contact";

export async function loader({ context }: Route.LoaderArgs) {
  const { server } = load(context);
  const [form, emails] = await Promise.all([
    getEnquiryFormConfig(server),
    getSetting(server, "contact.emails"),
  ]);
  // Turnstile is rendered only when the server can actually verify it.
  const turnstileSiteKey = server.config.turnstile.secretKey ? form.turnstileSiteKey : null;
  return { ...form, turnstileSiteKey, emails };
}

/** What the visitor typed, echoed back on a failed submit so nothing is lost (WCAG 3.3.7). */
function submittedValues(form: FormData) {
  const one = (key: string) => formString(form, key);
  return {
    name: one("name"),
    email: one("email"),
    company: one("company"),
    website: one("website"),
    projectTypes: form.getAll("projectTypes").filter((v): v is string => typeof v === "string"),
    budget: one("budget"),
    timeline: one("timeline"),
    timelineDate: one("timelineDate"),
    message: one("message"),
    source: one("source"),
    sourceDetail: one("sourceDetail"),
    consent: one("consent") !== "",
  };
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
    const failure = failureFrom(error);
    return data(
      {
        ok: false as const,
        message: failure.message,
        fields: failure.fields,
        values: submittedValues(form),
      },
      { status: failure.status },
    );
  }
}

export function meta(): Route.MetaDescriptors {
  return [
    { title: "Start a project — VORA" },
    { name: "description", content: "Tell VORA about your project." },
  ];
}

/** The timeline option that enables the target date (the enquiry.options default key). */
const SPECIFIC_DATE = "specific_date";

/**
 * Contact — Start a project (§16.10, §7.10): a sticky context column and the enquiry form in
 * four labelled sections; the form is replaced in place by the success state with the reference.
 */
export default function Contact({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const nonce = useRouteLoaderData<typeof rootLoader>("root")?.nonce;
  const summaryRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const failed = result && !result.ok ? result : null;
  const fields = failed?.fields ?? {};
  const values = failed?.values;
  const { emails } = loaderData;
  const assistant = useAskVora();

  useEffect(() => {
    if (result && !result.ok)
      summaryRef.current?.querySelector<HTMLElement>("[role=alert]")?.focus();
    if (result?.ok) document.getElementById("thanks")?.focus();
  }, [result]);

  // The target date is enabled only when "By a specific date" is chosen (no-JS: always on).
  const hasSpecificDate = loaderData.timelines.some((t) => t.key === SPECIFIC_DATE);
  useEffect(() => {
    const form = formRef.current;
    if (!form || !hasSpecificDate) return;
    const date = form.elements.namedItem("timelineDate") as HTMLInputElement | null;
    const sync = () => {
      const chosen = (form.elements.namedItem("timeline") as RadioNodeList | null)?.value;
      if (date) date.disabled = chosen !== SPECIFIC_DATE;
    };
    sync();
    form.addEventListener("change", sync);
    return () => form.removeEventListener("change", sync);
  }, [hasSpecificDate]);

  const context = (
    <aside className="v-contact__context" aria-label="About your enquiry">
      <div className="v-stack" style={{ gap: "var(--space-3)" }}>
        <Label>What happens next</Label>
        <p className="v-body-s">
          <Slot>What happens after sending — copy slot (no invented response times)</Slot>
        </p>
      </div>
      {assistant.available ? (
        <div className="v-stack" style={{ gap: "var(--space-2)" }}>
          <Label>A question first</Label>
          <p>
            <AskVoraButton className="v-btn v-btn--secondary v-btn--s" />
          </p>
        </div>
      ) : null}
      <dl>
        <div>
          <dt className="v-label">General enquiries</dt>
          <dd>
            <a className="v-link" href={`mailto:${emails.general}`}>
              {emails.general}
            </a>
          </dd>
        </div>
        <div>
          <dt className="v-label">Careers</dt>
          <dd>
            <a className="v-link" href={`mailto:${emails.careers}`}>
              {emails.careers}
            </a>
          </dd>
        </div>
        <div>
          <dt className="v-label">Existing clients</dt>
          <dd>
            <a className="v-link" href={`mailto:${emails.support}`}>
              {emails.support}
            </a>
          </dd>
        </div>
      </dl>
    </aside>
  );

  if (result?.ok) {
    return (
      <div className="v-container">
        <section className="v-opening" aria-labelledby="thanks" data-reveal="">
          <Label>Enquiry received</Label>
          <h1 id="thanks" className="v-display-m" tabIndex={-1}>
            Thank you.
          </h1>
          <p className="v-body">
            Your enquiry has been received and will be reviewed by the VORA team.
          </p>
          {result.reference ? (
            <p className="v-body-s">
              Your reference is <strong className="v-data">{result.reference}</strong>. A
              confirmation email is on its way.
            </p>
          ) : null}
          <SurveyLine variant="draw" strong style={{ width: "12rem" }} />
        </section>
        <div className="v-contact">{context}</div>
      </div>
    );
  }

  return (
    <div className="v-container">
      <header className="v-opening" data-reveal="">
        <Label fade>Contact</Label>
        <Lines as="h1" className="v-display-l" lines={["Start a project"]} />
        <p className="v-lead v-fade">
          Tell us what you're planning. Prefer email? Write to{" "}
          <a className="v-link" href={`mailto:${emails.projects}`}>
            {emails.projects}
          </a>
          .
        </p>
      </header>

      <div className="v-contact">
        <div className="v-contact__form">
          <FormScope prefix="enquiry">
            <Form method="post" className="v-form" noValidate ref={formRef}>
              <div ref={summaryRef}>
                {failed ? <ErrorSummary message={failed.message} fields={failed.fields} /> : null}
              </div>

              <input type="hidden" name="formToken" value={loaderData.formToken} />
              <div className="v-honeypot" aria-hidden="true">
                <label>
                  Leave this field empty
                  <input type="text" name="nickname" tabIndex={-1} autoComplete="off" />
                </label>
              </div>

              <fieldset className="v-fieldset">
                <legend className="v-label">01 — About you</legend>
                <TextField
                  name="name"
                  label="Your name"
                  required
                  autoComplete="name"
                  maxLength={120}
                  defaultValue={values?.name}
                  error={fields.name}
                />
                <TextField
                  name="email"
                  label="Email"
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={254}
                  defaultValue={values?.email}
                  error={fields.email}
                />
                <TextField
                  name="company"
                  label="Company or organisation"
                  autoComplete="organization"
                  maxLength={160}
                  defaultValue={values?.company}
                  error={fields.company}
                />
                <TextField
                  name="website"
                  label="Current website"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  maxLength={2048}
                  defaultValue={values?.website}
                  error={fields.website}
                />
              </fieldset>

              <fieldset className="v-fieldset">
                <legend className="v-label">02 — The project</legend>
                <ChoiceGroup
                  type="checkbox"
                  name="projectTypes"
                  label="What do you need?"
                  required
                  options={loaderData.projectTypes}
                  defaultValues={values?.projectTypes}
                  error={fields.projectTypes}
                />
                <TextArea
                  name="message"
                  label="About the project"
                  required
                  minLength={20}
                  maxLength={5000}
                  rows={8}
                  counter
                  hint="Goals, audience, scope, anything we should know."
                  defaultValue={values?.message}
                  error={fields.message}
                />
              </fieldset>

              <fieldset className="v-fieldset">
                <legend className="v-label">03 — Budget and timing</legend>
                {loaderData.budgets.length > 0 ? (
                  <Select
                    name="budget"
                    label="Budget"
                    options={loaderData.budgets}
                    defaultValue={values?.budget}
                    error={fields.budget}
                  />
                ) : null}
                <ChoiceGroup
                  type="radio"
                  name="timeline"
                  label="Timeline"
                  required
                  options={loaderData.timelines}
                  defaultValues={values?.timeline ? [values.timeline] : []}
                  error={fields.timeline}
                />
                <TextField
                  name="timelineDate"
                  label="Target date"
                  type="date"
                  hint="Only needed if you chose “By a specific date”."
                  defaultValue={values?.timelineDate}
                  error={fields.timelineDate}
                />
              </fieldset>

              <fieldset className="v-fieldset">
                <legend className="v-label">04 — Finally</legend>
                {loaderData.sources.length > 0 ? (
                  <>
                    <Select
                      name="source"
                      label="How did you hear about VORA?"
                      options={loaderData.sources}
                      defaultValue={values?.source}
                      error={fields.source}
                    />
                    <TextField
                      name="sourceDetail"
                      label="Details"
                      maxLength={200}
                      defaultValue={values?.sourceDetail}
                      error={fields.sourceDetail}
                    />
                  </>
                ) : null}
                <Checkbox
                  name="consent"
                  required
                  defaultChecked={values?.consent}
                  error={fields.consent}
                  label={
                    <>
                      I've read the{" "}
                      <a className="v-link" href="/privacy">
                        privacy notice
                      </a>{" "}
                      and agree to VORA using these details to respond to my enquiry.
                    </>
                  }
                />
              </fieldset>

              {loaderData.turnstileSiteKey ? (
                <div className="v-field">
                  <p className="v-field__label" id="security-check">
                    Security check
                  </p>
                  <div
                    className="cf-turnstile"
                    data-sitekey={loaderData.turnstileSiteKey}
                    data-action="enquiry"
                    data-theme="dark"
                  />
                  <script
                    src="https://challenges.cloudflare.com/turnstile/v0/api.js"
                    async
                    defer
                    nonce={nonce}
                  />
                  <noscript>
                    <p className="v-body-s">
                      This form needs JavaScript for spam protection. You can email{" "}
                      <a className="v-link" href={`mailto:${emails.projects}`}>
                        {emails.projects}
                      </a>{" "}
                      instead.
                    </p>
                  </noscript>
                </div>
              ) : null}

              <div>
                <Button busy={busy}>{busy ? "Sending…" : "Send enquiry"}</Button>
              </div>
            </Form>
          </FormScope>
        </div>
        {context}
      </div>
    </div>
  );
}
