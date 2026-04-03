import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

export default [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
] satisfies TSESLint.FlatConfig.ConfigArray;
