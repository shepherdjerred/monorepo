import { recommended } from "@shepherdjerred/eslint-config";
const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: true,
    ignores: [
      // Deliberate layer violations, rejected by `check-architecture` rather
      // than linted. This list overrides the shared config's defaults, which
      // already exclude them.
      "**/architecture-fixtures/**/*",
      "**/dist/**/*",
      "**/generated/**/*",
      "src/protocol/generated.ts",
      "**/node_modules/**/*",
      "**/*.md",
      "**/*.js",
      "**/*.cjs",
      "**/*.mjs",
      "eslint.config.ts",
    ],
  }),
  {
    files: ["prisma.config.ts"],
    rules: {
      "custom-rules/prefer-bun-apis": "off",
    },
  },
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
    files: ["src/engine/watcher.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
export default config;
