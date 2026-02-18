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
      // TypeShare-generated types cause cascading unsafe-* errors throughout the frontend
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      // File naming migration is too large for this changeset
      "unicorn/filename-case": "off",
      // Relax complexity limits for this frontend
      "max-lines": ["warn", { max: 700, skipBlankLines: false, skipComments: false }],
      "max-lines-per-function": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
      "max-depth": ["warn", { max: 5 }],
      complexity: ["warn", { max: 25 }],
      // Regex for ANSI escape codes
      "no-control-regex": "off",
      // Many unused vars from useEffect removal and state setter destructuring
      "@typescript-eslint/no-unused-vars": "warn",
      // Gradual migration: type assertions pervasive throughout frontend (TypeShare types, API responses)
      "custom-rules/no-type-assertions": "warn",
      // Gradual migration: type guards used for discriminated unions
      "custom-rules/no-type-guards": "warn",
      // Gradual migration: .then() patterns in existing hooks
      "custom-rules/prefer-async-await": "warn",
      // Nested ternaries in JSX conditional rendering
      "unicorn/no-nested-ternary": "warn",
      // Math.trunc preference
      "unicorn/prefer-math-trunc": "warn",
      // Allow || for JSX default values
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      // Template expression type safety
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/restrict-plus-operands": "warn",
    },
  },
  {
    files: ["**/*.tsx", "**/*.jsx"],
    rules: {
      // Existing React patterns
      "react/no-unescaped-entities": "warn",
    },
  },
];
