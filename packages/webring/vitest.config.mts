import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use forks pool - threads/vmThreads have worker issues with Bun
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Inline all deps to avoid ESM resolution issues in Bun Docker
    deps: {
      inline: [/./],
    },
  },
});
