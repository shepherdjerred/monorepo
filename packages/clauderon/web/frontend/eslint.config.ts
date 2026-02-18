import { recommended } from "../../../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    react: true,
    accessibility: true,
    projectService: {
      allowDefaultProject: [
        "eslint.config.ts",
        "src/components/theme-toggle.test.tsx",
        "src/components/recreate-blocked-modal.test.tsx",
        "src/components/recreate-confirm-modal.test.tsx",
        "src/components/startup-health-modal.test.tsx",
        "src/lib/claude-parser.test.ts",
        "src/lib/codex-history-parser.test.ts",
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
      // TypeShare-generated types from Rust cause ESLint type resolution issues.
      // TypeScript's own checker resolves these correctly — this is a tooling limitation.
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
      // Regex for ANSI escape codes in terminal output parsing
      "no-control-regex": "off",
    },
  },
];
