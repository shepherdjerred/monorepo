import { recommended } from "../eslint-config/local.ts";
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
