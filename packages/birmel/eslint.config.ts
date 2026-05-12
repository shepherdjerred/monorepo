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
      "**/.astro/**/*",
      "**/*.md",
      "**/*.mdx",
      "**/*.mjs",
      "**/*.js",
      "**/*.cjs",
      ".mastra/",
      "data/",
    ],
  }),
  {
    files: ["prisma.config.ts"],
    rules: {
      "custom-rules/prefer-bun-apis": "off",
    },
  },
  { rules: { "no-console": "off" } },
];
export default config;
