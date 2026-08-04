import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  // The nested web workspace package lints itself with its own React config.
  { ignores: ["packages/**", "dist/**"] },
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["src/synchronous-file-sink.ts"],
    rules: {
      // Bun.FileSink may enter asynchronous backpressure. Audit events require
      // a synchronous write/fsync boundary so capture failure is atomic.
      "no-restricted-imports": "off",
    },
  },
];

export default config;
