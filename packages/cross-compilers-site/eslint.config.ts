import { recommended, type TSESLint } from "@shepherdjerred/eslint-config";
const config: TSESLint.FlatConfig.ConfigArray = [
  {
    ignores: ["**/*.astro", "src/env.d.ts", "eslint.config.ts"],
  },
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
];
export default config;
