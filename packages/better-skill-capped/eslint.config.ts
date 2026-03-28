import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

export default [
  {
    ignores: [
      "fetcher/**",
      "vite.config.ts",
      "eslint.config.ts",
      "**/*.test.ts",
    ],
  },
  ...recommended({ tsconfigRootDir: import.meta.dirname, react: true }),
] satisfies TSESLint.FlatConfig.ConfigArray;
