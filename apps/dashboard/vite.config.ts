import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Opt-in proxy for running the dev server against a separate API process, as the e2e suite does.
// The live event stream needs a real same-origin path, which a test-side request route cannot stream.
const apiProxyTarget = process.env.AUTO_CROP_API_PROXY;

export default defineConfig({
  server: apiProxyTarget ? { proxy: { "/api": { target: apiProxyTarget } } } : undefined,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [react()],
});
