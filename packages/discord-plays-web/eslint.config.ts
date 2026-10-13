import { recommended, type TSESLint } from "@shepherdjerred/eslint-config";

const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    react: true,
    accessibility: true,
    ignores: ["**/dist/**/*", "**/node_modules/**/*", "**/*.md"],
  }),
];

export default config;
