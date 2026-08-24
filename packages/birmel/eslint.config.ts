import { recommended, type TSESLint } from "@shepherdjerred/eslint-config";
const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: [
      // Deliberate layer violations, rejected by `check-architecture` rather
      // than linted. This list overrides the shared config's defaults, which
      // already exclude them.
      "**/architecture-fixtures/**/*",
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
