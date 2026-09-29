import type { ServerContext } from "../context";
import { pagePath } from "../lib/paths";
import { getSetting } from "./settings";

export interface MaintenanceState {
  enabled: boolean;
  message: string | null;
  source: "env" | "setting" | null;
}

/** Maintenance can be forced by env var (deploy-time) or toggled in admin (runtime setting). */
export async function getMaintenanceState(ctx: ServerContext): Promise<MaintenanceState> {
  if (ctx.config.maintenanceForced) return { enabled: true, message: null, source: "env" };
  try {
    const setting = await getSetting(ctx, "maintenance");
    return setting.enabled
      ? { enabled: true, message: setting.message, source: "setting" }
      : { enabled: false, message: null, source: null };
  } catch (error) {
    // If settings can't be read, don't take the site down on that basis alone.
    ctx.log.error("maintenance_state_unreadable", { error: String(error) });
    return { enabled: false, message: null, source: null };
  }
}

/**
 * Paths that stay reachable during maintenance (health checks, sign-in, static assets). Sign-in
 * pages include their single-fetch data URLs (`/login.data`), which is where the browser posts the
 * form when JavaScript is running — otherwise staff could not sign in during maintenance.
 */
export function isMaintenanceExempt(rawPathname: string): boolean {
  const pathname = pagePath(rawPathname);
  return (
    pathname.startsWith("/api/health") ||
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/logout" ||
    pathname === "/robots.txt" ||
    pathname.startsWith("/assets/") ||
    pathname === "/favicon.ico"
  );
}
