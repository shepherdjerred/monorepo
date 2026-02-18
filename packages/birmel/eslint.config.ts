import { recommended } from "../eslint-config/local.ts";
export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: [
      "**/generated/**/*", "**/dist/**/*", "**/build/**/*",
      "**/.cache/**/*", "**/node_modules/**/*", "**/.astro/**/*",
      "**/*.md", "**/*.mdx", "**/*.mjs", "**/*.js", "**/*.cjs",
      ".mastra/", "data/",
    ],
  }),
  {
    rules: {
      "no-console": "off",
      // Birmel heavily uses external APIs (Discord.js, Mastra, Prisma, VoltAgent)
      // whose types ESLint's parser cannot resolve, producing thousands of false positives.
      // TypeScript's own type checker passes cleanly.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/restrict-plus-operands": "off",
      "@typescript-eslint/strict-boolean-expressions": "off",
      "@typescript-eslint/require-await": "off",
      // Discord bot uses barrel re-exports extensively across 85+ module boundaries.
      // Restructuring the entire import graph is out of scope.
      "custom-rules/no-re-exports": "off",
      // 143 type assertions across 93 files -- mostly Discord.js channel casts,
      // Mastra tool record casts, and JSON.parse results. Suppressed until
      // a dedicated migration adds Zod schemas and Discord type guards.
      "custom-rules/no-type-assertions": "off",
    },
  },
];
