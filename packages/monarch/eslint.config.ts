import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
  }),
  { ignores: ["scripts/"] },
  { rules: { "no-console": "off" } },
  {
    files: ["src/index.ts"],
    rules: { "max-lines": ["error", 750] },
  },
  {
    files: ["src/lib/**/*.ts"],
    rules: { "custom-rules/no-parent-imports": "off" },
  },
];
