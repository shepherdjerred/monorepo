import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
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
];
