import { recommended } from "../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
  }),
  { ignores: ["scripts/"] },
  { rules: { "no-console": "off" } },
  {
    files: ["src/lib/**/*.ts"],
    rules: { "custom-rules/no-parent-imports": "off" },
  },
];
