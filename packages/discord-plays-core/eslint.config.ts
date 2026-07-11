import { recommended, type TSESLint } from "@shepherdjerred/eslint-config";

const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: ["**/dist/**/*", "**/node_modules/**/*", "**/*.md"],
  }),
  { rules: { "no-console": "off" } },
];

export default config;
