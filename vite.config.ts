import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

/**
 * Railway migration §4.2–4.3: a standard React Router Node build. The SSR environment's input is
 * the Node server entry (server/main.ts), so `build/server/index.js` is the whole server — the ~
 * and @shared aliases resolve at build time. Development runs Vite in middleware mode inside the
 * same server (server/dev.ts); the Cloudflare plugin and workerd are gone.
 */
export default defineConfig({
  plugins: [reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    // Browser bundles never ship source maps publicly (and the static file server refuses to
    // serve .map files even if one appeared).
    sourcemap: false,
  },
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            // The JavaScript-before-interaction budget (design system §14: under 120 KB gzipped
            // per page). Both groups change how code is packaged, never what a page loads: each
            // joins files that every page already downloads, which removes the import/export
            // lists between them and lets gzip compress them as one.
            codeSplitting: {
              groups: [
                {
                  // React, React DOM, the scheduler, React Router and React Router's default
                  // client entry: one file instead of four (about 3 KB less on every page).
                  // Route modules import the framework from this file, so it now evaluates
                  // before the inline bootstrap script registers them. That is safe:
                  // hydrateRoot only schedules work, and HydratedRouter reads the registered
                  // route modules when it first renders, on a later task.
                  name: "framework",
                  test: /node_modules[\\/](react|react-dom|react-router|scheduler|@react-router[\\/]dev)[\\/]/,
                },
                {
                  // The root route with what it imports on every page — the wordmark, the
                  // primitives (its error page uses SurveyLine) and their icons: one file instead
                  // of four (about 0.5 KB less). If root stops importing them, drop them here, or
                  // this group would put them on every page.
                  name: "root",
                  test: /app[\\/](root\.tsx|components[\\/](ui[\\/]Logo|vora[\\/](icons|primitives))\.tsx)$/,
                },
              ],
            },
          },
        },
      },
    },
    ssr: {
      build: {
        // Server source maps stay inside the image (`node --enable-source-maps`), never public.
        sourcemap: true,
        target: "node24",
        rollupOptions: { input: "./server/main.ts" },
      },
    },
  },
});
