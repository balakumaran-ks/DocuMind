import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}"],
    },
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts"] },
      },
      {
        extends: true,
        // React components, rendered in a simulated browser (jsdom).
        test: { name: "components", include: ["src/**/*.test.tsx"], environment: "jsdom" },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/**/*.test.ts"],
          // Downloads the MongoDB binary once, before any integration test starts.
          globalSetup: ["tests/integration/global-setup.ts"],
        },
      },
    ],
  },
});
