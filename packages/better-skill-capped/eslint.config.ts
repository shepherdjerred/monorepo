import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

const config: TSESLint.FlatConfig.ConfigArray = [
  {
    ignores: [
      "fetcher/**",
      "vite.config.ts",
      "eslint.config.ts",
      "**/*.test.ts",
    ],
  },
  ...recommended({ tsconfigRootDir: import.meta.dirname, react: true }),
];
export default config;
