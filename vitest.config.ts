import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The dashboard's `@/` alias (apps/dashboard/vite.config.ts), so its tests also run from the root.
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./apps/dashboard/src/", import.meta.url)) }],
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**", "**/.auto-crop/**"],
  },
});
