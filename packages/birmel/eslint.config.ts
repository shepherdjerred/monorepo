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
      "custom-rules/no-re-exports": "off",
      // 143 type assertions across 93 files -- mostly Discord.js channel casts,
      // Mastra tool record casts, and JSON.parse results.
      "custom-rules/no-type-assertions": "off",
      // Discord bot tool handlers commonly receive many parameters from tool context.
      "max-params": ["error", { max: 6 }],
      // Complex switch/case tool dispatch and config loading exceeds default of 20.
      "complexity": ["error", { max: 30 }],
      // Deeply nested tool dispatch and conditional logic.
      "max-depth": ["error", { max: 6 }],
    },
  },
];
