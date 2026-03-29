import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  { rules: { "no-console": "off" } },
];
export default config;
