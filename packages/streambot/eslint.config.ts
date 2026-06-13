import { recommended, type TSESLint } from "@shepherdjerred/eslint-config";

const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: [
      "**/generated/**/*",
      "**/dist/**/*",
      "**/build/**/*",
      "**/.cache/**/*",
      "**/node_modules/**/*",
      "**/*.md",
      "**/*.mdx",
      "**/*.mjs",
      "**/*.js",
      "**/*.cjs",
    ],
  }),
  { rules: { "no-console": "off" } },
];

export default config;
