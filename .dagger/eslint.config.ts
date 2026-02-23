import { recommended } from "../packages/eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: ["test/**/*", "eslint.config.ts"],
  }),
  {
    rules: {
      "no-console": "off",
    },
  },
  // Dagger @func() parameters become CLI flags - many are required.
  // max-lines is raised because these files grow with each monorepo package.
  {
    files: ["src/index.ts"],
    rules: { "max-params": "off", "max-lines": ["error", 750] },
  },
  {
    files: [
      "src/homelab-ci-steps.ts",
      "src/index-ci-helpers.ts",
      "src/index-release-helpers.ts",
    ],
    rules: { "max-lines": ["error", 750] },
  },
];
