import { recommended } from "./local.ts";
import type { TSESLint } from "@typescript-eslint/utils";

const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: [
        "eslint.config.ts",
        "local.ts",
        "local-rules.ts",
        "src/rules/*.test.ts",
      ],
      maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 25,
    },
    ignores: ["dist/**/*", "local.js", "local.d.ts"],
  }),
  // Library entry points use re-exports and .js extensions by design
  {
    files: ["src/index.ts", "src/rules/index.ts", "local.ts", "local-rules.ts"],
    rules: {
      "custom-rules/no-re-exports": "off",
      "custom-rules/require-ts-extensions": "off",
      "unicorn/prefer-export-from": "off",
    },
  },
  // Config files use .js extensions and type assertions for ESLint plugin setup
  {
    files: ["src/configs/*.ts"],
    rules: {
      "custom-rules/require-ts-extensions": "off",
      "custom-rules/no-type-assertions": "off",
      "@typescript-eslint/triple-slash-reference": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-misused-spread": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  // ESLint rule implementations work with ESTree AST types which require
  // type assertions, enum comparisons, and nested helper functions in visitors.
  {
    files: ["src/rules/*.ts", "src/rules/shared/*.ts"],
    rules: {
      "custom-rules/no-type-assertions": "off",
      "custom-rules/require-ts-extensions": "off",
      "@typescript-eslint/no-unsafe-enum-comparison": "off",
      "unicorn/consistent-function-scoping": "off",
      complexity: ["error", { max: 30 }],
      "max-depth": ["error", { max: 6 }],
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/strict-boolean-expressions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "custom-rules/prefer-zod-validation": "off",
      "no-restricted-imports": "off",
      "unicorn/import-style": "off",
      "unicorn/text-encoding-identifier-case": "off",
      "regexp/no-unused-capturing-group": "off",
      "regexp/no-dupe-disjunctions": "off",
      "@typescript-eslint/triple-slash-reference": "off",
      "@typescript-eslint/switch-exhaustiveness-check": "off",
      "@typescript-eslint/no-misused-spread": "off",
      "@typescript-eslint/no-deprecated": "off",
    },
  },
];
export default config;
