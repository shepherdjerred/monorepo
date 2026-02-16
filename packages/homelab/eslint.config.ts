import { recommended } from "../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    customRules: { zod: true },
  }),
  // Homelab-specific overrides for infrastructure/CLI code
  {
    rules: {
      // Infrastructure code uses console.log extensively for CLI output
      "no-console": "off",
      // Relaxed limits for infrastructure scripts with complex logic
      "max-depth": ["error", { max: 6 }],
      "max-lines": ["error", { max: 800, skipBlankLines: false, skipComments: false }],
      "max-lines-per-function": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", { max: 8 }],
      complexity: ["error", { max: 50 }],
      // Strict boolean expressions is too noisy for infrastructure code
      "@typescript-eslint/strict-boolean-expressions": "off",
      // 1Password vault references and postgres template URLs trigger false positives
      "no-secrets/no-secrets": "off",
      // Infrastructure code uses regex with capturing groups for readability
      "regexp/no-unused-capturing-group": "off",
      "regexp/no-super-linear-backtracking": "off",
      // Variable shadowing in nested scopes is common in infra scripts
      "@typescript-eslint/no-shadow": "off",
      // async/await style is not enforced for infrastructure code
      "custom-rules/prefer-async-await": "off",
      // Relaxed unicorn rules for infrastructure code
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-array-callback-reference": "off",
      "unicorn/import-style": "off",
      "unicorn/text-encoding-identifier-case": "off",
      "unicorn/prefer-ternary": "off",
      "unicorn/no-array-sort": "off",
      // Explicit undefined args are needed for TypeScript strict mode in Zod safeParse calls
      "unicorn/no-useless-undefined": "off",
      // eslint-comments rules are too strict for infra code with needed suppressions
      "eslint-comments/require-description": "off",
      "eslint-comments/no-use": "off",
      "eslint-comments/no-unlimited-disable": "off",
      "eslint-comments/no-restricted-disable": "off",
      // Existing ts-nocheck/ts-ignore in generated/infra files
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
  {
    ignores: ["src/talos/", "src/*/eslint.config.ts", "scripts/", "eslint.config.ts"],
  },
];
