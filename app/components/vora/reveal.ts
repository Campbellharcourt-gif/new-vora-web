import { useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router";

/**
 * Fire-once reveals (design system §8.4; the behaviour of docs/design-system/components/
 * bundle.js `VORA.reveal`, adapted so content never waits for motion):
 *
 * - The server renders everything visible. Script arms reveals only after hydration.
 * - On the first load, anything already in view is marked revealed *before* arming, so it never
 *   disappears and replays (the likely LCP element is never hidden). Only content below the fold
 *   reveals as it enters (15 % in view).
 * - After a client-side navigation the new page's shot plays: its title lines rise and its first
 *   aperture opens — the page is interactive throughout.
 * - Reduced motion (the OS setting, or Save-Data): nothing is armed.
 * - A safety timeout reveals everything after 2.5 s whatever happens.
 */

const SAFETY_TIMEOUT_MS = 2500;

/** Arming happens before paint so nothing flashes visible → hidden → visible. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  const pref = document.documentElement.getAttribute("data-motion");
  if (pref) return pref === "reduced";
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Save-Data asks for the T0 version too (§8.10). */
export function applySaveData(): void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData && !document.documentElement.hasAttribute("data-motion")) {
    document.documentElement.setAttribute("data-motion", "reduced");
  }
}

export function reveal(root: HTMLElement, { playInView }: { playInView: boolean }): () => void {
  const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
  if (prefersReducedMotion() || !("IntersectionObserver" in window) || targets.length === 0) {
    root.classList.remove("v-armed");
    return () => {};
  }
  const viewport = window.innerHeight;
  const pending: HTMLElement[] = [];
  for (const target of targets) {
    if (target.classList.contains("is-in")) continue; // revealed once — never replayed
    const fresh = !target.hasAttribute("data-rv");
    target.setAttribute("data-rv", "");
    if (fresh && !playInView) {
      const rect = target.getBoundingClientRect();
      if (rect.top < viewport && rect.bottom > 0) {
        target.classList.add("is-in"); // already on screen at load: stays visible, no replay
        continue;
      }
    }
    pending.push(target);
  }
  root.classList.add("v-armed");

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15 },
  );
  // Two frames so the armed (hidden) state is painted before anything in view plays.
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      for (const target of pending) io.observe(target);
    });
  });
  const safety = window.setTimeout(() => {
    for (const target of pending) target.classList.add("is-in");
  }, SAFETY_TIMEOUT_MS);

  return () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(safety);
    io.disconnect();
  };
}

/**
 * Runs the reveals for the element with `id` on every navigation (including form submissions,
 * which can render new content such as the enquiry success state). The first run keeps what is
 * already visible; later runs play new content's entrance. Nothing already revealed replays.
 */
export function useReveal(id: string): void {
  const location = useLocation();
  useEffect(() => {
    applySaveData();
  }, []);
  // Re-runs per navigation (location.key), including form submissions on the same path.
  useIsomorphicLayoutEffect(() => {
    const root = document.getElementById(id);
    if (!root) return;
    const first = !root.hasAttribute("data-revealed");
    root.setAttribute("data-revealed", "");
    return reveal(root, { playInView: !first });
  }, [id, location.key]);
}

/**
 * Focus moves to the new page's h1 after a client-side navigation (§8.3, §13), so screen-reader
 * and keyboard users start at the top of the new content. Initial loads are left alone.
 */
export function useFocusHeadingOnNavigate(id: string): void {
  const location = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per pathname change
  useEffect(() => {
    const root = document.getElementById(id);
    if (!root) return;
    if (!root.hasAttribute("data-navigated")) {
      root.setAttribute("data-navigated", "");
      return;
    }
    const focusHeading = () => {
      const heading = root.querySelector<HTMLElement>("h1");
      if (!heading) return;
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    };
    if (!root.inert) {
      focusHeading();
      return;
    }
    // A destination chosen in the menu dialog: the page stays inert (unfocusable) until the
    // dialog closes, so the heading takes focus the moment `inert` is lifted.
    const observer = new MutationObserver(() => {
      if (root.inert) return;
      observer.disconnect();
      focusHeading();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["inert"] });
    return () => observer.disconnect();
  }, [id, location.pathname]);
}
