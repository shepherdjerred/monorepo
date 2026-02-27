import { recommended } from "../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: [
      "**/dist/**/*",
      "**/node_modules/**/*",
      "**/scripts/**/*",
      "eslint.config.ts",
    ],
  }),
  {
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["src/watcher.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
