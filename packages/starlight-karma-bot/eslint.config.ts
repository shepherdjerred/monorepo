import { recommended, type TSESLint } from "@shepherdjerred/eslint-config";

const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: ["**/generated/**/*", "**/node_modules/**/*", "data/"],
  }),
  {
    // Loaded by the Prisma CLI, which is not guaranteed to be the Bun runtime,
    // so `Bun.env` is not available here.
    files: ["prisma.config.ts"],
    rules: {
      "custom-rules/prefer-bun-apis": "off",
    },
  },
];

export default config;
