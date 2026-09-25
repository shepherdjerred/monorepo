import { recommended, type TSESLint } from "@shepherdjerred/eslint-config";

const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    // Augmenting Vitest's ProvidedContext needs interface declaration merging.
    files: ["tests/e2e/global-setup.ts"],
    rules: { "@typescript-eslint/consistent-type-definitions": "off" },
  },
];

export default config;
