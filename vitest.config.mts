import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Test runner for the FUNCTIONAL CORE only (ADR 0009).
 *
 * Everything under `src/lib/` is pure — no Prisma, no React, no `next/*` — so
 * these tests need no database, no server and no DOM. That is the whole point
 * of keeping the domain rules there: they are the part worth testing, and they
 * are testable in milliseconds.
 *
 * The `@/*` alias mirrors `tsconfig.json`; Vitest does not read tsconfig paths.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // No test here imports a stylesheet, and picking up `postcss.config.mjs`
  // would drag Tailwind's PostCSS plugin into a run that has no CSS in it.
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
