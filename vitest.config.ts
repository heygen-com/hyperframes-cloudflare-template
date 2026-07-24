// Standalone vitest config so tests don't load vite.config.ts (whose
// Cloudflare + TanStack Start plugins need a Workers environment).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
