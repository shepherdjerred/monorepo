import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  // The nested web workspace package lints itself with its own React config.
  // `architecture-fixtures/` holds deliberately illegal imports; it is in the
  // shared config's default ignores, but passing an explicit list replaces
  // that default rather than extending it, so the entry has to be repeated.
  { ignores: ["packages/**", "dist/**", "architecture-fixtures/**/*"] },
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["src/runtime/synchronous-file-sink.ts"],
    rules: {
      // Bun.FileSink may enter asynchronous backpressure. Audit events require
      // a synchronous write/fsync boundary so capture failure is atomic.
      "no-restricted-imports": "off",
    },
  },
];

export default config;
