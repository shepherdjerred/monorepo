import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Bun in Docker has worker incompatibilities with tinypool.
    // Disable isolation to run tests in the main thread.
    isolate: false,
    fileParallelism: false,
    server: {
      deps: {
        inline: [/./],
      },
    },
  },
});
