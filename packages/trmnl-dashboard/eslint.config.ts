import { recommended } from "@shepherdjerred/eslint-config";

// No explicit `TSESLint.FlatConfig.ConfigArray` annotation: trmnl-dashboard
// and eslint-config can resolve different patch versions of
// `@typescript-eslint/utils` under Dagger's per-package
// `bun install --frozen-lockfile`, and the resulting `Config` types are
// nominally incompatible under `exactOptionalPropertyTypes: true`.
// Letting TS infer the array shape keeps this file portable.
const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: true,
    ignores: [
      "**/dist/**/*",
      "**/node_modules/**/*",
      "**/*.md",
      "**/*.liquid",
      "eslint.config.ts",
    ],
  }),
  {
    rules: {
      "no-console": "off",
      "custom-rules/no-parent-imports": "off",
    },
  },
];

export default config;
