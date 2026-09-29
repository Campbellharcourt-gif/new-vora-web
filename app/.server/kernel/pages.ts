import { esc } from "../email/templates";

/**
 * Kernel-level HTML pages. These render without React Router so they work even when the app
 * itself cannot (configuration errors, maintenance). No inline scripts; styles only.
 */
function shell(title: string, heading: string, body: string, status: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0e0d;color:#ecebe6;font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}
main{max-width:34rem}p.k{margin:0 0 28px;font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:#9a9a93}h1{margin:0 0 16px;font-size:clamp(28px,5vw,40px);line-height:1.15;font-weight:500;letter-spacing:-.01em}p{margin:0 0 12px;color:#bdbcb5}small{display:block;margin-top:28px;color:#7c7b75;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
a{color:#ecebe6}
</style></head><body><main><p class="k">VORA</p><h1>${esc(heading)}</h1>${body}<small>${esc(status)}</small></main></body></html>`;
}

export function maintenancePage(message: string | null): string {
  const text =
    message?.trim() || "We're carrying out scheduled maintenance. The site will be back shortly.";
  return shell(
    "VORA — Maintenance",
    "We'll be back shortly.",
    `<p>${esc(text)}</p><p>For anything urgent, email <a href="mailto:hello@vorawebsites.store">hello@vorawebsites.store</a>.</p>`,
    "Status · Maintenance",
  );
}

export function unavailablePage(requestId: string): string {
  return shell(
    "VORA — Temporarily unavailable",
    "Something went wrong on our side.",
    "<p>The team has been notified. Please try again in a few minutes.</p>",
    `Reference · ${requestId}`,
  );
}
