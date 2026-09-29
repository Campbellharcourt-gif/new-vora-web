/**
 * React Router "single fetch" serves each page's loader/action data at `<page>.data`
 * (`/account` → `/account.data`, `/` → `/_.data`, `/foo/` → `/foo/_.data`). Path-based policy
 * (private-area caching, maintenance exemptions) must treat that URL exactly like its page.
 */
export function pagePath(pathname: string): string {
  if (pathname.endsWith("/_.data")) return pathname.slice(0, -"_.data".length) || "/";
  if (pathname.endsWith(".data")) return pathname.slice(0, -".data".length) || "/";
  return pathname;
}
