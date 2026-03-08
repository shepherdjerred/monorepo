import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: [
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
      "custom-rules/no-parent-imports": "off",
    },
  },
  {
    files: ["src/index.ts"],
    rules: {
      "custom-rules/no-re-exports": "off",
    },
  },
];
