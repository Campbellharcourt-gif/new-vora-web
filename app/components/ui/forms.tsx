import { createContext, type ReactNode, useContext, useEffect, useId, useState } from "react";
import { ArrowRight } from "~/components/vora/icons";

/**
 * Accessible form controls in the VORA system (design system §7.10–§7.11): visible labels,
 * hints and errors linked with aria-describedby, aria-invalid on invalid fields, an error
 * summary that lists each problem and links to its field, 48 px controls, 16 px input text.
 *
 * Inside a <FormScope prefix="…">, field ids are `${prefix}-${name}`, so the error summary can
 * link to them; elsewhere ids come from useId() (unique even with repeated field names).
 */
const ScopeContext = createContext<string | null>(null);

export function FormScope({ prefix, children }: { prefix: string; children: ReactNode }) {
  return <ScopeContext.Provider value={prefix}>{children}</ScopeContext.Provider>;
}

function useFieldId(name: string, explicit?: string): string {
  const scope = useContext(ScopeContext);
  const generated = useId();
  return explicit ?? (scope ? `${scope}-${name}` : generated);
}

interface BaseFieldProps {
  name: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  id?: string;
}

function describedBy(id: string, hint?: string, error?: string, extra?: string) {
  return (
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null, extra ?? null]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

function FieldLabel({
  htmlFor,
  label,
  required,
}: {
  htmlFor: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="v-field__label">
      {label}
      {required ? null : <span className="v-field__optional"> (optional)</span>}
    </label>
  );
}

function Hint({ id, hint }: { id: string; hint?: string }) {
  return hint ? (
    <p id={`${id}-hint`} className="v-field__hint">
      {hint}
    </p>
  ) : null;
}

/**
 * The error in words, with an icon whose accessible name is "Error" — so it is never colour
 * alone, and the element's text stays exactly the message.
 */
export function FieldError({ id, error }: { id: string; error?: string | undefined }) {
  return error ? (
    <p className="v-field__error">
      <svg className="v-icon" viewBox="0 0 16 16" role="img" aria-label="Error:" focusable="false">
        <path d="M8 1.5l6.5 12h-13z M8 6v3.5 M8 11.2v.8" />
      </svg>
      <span id={`${id}-error`}>{error}</span>
    </p>
  ) : null;
}

export function TextField(
  props: BaseFieldProps & {
    type?: "text" | "email" | "password" | "url" | "tel" | "date";
    defaultValue?: string;
    autoComplete?: string;
    inputMode?: "text" | "numeric" | "email" | "url";
    maxLength?: number;
    minLength?: number;
    pattern?: string;
    autoFocus?: boolean;
    spellCheck?: boolean;
    disabled?: boolean;
    /** One-time codes and recovery codes: DM Mono, tracked out. */
    code?: boolean;
  },
) {
  const { name, label, hint, error, required, type = "text", id: explicit, code, ...rest } = props;
  const id = useFieldId(name, explicit);
  return (
    <div className="v-field">
      <FieldLabel htmlFor={id} label={label} required={required} />
      <Hint id={id} hint={hint} />
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={code ? "v-input v-input--code" : "v-input"}
        {...rest}
      />
      <FieldError id={id} error={error} />
    </div>
  );
}

/** A character counter that speaks politely only near the limit (§7.11). */
function Counter({ id, target, max }: { id: string; target: string; max: number }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const el = document.getElementById(target) as HTMLTextAreaElement | null;
    if (!el) return;
    const update = () => setCount(el.value.length);
    update();
    el.addEventListener("input", update);
    return () => el.removeEventListener("input", update);
  }, [target]);
  if (count === null) return null;
  const near = count >= max * 0.9;
  return (
    <span id={id} className="v-counter" aria-live={near ? "polite" : "off"}>
      {count} / {max}
    </span>
  );
}

export function TextArea(
  props: BaseFieldProps & {
    defaultValue?: string;
    rows?: number;
    maxLength?: number;
    minLength?: number;
    counter?: boolean;
  },
) {
  const { name, label, hint, error, required, rows = 6, id: explicit, counter, ...rest } = props;
  const id = useFieldId(name, explicit);
  return (
    <div className="v-field">
      <FieldLabel htmlFor={id} label={label} required={required} />
      <Hint id={id} hint={hint} />
      <textarea
        id={id}
        name={name}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className="v-textarea"
        {...rest}
      />
      {counter && rest.maxLength ? (
        <Counter id={`${id}-count`} target={id} max={rest.maxLength} />
      ) : null}
      <FieldError id={id} error={error} />
    </div>
  );
}

