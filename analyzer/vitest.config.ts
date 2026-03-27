import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
  },
  resolve: {
    alias: {
      // No @/ aliases — all imports are relative.
      // This alias exists only for test fixture helpers that use __dirname patterns.
    },
  },
});
