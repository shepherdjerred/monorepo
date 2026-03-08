import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: ["src/__tests__/*.test.ts"],
    },
    ignores: [
      "**/dist/**/*",
      "**/node_modules/**/*",
      "**/*.md",
      "**/*.js",
      "**/*.cjs",
      "**/*.mjs",
      "eslint.config.ts",
    ],
  }),
  {
    rules: {
      "no-console": "off",
      "custom-rules/no-parent-imports": "off",
    },
  },
  {
    files: ["src/domain/types.ts", "src/domain/schemas.ts"],
    rules: {
      "custom-rules/no-re-exports": "off",
    },
  },
  {
    files: ["src/vault/watcher.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
