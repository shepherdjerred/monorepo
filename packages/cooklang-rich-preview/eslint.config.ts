import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

const config: TSESLint.FlatConfig.ConfigArray = [
  {
    ignores: ["**/*.astro", "src/env.d.ts", "eslint.config.ts"],
  },
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
];
export default config;
