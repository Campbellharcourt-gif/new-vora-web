import { describe, expect, it } from "vitest";
import { EMAIL_RETRY_BATCH } from "~/.server/jobs/scheduled";

/**
 * CP-3 · Cloudflare Free — per-invocation hard limits a scheduled run must stay inside
 * (docs/CLOUDFLARE-FREE-COMPATIBILITY.md): 50 D1 queries and 50 external subrequests. CPU cannot be
 * checked locally (workerd enforces no CPU limits); see the report for the measured figures.
 */
describe("five-minute email run on the Free plan", () => {
  it("fits one invocation's D1-query and subrequest limits", () => {
    // Per email: 2 D1 queries (claim, result) + 1 provider request. Per run: 4 more D1 queries
    // (job record ×2, stuck-send recovery, due list).
    expect(EMAIL_RETRY_BATCH).toBeGreaterThan(0);
    expect(EMAIL_RETRY_BATCH * 2 + 4).toBeLessThanOrEqual(50);
    expect(EMAIL_RETRY_BATCH).toBeLessThanOrEqual(50);
  });
});
