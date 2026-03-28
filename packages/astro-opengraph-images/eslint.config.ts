import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

export default [
  {
    ignores: [
      "examples/**",
      "dist/**",
      "eslint.config.ts",
      "vitest.config.mts",
    ],
  },
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["src/index.ts"],
    rules: {
      "custom-rules/no-re-exports": "off",
      "unicorn/prefer-export-from": "off",
    },
  },
] satisfies TSESLint.FlatConfig.ConfigArray;
