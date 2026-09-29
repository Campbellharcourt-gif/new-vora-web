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
