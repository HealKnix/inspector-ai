import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
    environment: "jsdom",
    globals: true,
    // Bound concurrent JSDOM and HeroUI initialization on local and CI machines.
    maxWorkers: 2,
    pool: "vmThreads",
    isolate: false,
    setupFiles: ["./src/test/setup.ts"],
  },
});
