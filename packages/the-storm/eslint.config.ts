import { recommended, type TSESLint } from "@shepherdjerred/eslint-config";

const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  // uv virtualenvs (tools/learning) hold no TypeScript, and a concurrent `uv
  // run` may rewrite them mid-walk, so ESLint must not descend into them.
  { ignores: ["**/.venv/"] },
  {
    // Augmenting Vitest's ProvidedContext needs interface declaration merging.
    files: ["tests/e2e/global-setup.ts"],
    rules: { "@typescript-eslint/consistent-type-definitions": "off" },
  },
];

export default config;
