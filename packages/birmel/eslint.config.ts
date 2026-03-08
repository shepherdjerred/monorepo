import { recommended } from "@shepherdjerred/eslint-config";
export default [
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
  { rules: { "no-console": "off" } },
];
