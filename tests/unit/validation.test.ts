import { blockSchema, missingAltText, plainText } from "@shared/content/blocks";
import {
  loginSchema,
  otpCodeSchema,
  recoveryCodeSchema,
  setPasswordSchema,
} from "@shared/validation/auth";
import { cleanText, fieldErrors, normaliseUrlInput } from "@shared/validation/common";
import { createEnquirySchema, enquiryFromFormData } from "@shared/validation/enquiry";
import { describe, expect, it } from "vitest";
import { SETTINGS } from "~/.server/services/settings";

const options = SETTINGS["enquiry.options"].default;
const schema = createEnquirySchema(options);

const valid = {
  name: "Jordan Lee",
  email: "Jordan@Example.COM",
  company: "Northwind",
  website: "northwind.example",
  projectTypes: ["websites", "branding", "websites"],
  timeline: "1_2_months",
  message: "We need a new website for our studio launch next quarter.",
  source: "referral",
  consent: true,
};

describe("enquiry validation (server schema)", () => {
  it("accepts a valid enquiry and normalises it", () => {
    const parsed = schema.parse(valid);
    expect(parsed.email).toBe("jordan@example.com");
    expect(parsed.website).toBe("https://northwind.example");
    expect(parsed.projectTypes).toEqual(["websites", "branding"]);
  });

  it("reports every problem field with a human message", () => {
    const result = schema.safeParse({
      name: "  ",
      email: "not-an-email",
      projectTypes: [],
      timeline: "someday",
      message: "too short",
      consent: false,
    });
    expect(result.success).toBe(false);
    const errors = result.success ? {} : fieldErrors(result.error);
    expect(Object.keys(errors)).toEqual(
      expect.arrayContaining(["consent", "email", "message", "name", "projectTypes"]),
    );
    for (const message of Object.values(errors)) expect(message.length).toBeGreaterThan(5);
  });

  it("checks option keys against configured settings", () => {
    const bad = schema.safeParse({ ...valid, timeline: "yesterday", source: "spam" });
    expect(bad.success).toBe(false);
    const errors = bad.success ? {} : fieldErrors(bad.error);
    expect(errors.timeline).toBeDefined();
    expect(errors.source).toBeDefined();
  });

  it("refuses a budget while no budget ranges are configured (pricing retired)", () => {
    const r = schema.safeParse({ ...valid, budget: "50k_plus" });
    expect(r.success).toBe(false);
    const withBudgets = createEnquirySchema({
      ...options,
      budgets: [{ key: "range_a", label: "Range A" }],
    });
    expect(withBudgets.safeParse({ ...valid, budget: "range_a" }).success).toBe(true);
    expect(withBudgets.safeParse({ ...valid, budget: "range_b" }).success).toBe(false);
  });

  it("requires a real date for 'by a specific date'", () => {
    expect(schema.safeParse({ ...valid, timeline: "specific_date" }).success).toBe(false);
    expect(
      schema.safeParse({ ...valid, timeline: "specific_date", timelineDate: "2027-02-30x" })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...valid, timeline: "specific_date", timelineDate: "2027-02-01" }).success,
    ).toBe(true);
  });

  it("rejects dangerous or non-web URLs", () => {
    for (const website of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://example.com",
      "https://",
    ]) {
      expect(schema.safeParse({ ...valid, website }).success, website).toBe(false);
    }
  });

  it("rejects unknown project types and enforces length limits", () => {
    expect(schema.safeParse({ ...valid, projectTypes: ["hacking"] }).success).toBe(false);
    expect(schema.safeParse({ ...valid, message: "x".repeat(5001) }).success).toBe(false);
    expect(schema.safeParse({ ...valid, name: "n".repeat(121) }).success).toBe(false);
  });

  it("strips control characters from free text", () => {
    expect(cleanText("  hi\u0000there\u0007 \n")).toBe("hithere");
    const parsed = schema.parse({ ...valid, name: "Jo\u0000rdan\u001b" });
    expect(parsed.name).toBe("Jordan");
  });

  it("reads FormData the way the browser submits it", () => {
    const form = new FormData();
    form.set("name", "Jordan");
    form.set("email", "j@example.com");
    form.append("projectTypes", "websites");
    form.append("projectTypes", "film");
    form.set("timeline", "flexible");
    form.set("message", "A message that is long enough to pass.");
    form.set("consent", "on");
    const parsed = schema.parse(enquiryFromFormData(form));
    expect(parsed.projectTypes).toEqual(["websites", "film"]);
    expect(parsed.consent).toBe(true);
    expect(parsed.website).toBeUndefined();
  });

  it("normalises bare hostnames only", () => {
    expect(normaliseUrlInput("example.com")).toBe("https://example.com");
    expect(normaliseUrlInput("http://example.com")).toBe("http://example.com");
    expect(normaliseUrlInput("javascript:alert(1)")).toBe("javascript:alert(1)"); // then rejected
    expect(normaliseUrlInput("   ")).toBeUndefined();
  });
});

