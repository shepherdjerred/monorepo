import { recommended } from "@shepherdjerred/eslint-config";
const config = [
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
    files: ["src/index.ts", "src/v2.ts"],
    rules: {
      "custom-rules/no-re-exports": "off",
    },
  },
];
export default config;
