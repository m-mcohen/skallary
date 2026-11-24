import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
    // Vitest's own per-test ceiling, default 5000ms. The AG-Grid-backed
    // BudgetGrid test mounts a real grid and takes ~2s alone but has been
    // measured at 5.3-5.5s under a full parallel run, so it failed here on
    // scheduling pressure while the component was correct. This is the knob
    // that governs that failure -- @testing-library's asyncUtilTimeout (see
    // tests/setup.ts) governs a different one and cannot rescue a test the
    // runner has already given up on.
    testTimeout: 30000,
  },
});
