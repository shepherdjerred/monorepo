import { recommended } from "@shepherdjerred/eslint-config";

export default [
  {
    ignores: [
      "fetcher/**",
      "vite.config.ts",
      "eslint.config.ts",
      "**/*.test.ts",
    ],
  },
  ...recommended({ tsconfigRootDir: import.meta.dirname, react: true }),
];
