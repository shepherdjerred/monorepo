/**
 * Base ESLint configuration with core rules and TypeScript support
 */
import * as eslint from "@eslint/js";
import * as tseslint from "typescript-eslint";
import * as regexpPlugin from "eslint-plugin-regexp";
import * as eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import type { TSESLint } from "@typescript-eslint/utils";

export type BaseConfigOptions = {
  tsconfigRootDir?: string;
  projectService?: boolean | { allowDefaultProject?: string[] };
  ignores?: string[];
};

/**
 * Base configuration with ESLint recommended, TypeScript strict, and core quality rules
 */
export function baseConfig(options: BaseConfigOptions = {}): TSESLint.FlatConfig.ConfigArray {
  const {
    tsconfigRootDir = process.cwd(),
    projectService = true,
    ignores = [
      "**/generated/**/*",
      "**/dist/**/*",
      "**/build/**/*",
      "**/.cache/**/*",
      "**/node_modules/**/*",
      "**/.astro/**/*",
      ".dagger/sdk/**/*",
      "**/*.md",
      "**/*.mdx",
      "**/*.mjs",
      "**/*.js",
      "**/*.cjs",
    ],
  } = options;

  return [
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    regexpPlugin.configs["flat/recommended"],
    {
      ignores,
    },
    {
      languageOptions: {
        parserOptions: {
          projectService,
          tsconfigRootDir,
        },
      },
    },
    // ESLint disable directive rules
    {
      plugins: {
        "eslint-comments": eslintComments as unknown,
      },
      rules: {
        // Require specific rule names when disabling ESLint (no blanket eslint-disable)
        "eslint-comments/no-unlimited-disable": "error",
        // Disallow unused eslint-disable comments
        "eslint-comments/no-unused-disable": "error",
        // Require descriptions for eslint-disable comments
        "eslint-comments/require-description": "error",
        // Disallow duplicate disable directives
        "eslint-comments/no-duplicate-disable": "error",
      },
    },
    {
      rules: {
        // Code quality and complexity limits
        "max-lines": ["error", { max: 500, skipBlankLines: false, skipComments: false }],
        "max-lines-per-function": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
        complexity: ["error", { max: 20 }],
        "max-depth": ["error", { max: 4 }],
        "max-params": ["error", { max: 4 }],
        curly: ["error", "all"],

        // TypeScript configuration
        "@typescript-eslint/consistent-type-definitions": ["error", "type"],
        "@typescript-eslint/consistent-type-imports": [
          "error",
          {
            prefer: "type-imports",
            disallowTypeAnnotations: true,
          },
        ],
        "@typescript-eslint/no-non-null-assertion": "error",
        "@typescript-eslint/no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            caughtErrorsIgnorePattern: "^_",
          },
        ],
        "@typescript-eslint/no-unnecessary-type-assertion": "error",
        "@typescript-eslint/prefer-ts-expect-error": "error",
        "@typescript-eslint/switch-exhaustiveness-check": "error",
        "@typescript-eslint/no-redundant-type-constituents": "error",
        "@typescript-eslint/no-duplicate-type-constituents": "error",
        "@typescript-eslint/no-meaningless-void-operator": "error",
        "@typescript-eslint/no-mixed-enums": "error",
        "@typescript-eslint/prefer-return-this-type": "error",
      },
    },
  ] as TSESLint.FlatConfig.ConfigArray;
}
