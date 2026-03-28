import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

export default [
  {
    ignores: ["**/*.astro", "src/env.d.ts", "eslint.config.ts"],
  },
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
] satisfies TSESLint.FlatConfig.ConfigArray;
