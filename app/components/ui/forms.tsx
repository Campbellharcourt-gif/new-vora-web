import { type ReactNode, useId } from "react";
import styles from "./forms.module.css";

/**
 * Accessible form primitives: every control has a programmatic label, hints and errors are
 * linked with aria-describedby, and invalid fields expose aria-invalid.
 */
interface BaseFieldProps {
  name: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  required?: boolean;
}

function describedBy(id: string, hint?: string, error?: string) {
  return (
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") ||
    undefined
  );
}

function FieldMeta({ id, hint, error }: { id: string; hint?: string; error?: string | undefined }) {
  return (
    <>
      {hint ? (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className={styles.error}>
          {error}
        </p>
      ) : null}
    </>
  );
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
  },
) {
  const id = useId();
  const { name, label, hint, error, required, type = "text", ...rest } = props;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required ? null : <span className={styles.optional}> (optional)</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={styles.input}
        {...rest}
      />
      <FieldMeta id={id} hint={hint} error={error} />
    </div>
  );
}

export function TextArea(
  props: BaseFieldProps & {
    defaultValue?: string;
    rows?: number;
    maxLength?: number;
    minLength?: number;
  },
) {
  const id = useId();
  const { name, label, hint, error, required, rows = 6, ...rest } = props;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required ? null : <span className={styles.optional}> (optional)</span>}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={styles.input}
        {...rest}
      />
      <FieldMeta id={id} hint={hint} error={error} />
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
  const id = useId();
  const {
    name,
    label,
    hint,
    error,
    required,
    options,
    defaultValue,
    placeholder = "Choose…",
  } = props;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required ? null : <span className={styles.optional}> (optional)</span>}
      </label>
      <select
        id={id}
        name={name}
        required={required}
        defaultValue={defaultValue ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={styles.input}
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
      <FieldMeta id={id} hint={hint} error={error} />
    </div>
  );
}

export function ChoiceGroup(
  props: BaseFieldProps & {
    type: "checkbox" | "radio";
    options: readonly { key: string; label: string }[];
    defaultValues?: readonly string[];
  },
) {
  const id = useId();
  const { name, label, hint, error, required, type, options, defaultValues = [] } = props;
  return (
    <fieldset
      className={styles.fieldset}
      aria-describedby={describedBy(id, hint, error)}
      aria-invalid={error ? true : undefined}
    >
      <legend className={styles.label}>
        {label}
        {required ? null : <span className={styles.optional}> (optional)</span>}
      </legend>
      <div className={styles.choices}>
        {options.map((o) => (
          <label key={o.key} className={styles.choice}>
            <input
              type={type}
              name={name}
              value={o.key}
              defaultChecked={defaultValues.includes(o.key)}
              required={type === "radio" ? required : undefined}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <FieldMeta id={id} hint={hint} error={error} />
    </fieldset>
  );
}

export function Checkbox(props: {
  name: string;
  label: ReactNode;
  error?: string | undefined;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label className={styles.choice} htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          name={props.name}
          required={props.required}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={props.error ? `${id}-error` : undefined}
        />
        <span>{props.label}</span>
      </label>
      {props.error ? (
        <p id={`${id}-error`} className={styles.error}>
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

export function Button(props: {
  children: ReactNode;
  type?: "submit" | "button";
  variant?: "primary" | "secondary" | "danger";
  busy?: boolean;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const { children, type = "submit", variant = "primary", busy, ...rest } = props;
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant]}`}
      aria-busy={busy ? true : undefined}
      disabled={busy || rest.disabled}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Announces a form-level problem and lists field errors with links (focus lands here). */
export function ErrorSummary({
  message,
  fields,
}: {
  message?: string | undefined;
  fields?: Record<string, string>;
}) {
  const entries = Object.entries(fields ?? {}).filter(([key]) => key !== "_form");
  const formMessage = fields?._form ?? message;
  if (!formMessage && entries.length === 0) return null;
  return (
    <div className={styles.summary} role="alert" tabIndex={-1}>
      <p className={styles.summaryTitle}>{formMessage ?? "Please check the highlighted fields."}</p>
      {entries.length > 0 ? (
        <ul>
          {entries.map(([key, value]) => (
            <li key={key}>{value}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "warning";
  children: ReactNode;
}) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role={tone === "info" ? "status" : "alert"}>
      {children}
    </div>
  );
}