describe("auth input schemas", () => {
  it("lower-cases emails and never applies the new-password policy at sign-in", () => {
    expect(loginSchema.parse({ email: " A@B.CO ", password: "x" }).email).toBe("a@b.co");
  });

  it("accepts OTPs with spaces or dashes and nothing else", () => {
    expect(otpCodeSchema.parse("123 456")).toBe("123456");
    expect(otpCodeSchema.parse("123-456")).toBe("123456");
    expect(otpCodeSchema.safeParse("12345").success).toBe(false);
    expect(otpCodeSchema.safeParse("12345a").success).toBe(false);
  });

  it("normalises recovery codes", () => {
    expect(recoveryCodeSchema.parse("abcde-12345")).toBe("ABCDE12345");
    expect(recoveryCodeSchema.safeParse("abc").success).toBe(false);
  });

  it("requires matching confirmation", () => {
    const r = setPasswordSchema.safeParse({
      password: "a long passphrase",
      confirmPassword: "a long passphrasf",
    });
    expect(r.success).toBe(false);
    expect(r.success ? {} : fieldErrors(r.error)).toHaveProperty("confirmPassword");
  });
});

describe("structured content blocks (no raw HTML)", () => {
  const link = (href: string) =>
    blockSchema.safeParse({
      type: "paragraph",
      content: [{ text: "x", marks: [{ type: "link", href }] }],
    }).success;

  it("allows https, mailto and site paths", () => {
    expect(link("https://example.com/a")).toBe(true);
    expect(link("mailto:hello@vorawebsites.store")).toBe(true);
    expect(link("/work/sail-gaming")).toBe(true);
  });

  it("blocks script, data, protocol-relative and malformed links", () => {
    expect(link("javascript:alert(1)")).toBe(false);
    expect(link("JaVaScRiPt:alert(1)")).toBe(false);
    expect(link("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(link("//evil.example")).toBe(false);
    expect(link("mailto:not an address")).toBe(false);
    expect(link("vbscript:msgbox")).toBe(false);
  });

  it("rejects unknown block types and bad media or embed references", () => {
    expect(blockSchema.safeParse({ type: "html", html: "<script>" }).success).toBe(false);
    expect(blockSchema.safeParse({ type: "image", mediaId: "../../etc/passwd" }).success).toBe(
      false,
    );
    expect(
      blockSchema.safeParse({ type: "embed", provider: "youtube", id: 'x" onload="', title: "t" })
        .success,
    ).toBe(false);
  });

  it("counts images missing alt text (publish gate) and extracts plain text", () => {
    const blocks = [
      { type: "image", mediaId: "med_01J8Z6XG0000000000000000AA" },
      {
        type: "gallery",
        items: [
          { mediaId: "med_01J8Z6XG0000000000000000AB", alt: "Studio" },
          { mediaId: "med_01J8Z6XG0000000000000000AC", alt: " " },
        ],
      },
      { type: "paragraph", content: [{ text: "Hello " }, { text: "world" }] },
      { type: "list", style: "bullet", items: [[{ text: "one" }], [{ text: "two" }]] },
    ] as const;
    for (const b of blocks) expect(blockSchema.safeParse(b).success).toBe(true);
    expect(missingAltText(blocks as never)).toBe(2);
    expect(plainText(blocks as never)).toBe("Hello world\none two");
  });
});
