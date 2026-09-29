import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["scripts/acceptance/**/*.test.mjs"], environment: "node" },
});
