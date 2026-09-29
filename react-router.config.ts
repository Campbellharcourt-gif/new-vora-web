import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Integrity hashes on the framework's own script tags (defence in depth with the CSP nonce).
  subResourceIntegrity: true,
} satisfies Config;
