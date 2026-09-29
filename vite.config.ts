import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // Local D1/R2/KV state. E2E runs point this at a throwaway directory (VORA_LOCAL_STATE).
      persistState: process.env.VORA_LOCAL_STATE ? { path: process.env.VORA_LOCAL_STATE } : true,
    }),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    // Source maps are uploaded to Cloudflare for the Worker only (upload_source_maps);
    // browser bundles do not ship source maps publicly.
    sourcemap: false,
  },
});
