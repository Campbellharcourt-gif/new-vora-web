/**
 * Transactional email templates. Every dynamic value passes through `esc()`; links are built
 * from the configured origin only. Each template returns matching HTML and plain-text bodies.
 */

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface LayoutOptions {
  preheader: string;
  heading: string;
  /** Pre-escaped HTML paragraphs/blocks. */
  bodyHtml: string;
  bodyText: string;
  action?: { label: string; url: string };
  footnote?: string;
  appName: string;
  origin: string;
}

function layout(o: LayoutOptions): { html: string; text: string } {
  const action = o.action
    ? `<tr><td style="padding:8px 0 28px"><a href="${esc(o.action.url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font:600 14px/1 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:14px 22px;border-radius:2px">${esc(o.action.label)}</a></td></tr>`
    : "";
  const footnote = o.footnote
    ? `<tr><td style="padding:0 0 8px;color:#6b6b6b;font:13px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif">${esc(o.footnote)}</td></tr>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(o.heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f2">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(o.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e6e3">
<tr><td style="padding:32px 36px 0;font:600 13px/1 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:.24em;color:#111">${esc(o.appName.toUpperCase())}</td></tr>
<tr><td style="padding:28px 36px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:0 0 16px;font:600 22px/1.3 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111">${esc(o.heading)}</td></tr>
<tr><td style="padding:0 0 20px;font:15px/1.65 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#2b2b2b">${o.bodyHtml}</td></tr>
${action}${footnote}
</table></td></tr>
<tr><td style="padding:20px 36px 32px;border-top:1px solid #efefec;color:#8a8a86;font:12px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif">${esc(o.appName)} · <a href="${esc(o.origin)}" style="color:#8a8a86">${esc(new URL(o.origin).host)}</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    o.appName.toUpperCase(),
    "",
    o.heading,
    "",
    o.bodyText,
    o.action ? `\n${o.action.label}: ${o.action.url}` : "",
    o.footnote ? `\n${o.footnote}` : "",
    "",
    `— ${o.appName} · ${o.origin}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
  return { html, text };
}

const p = (text: string) => `<p style="margin:0 0 14px">${esc(text)}</p>`;

export interface TemplateContext {
  appName: string;
  origin: string;
}

type Row = [label: string, value: string | null | undefined];

