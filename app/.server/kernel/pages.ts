import { esc } from "../email/templates";

/**
 * Kernel-level HTML pages. These render without React Router so they work even when the app
 * itself cannot (configuration errors, maintenance). No scripts; one inline stylesheet.
 *
 * Design system §16.13: static, the text wordmark on Basalt, one message. The values are the
 * design tokens (app/styles/tokens.css) inlined, because this page cannot rely on the app's
 * hashed stylesheet or fonts; the system font stack stands in for Archivo and DM Mono.
 */
const STYLE = `
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;grid-template-rows:auto 1fr auto;background:#0a0c0b;color:#e6eae8;font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:0 clamp(1.25rem,.53rem + 3.2vw,3.5rem)}
header{display:flex;align-items:center;height:72px}
.w{font-weight:460;font-size:18px;letter-spacing:.24em}
main{align-self:center;max-width:44rem;padding:4rem 0}
.l,small{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.3;letter-spacing:.14em;text-transform:uppercase;color:#aeb5b2}
h1{margin:20px 0 20px;font-size:clamp(2.25rem,1.61rem + 2.84vw,4.5rem);line-height:1;font-weight:360;letter-spacing:-.028em;text-wrap:balance}
p{margin:0 0 12px;max-width:52ch;color:#aeb5b2;font-size:clamp(1.125rem,.99rem + .56vw,1.5rem);line-height:1.42}
hr{border:0;height:1px;background:rgb(230 234 232/.32);margin:32px 0 0}
a{color:#e6eae8;text-underline-offset:.22em}a:focus-visible{outline:2px solid #80d0a8;outline-offset:3px}
footer{padding:16px 0 32px;border-top:1px solid rgb(230 234 232/.14)}
`;

function shell(
  title: string,
  label: string,
  heading: string,
  body: string,
  status: string,
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#0a0c0b"><title>${esc(title)}</title>
<style>${STYLE}</style></head><body><header><span class="w" role="img" aria-label="VORA">VORA</span></header><main><p class="l">${esc(label)}</p><h1>${esc(heading)}</h1>${body}<hr></main><footer><small>${esc(status)}</small></footer></body></html>`;
}

export function maintenancePage(message: string | null): string {
  const text =
    message?.trim() || "We're carrying out scheduled maintenance. The site will be back shortly.";
  return shell(
    "VORA — Maintenance",
    "Maintenance",
    "We'll be back shortly.",
    `<p>${esc(text)}</p><p>For anything urgent, email <a href="mailto:hello@vorawebsites.store">hello@vorawebsites.store</a>.</p>`,
    "Status · Maintenance",
  );
}

export function unavailablePage(requestId: string): string {
  return shell(
    "VORA — Temporarily unavailable",
    "Unavailable",
    "Something went wrong on our side.",
    "<p>The team has been notified. Please try again in a few minutes.</p>",
    `Reference · ${requestId}`,
  );
}
