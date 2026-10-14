import { defineConfig } from "vitest/config";

// The unit tests need none of the app's plugins.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
