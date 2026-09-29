import { z } from "zod";

/** Removes control characters (except tab/newline) and trims. Applied to all free text. */
export function cleanText(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

export const text = (min: number, max: number) =>
  z
    .string()
    .transform(cleanText)
    .pipe(
      z
        .string()
        .min(min, min <= 1 ? "This field is required." : `Please enter at least ${min} characters.`)
        .max(max, `Please keep this under ${max} characters.`),
    );

export const optionalText = (max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : cleanText(v)))
    .pipe(
      z
        .string()
        .max(max, `Please keep this under ${max} characters.`)
        .optional()
        .transform((v) => (v ? v : undefined)),
    );

export const emailAddress = z
  .string()
  .transform((v) => cleanText(v).toLowerCase())
  .pipe(z.email("Please enter a valid email address.").max(254, "That email address is too long."));

/** http(s) URL only — rejects javascript:, data:, file: and friends. */
export const httpUrl = z
  .string()
  .transform(cleanText)
  .pipe(
    z
      .string()
      .max(2048, "That link is too long.")
      .refine((value) => {
        try {
          const url = new URL(value);
          return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
        } catch {
          return false;
        }
      }, "Please enter a full link starting with https://"),
  );

/** Normalises a user-entered URL: adds https:// if the scheme is missing. */
export function normaliseUrlInput(value: string | undefined | null): string | undefined {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export type FieldErrors = Record<string, string>;

/** Flattens a ZodError into `{ field: firstMessage }` for forms and API envelopes. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
