import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

const config: TSESLint.FlatConfig.ConfigArray = [
  {
    ignores: ["vite.config.ts", "eslint.config.ts", "**/*.test.ts"],
  },
  ...recommended({ tsconfigRootDir: import.meta.dirname, react: false }),
  {
    files: ["src/lib/debug.ts"],
    rules: {
      "no-console": "off",
    },
  },
];
export default config;
