import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: [
      "**/dist/**/*",
      "**/node_modules/**/*",
      "**/*.js",
      "**/*.mjs",
    ],
  }),
];
