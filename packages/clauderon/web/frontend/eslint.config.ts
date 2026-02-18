import { recommended } from "../../../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    react: true,
    accessibility: true,
    projectService: {
      allowDefaultProject: [
        "eslint.config.ts",
        "src/components/ThemeToggle.test.tsx",
        "src/components/RecreateBlockedModal.test.tsx",
        "src/components/RecreateConfirmModal.test.tsx",
        "src/components/StartupHealthModal.test.tsx",
        "src/lib/claudeParser.test.ts",
        "src/lib/codexHistoryParser.test.ts",
      ],
    },
    ignores: [
      "**/generated/**/*", "**/dist/**/*", "**/build/**/*",
      "**/.cache/**/*", "**/node_modules/**/*", "**/.astro/**/*",
      "**/*.md", "**/*.mdx", "**/*.mjs", "**/*.js", "**/*.cjs",
      "tests/", "postcss.config.js", "tailwind.config.js", "vite.config.ts",
    ],
  }),
  {
    rules: {
      // TypeShare-generated types (MergeMethod, MergePrRequest, etc.) cause cascading
      // unresolved type errors — ESLint's parser cannot resolve them even though TypeScript can.
      // This is a TypeShare tooling limitation, not a code quality issue.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/restrict-plus-operands": "off",
      // TypeShare types cascade to nullable coalescing and boolean expression checks
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/strict-boolean-expressions": ["error", { allowNullableString: true, allowNullableBoolean: true, allowAny: true }],
      // File naming migration is a separate effort
      "unicorn/filename-case": "off",
      // Regex for ANSI escape codes in terminal output parsing
      "no-control-regex": "off",
      // Type assertions pervasive throughout frontend due to TypeShare types and API responses
      "custom-rules/no-type-assertions": "off",
      // Type guards used for discriminated union narrowing (TypeShare types)
      "custom-rules/no-type-guards": "off",
      // .then() patterns in existing React hooks — gradual migration
      "custom-rules/prefer-async-await": "off",
      // Frontend components have inherent complexity from UI state management
      "max-lines": ["error", { max: 600, skipBlankLines: false, skipComments: false }],
      "max-lines-per-function": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
      complexity: ["error", { max: 25 }],
      // JSX conditional rendering patterns use nested ternaries
      "unicorn/no-nested-ternary": "off",
      // Math.trunc preference
      "unicorn/prefer-math-trunc": "off",
    },
  },
];
