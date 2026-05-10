import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

const packageScaffoldRules: TSESLint.FlatConfig.Config = {
  files: ["src/**/*.ts", "tests/**/*.ts"],
  rules: {
    "@typescript-eslint/no-redundant-type-constituents": "off",
    "@typescript-eslint/no-unnecessary-condition": "off",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/prefer-nullish-coalescing": "off",
    "@typescript-eslint/restrict-plus-operands": "off",
    "@typescript-eslint/restrict-template-expressions": "off",
    "@typescript-eslint/strict-boolean-expressions": "off",
    "custom-rules/no-re-exports": "off",
    "custom-rules/zod-schema-naming": "off",
    complexity: "off",
    "max-params": "off",
    "unicorn/no-array-callback-reference": "off",
  },
};

const config: TSESLint.FlatConfig.ConfigArray = [
  {
    ignores: ["eslint.config.ts"],
  },
  ...recommended({ tsconfigRootDir: import.meta.dirname, react: false }),
  packageScaffoldRules,
];

export default config;