export function Select(
  props: BaseFieldProps & {
    options: readonly { key: string; label: string }[];
    defaultValue?: string;
    placeholder?: string;
  },
) {
  const {
    name,
    label,
    hint,
    error,
    required,
    options,
    defaultValue,
    placeholder = "Choose…",
    id: explicit,
  } = props;
  const id = useFieldId(name, explicit);
  return (
    <div className="v-field">
      <FieldLabel htmlFor={id} label={label} required={required} />
      <Hint id={id} hint={hint} />
      <span className="v-selectwrap">
        <select
          id={id}
          name={name}
          required={required}
          defaultValue={defaultValue ?? ""}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className="v-select"
        >
          <option value="" disabled={required}>
            {placeholder}
          </option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
      <FieldError id={id} error={error} />
    </div>
  );
}

/** Checkboxes and radios as full-width hairline rows inside a fieldset with a legend. */
export function ChoiceGroup(
  props: BaseFieldProps & {
    type: "checkbox" | "radio";
    options: readonly { key: string; label: string }[];
    defaultValues?: readonly string[];
  },
) {
  const {
    name,
    label,
    hint,
    error,
    required,
    type,
    options,
    defaultValues = [],
    id: explicit,
  } = props;
  const id = useFieldId(name, explicit);
  return (
    <fieldset
      className="v-fieldset"
      aria-describedby={describedBy(id, hint, error)}
      aria-invalid={error ? true : undefined}
      style={{ gap: "var(--space-3)" }}
    >
      <legend className="v-field__label">
        {label}
        {required ? null : <span className="v-field__optional"> (optional)</span>}
      </legend>
      <Hint id={id} hint={hint} />
      <div className="v-choices">
        {options.map((o, i) => (
          <label key={o.key} className="v-choice">
            <input
              id={i === 0 ? id : `${id}-${i}`}
              type={type}
              name={name}
              value={o.key}
              defaultChecked={defaultValues.includes(o.key)}
              required={type === "radio" ? required : undefined}
              aria-invalid={error ? true : undefined}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <FieldError id={id} error={error} />
    </fieldset>
  );
}

export function Checkbox(props: {
  name: string;
  label: ReactNode;
  error?: string | undefined;
  required?: boolean;
  defaultChecked?: boolean;
  id?: string;
}) {
  const id = useFieldId(props.name, props.id);
  return (
    <div className="v-field">
      <label className="v-choice v-choice--plain" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          name={props.name}
          required={props.required}
          defaultChecked={props.defaultChecked}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={props.error ? `${id}-error` : undefined}
        />
        <span>{props.label}</span>
      </label>
      <FieldError id={id} error={props.error} />
    </div>
  );
}

export function Button(props: {
  children: ReactNode;
  type?: "submit" | "button";
  variant?: "primary" | "secondary" | "danger" | "quiet";
  size?: "s" | "m" | "l";
  busy?: boolean;
  name?: string;
  value?: string;
  disabled?: boolean;
  block?: boolean;
  arrow?: boolean;
  form?: string;
  onClick?: () => void;
}) {
  const {
    children,
    type = "submit",
    variant = "primary",
    size = "m",
    busy,
    block,
    arrow = variant === "primary" && size !== "s",
    ...rest
  } = props;
  const classes = [
    "v-btn",
    `v-btn--${variant}`,
    size !== "m" ? `v-btn--${size}` : null,
    block ? "v-btn--block" : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type={type}
      className={classes}
      aria-busy={busy ? true : undefined}
      disabled={busy || rest.disabled}
      {...rest}
    >
      {children}
      {arrow ? <ArrowRight /> : null}
    </button>
  );
}

/**
 * The error summary (§7.11): an ERROR label with the count, the form-level message, and a link
 * to each field. It is the form's one alert and takes focus (existing behaviour).
 */
export function ErrorSummary({
  message,
  fields,
}: {
  message?: string | undefined;
  fields?: Record<string, string>;
}) {
  const scope = useContext(ScopeContext);
  const entries = Object.entries(fields ?? {}).filter(([key]) => key !== "_form");
  const formMessage = fields?._form ?? message;
  if (!formMessage && entries.length === 0) return null;
  const count = entries.length;
  return (
    <div className="v-errsum" role="alert" tabIndex={-1}>
      <p className="v-label">
        Error{count > 0 ? ` · ${count} ${count === 1 ? "problem" : "problems"}` : ""}
      </p>
      {formMessage ? <p className="v-body-s">{formMessage}</p> : null}
      {entries.length > 0 ? (
        <ul className="v-body-s">
          {entries.map(([key, value]) => (
            <li key={key}>{scope ? <a href={`#${scope}-${key}`}>{value}</a> : value}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const NOTICE_LABEL = { info: "Notice", success: "Done", warning: "Notice", error: "Error" };
const NOTICE_KIND = { info: "info", success: "ok", warning: "warn", error: "down" };

/** A hairline box with a status square, a DM Mono label and one sentence (§7.14). */
export function Notice({
  tone = "info",
  label,
  children,
}: {
  tone?: "info" | "success" | "warning" | "error";
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="v-notice" role={tone === "info" ? "status" : "alert"}>
      <span className={`v-status v-status--${NOTICE_KIND[tone]}`}>
        {label ?? NOTICE_LABEL[tone]}
      </span>
      <div>{children}</div>
    </div>
  );
}
