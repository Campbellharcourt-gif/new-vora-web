import { z } from "zod";
import { ENQUIRY_PROJECT_TYPES } from "../enums";
import { emailAddress, httpUrl, normaliseUrlInput, optionalText, text } from "./common";

const PROJECT_TYPE_KEYS = ENQUIRY_PROJECT_TYPES.map((t) => t.key) as [string, ...string[]];

export const ENQUIRY_LIMITS = {
  name: 120,
  company: 160,
  messageMin: 20,
  message: 5000,
  sourceDetail: 200,
} as const;

/**
 * Field-level enquiry schema shared by the browser (instant feedback) and the server
 * (authoritative). Option lists that come from settings (budget, timeline, source) are validated
 * against the configured keys on the server by `createEnquirySchema`.
 */
export const enquiryFieldsSchema = z.object({
  name: text(1, ENQUIRY_LIMITS.name),
  email: emailAddress,
  company: optionalText(ENQUIRY_LIMITS.company),
  website: z
    .string()
    .optional()
    .transform((v) => normaliseUrlInput(v))
    .pipe(httpUrl.optional()),
  projectTypes: z
    .array(z.enum(PROJECT_TYPE_KEYS))
    .min(1, "Choose at least one area.")
    .max(PROJECT_TYPE_KEYS.length)
    .transform((values) => [...new Set(values)]),
  budget: optionalText(64),
  timeline: text(1, 64),
  timelineDate: optionalText(10),
  message: text(ENQUIRY_LIMITS.messageMin, ENQUIRY_LIMITS.message),
  source: optionalText(64),
  sourceDetail: optionalText(ENQUIRY_LIMITS.sourceDetail),
  consent: z.literal(true, { error: "Please confirm you have read the privacy notice." }),
});

export type EnquiryFields = z.infer<typeof enquiryFieldsSchema>;

export interface EnquiryOptionSets {
  budgets: readonly { key: string; label: string }[];
  timelines: readonly { key: string; label: string }[];
  sources: readonly { key: string; label: string }[];
}

/** Server-side schema: also checks that option keys exist in the configured option sets. */
export function createEnquirySchema(options: EnquiryOptionSets) {
  const budgetKeys = new Set(options.budgets.map((o) => o.key));
  const timelineKeys = new Set(options.timelines.map((o) => o.key));
  const sourceKeys = new Set(options.sources.map((o) => o.key));

  return enquiryFieldsSchema.superRefine((value, ctx) => {
    if (budgetKeys.size > 0 && value.budget && !budgetKeys.has(value.budget)) {
      ctx.addIssue({ code: "custom", path: ["budget"], message: "Please choose a budget range." });
    }
    if (budgetKeys.size === 0 && value.budget) {
      ctx.addIssue({ code: "custom", path: ["budget"], message: "Budget is not accepted yet." });
    }
    if (!timelineKeys.has(value.timeline)) {
      ctx.addIssue({ code: "custom", path: ["timeline"], message: "Please choose a timeline." });
    }
    if (value.timeline === "specific_date") {
      const date = value.timelineDate;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
        ctx.addIssue({ code: "custom", path: ["timelineDate"], message: "Please choose a date." });
      }
    }
    if (value.source && !sourceKeys.has(value.source)) {
      ctx.addIssue({ code: "custom", path: ["source"], message: "Please choose an option." });
    }
  });
}

/** Reads the enquiry fields out of a submitted FormData object. */
export function enquiryFromFormData(form: FormData): Record<string, unknown> {
  const str = (key: string) => {
    const v = form.get(key);
    return typeof v === "string" ? v : undefined;
  };
  return {
    name: str("name") ?? "",
    email: str("email") ?? "",
    company: str("company"),
    website: str("website"),
    projectTypes: form.getAll("projectTypes").filter((v): v is string => typeof v === "string"),
    budget: str("budget") || undefined,
    timeline: str("timeline") ?? "",
    timelineDate: str("timelineDate") || undefined,
    message: str("message") ?? "",
    source: str("source") || undefined,
    sourceDetail: str("sourceDetail") || undefined,
    consent: form.get("consent") === "on" || form.get("consent") === "true",
  };
}
