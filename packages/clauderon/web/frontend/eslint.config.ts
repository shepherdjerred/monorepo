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
];
