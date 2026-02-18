import { recommended } from "../packages/eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: ["test/**/*", "eslint.config.ts"],
  }),
  {
    rules: {
      // Dagger CI code uses console for build output
      "no-console": "off",
      // Dagger modules use re-exports for API surface
      "custom-rules/no-re-exports": "off",
      // Dagger code imports from parent lib/ directory
      "custom-rules/no-parent-imports": "off",
      // Dagger @func() parameters become CLI flags - many are required
      "max-params": "off",
      // CI orchestration files are inherently large
      "max-lines": "off",
      "max-lines-per-function": "off",
      // CI orchestration has complex conditional logic
      "complexity": "off",
      // Dagger uses .then().catch() for parallel task execution
      "custom-rules/prefer-async-await": "off",
    },
  },
];
