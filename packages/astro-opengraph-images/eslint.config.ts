import { recommended } from "@shepherdjerred/eslint-config";
const config = [
  {
    ignores: [
      "examples/**",
      "dist/**",
      "eslint.config.ts",
      "vitest.config.mts",
    ],
  },
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    tsconfigPaths: ["./tsconfig.json"],
  }),
  {
    files: ["src/index.ts"],
    rules: {
      "custom-rules/no-re-exports": "off",
      "unicorn/prefer-export-from": "off",
    },
  },
];
export default config;
