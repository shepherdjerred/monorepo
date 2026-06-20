import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    // This package's job is to load + Zod-validate catalog.json at module load.
    // Bun has no synchronous file-read API, so a synchronous node:fs read is the
    // correct tool here (the data must be available synchronously to consumers).
    files: ["src/index.ts"],
    rules: { "no-restricted-imports": "off" },
  },
];
export default config;