function detailRows(rows: Row[]): { html: string; text: string } {
  const present = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:4px 0 16px">${present
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid #f0f0ed;color:#6b6b6b;font-size:13px;vertical-align:top;width:34%">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #f0f0ed;font-size:14px;white-space:pre-wrap">${esc(v)}</td></tr>`,
    )
    .join("")}</table>`;
  const text = present.map(([k, v]) => `${k}: ${v}`).join("\n");
  return { html, text };
}

export const templates = {
  loginCode(t: TemplateContext, d: { name: string; code: string; minutes: number }): RenderedEmail {
    const body = [`Hi ${d.name},`, "Use this code to finish signing in to VORA:"];
    const codeHtml = `<p style="margin:8px 0 18px;font:600 30px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.3em;color:#111">${esc(d.code)}</p>`;
    const footnote = `This code expires in ${d.minutes} minutes and can be used once. If you didn't try to sign in, change your password — someone may know it.`;
    const { html, text } = layout({
      ...t,
      preheader: `Your VORA sign-in code: ${d.code}`,
      heading: "Your sign-in code",
      bodyHtml: body.map(p).join("") + codeHtml,
      bodyText: `${body.join("\n\n")}\n\n${d.code}`,
      footnote,
    });
    return { subject: `${d.code} is your VORA sign-in code`, html, text };
  },

  passwordReset(
    t: TemplateContext,
    d: { name: string; url: string; minutes: number },
  ): RenderedEmail {
    const body = [
      `Hi ${d.name},`,
      "We received a request to reset the password for your VORA account.",
    ];
    const { html, text } = layout({
      ...t,
      preheader: "Reset your VORA password",
      heading: "Reset your password",
      bodyHtml: body.map(p).join(""),
      bodyText: body.join("\n\n"),
      action: { label: "Choose a new password", url: d.url },
      footnote: `The link expires in ${d.minutes} minutes and works once. If you didn't ask for this, you can ignore this email — your password won't change.`,
    });
    return { subject: "Reset your VORA password", html, text };
  },

  invitation(
    t: TemplateContext,
    d: { inviterName: string; roleNames: string; url: string; days: number },
  ): RenderedEmail {
    const body = [
      `${d.inviterName} has invited you to VORA as ${d.roleNames}.`,
      "Accept the invitation to set your name and password.",
    ];
    const { html, text } = layout({
      ...t,
      preheader: `You've been invited to VORA`,
      heading: "You're invited to VORA",
      bodyHtml: body.map(p).join(""),
      bodyText: body.join("\n\n"),
      action: { label: "Accept invitation", url: d.url },
      footnote: `This invitation expires in ${d.days} days. If you weren't expecting it, you can ignore this email.`,
    });
    return { subject: "Your invitation to VORA", html, text };
  },

  verifyEmail(
    t: TemplateContext,
    d: { name: string; accountLabel: string; url: string; hours: number },
  ): RenderedEmail {
    const body = [
      `Hi ${d.name},`,
      `Thanks for creating a VORA ${d.accountLabel} account. Confirm this email address and choose your password to finish.`,
    ];
    const { html, text } = layout({
      ...t,
      preheader: "Confirm your email to finish creating your VORA account",
      heading: "Confirm your email",
      bodyHtml: body.map(p).join(""),
      bodyText: body.join("\n\n"),
      action: { label: "Confirm and set a password", url: d.url },
      footnote: `The link expires in ${d.hours} hours and works once. If you didn't try to create a VORA account, you can ignore this email — no account is created until the link is used.`,
    });
    return { subject: "Confirm your email for VORA", html, text };
  },

  accountExists(t: TemplateContext, d: { name: string; signInUrl: string }): RenderedEmail {
    const body = [
      `Hi ${d.name},`,
      "Someone tried to create a new VORA account with this email address. You already have an account, so nothing was changed.",
      "If that was you, sign in instead — or reset your password from the sign-in page if you've forgotten it.",
    ];
    const { html, text } = layout({
      ...t,
      preheader: "You already have a VORA account",
      heading: "You already have an account",
      bodyHtml: body.map(p).join(""),
      bodyText: body.join("\n\n"),
      action: { label: "Sign in", url: d.signInUrl },
      footnote:
        "If this wasn't you, you can ignore this email. Your account and password are unchanged.",
    });
    return { subject: "You already have a VORA account", html, text };
  },

  newSignIn(
    t: TemplateContext,
    d: { name: string; when: string; device: string; location: string; url: string },
  ): RenderedEmail {
    const intro = [
      `Hi ${d.name},`,
      "Your VORA account was just signed in to from a device or location we haven't seen before.",
    ];
    const rows = detailRows([
      ["When", d.when],
      ["Device", d.device],
      ["Approximate location", d.location],
    ]);
    const { html, text } = layout({
      ...t,
      preheader: "New sign-in to your VORA account",
      heading: "New sign-in to your account",
      bodyHtml: intro.map(p).join("") + rows.html,
      bodyText: `${intro.join("\n\n")}\n\n${rows.text}`,
      action: { label: "Review your sessions", url: d.url },
      footnote:
        "If this was you, there's nothing to do. If not, change your password and sign out of other sessions right away.",
    });
    return { subject: "New sign-in to your VORA account", html, text };
  },

  securityNotice(
    t: TemplateContext,
    d: { name: string; heading: string; message: string; url: string },
  ): RenderedEmail {
    const body = [`Hi ${d.name},`, d.message];
    const { html, text } = layout({
      ...t,
      preheader: d.heading,
      heading: d.heading,
      bodyHtml: body.map(p).join(""),
      bodyText: body.join("\n\n"),
      action: { label: "Review account security", url: d.url },
      footnote: "If you didn't make this change, reset your password immediately and contact VORA.",
    });
    return { subject: `Security notice: ${d.heading}`, html, text };
  },

  enquiryNotification(
    t: TemplateContext,
    d: {
      reference: string;
      name: string;
      email: string;
      company?: string | null;
      website?: string | null;
      projectTypes: string;
      budget?: string | null;
      timeline: string;
      source?: string | null;
      message: string;
      adminUrl: string;
      spamScore: number;
    },
  ): RenderedEmail {
    const rows = detailRows([
      ["Reference", d.reference],
      ["Name", d.name],
      ["Email", d.email],
      ["Company", d.company],
      ["Website", d.website],
      ["Project", d.projectTypes],
      ["Budget", d.budget],
      ["Timeline", d.timeline],
      ["Found us via", d.source],
      ["Spam score", d.spamScore > 0 ? String(d.spamScore) : null],
      ["Message", d.message],
    ]);
    const { html, text } = layout({
      ...t,
      preheader: `New enquiry from ${d.name}`,
      heading: `New enquiry · ${d.reference}`,
      bodyHtml: rows.html,
      bodyText: rows.text,
      action: { label: "Open in admin", url: d.adminUrl },
    });
    return {
      subject: `New enquiry ${d.reference} — ${d.name}${d.company ? `, ${d.company}` : ""}`,
      html,
      text,
    };
  },

  enquiryConfirmation(
    t: TemplateContext,
    d: { name: string; reference: string; replyEmail: string },
  ): RenderedEmail {
    const body = [
      `Hi ${d.name},`,
      "Thank you for getting in touch with VORA. Your enquiry has been received and will be reviewed by the team.",
      `Your reference is ${d.reference}. If you need to add anything, reply to this email or write to ${d.replyEmail} and include the reference.`,
    ];
    const { html, text } = layout({
      ...t,
      preheader: `We've received your enquiry (${d.reference})`,
      heading: "We've received your enquiry",
      bodyHtml: body.map(p).join(""),
      bodyText: body.join("\n\n"),
    });
    return { subject: `We've received your enquiry — ${d.reference}`, html, text };
  },
} as const;

export type TemplateName = keyof typeof templates;
