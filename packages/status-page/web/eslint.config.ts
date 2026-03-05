import { recommended } from "../../eslint-config/local.ts";
export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: [
      "**/dist/**/*",
      "**/node_modules/**/*",
      "**/.astro/**/*",
      "**/*.mjs",
      "**/*.js",
      "**/*.cjs",
    ],
  }),
];
