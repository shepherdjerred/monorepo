import { recommended } from "@shepherdjerred/eslint-config";
const config = [
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
export default config;
