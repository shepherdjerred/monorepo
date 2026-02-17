/// <reference path="../types.d.ts" />
/**
 * Base ESLint configuration with core rules and TypeScript support
 */
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import regexpPlugin from "eslint-plugin-regexp";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import unicorn from "eslint-plugin-unicorn";
import noSecrets from "eslint-plugin-no-secrets";
import type { TSESLint } from "@typescript-eslint/utils";

export type BaseConfigOptions = {
  tsconfigRootDir?: string;
  projectService?: boolean | { allowDefaultProject?: string[] };
  ignores?: string[];
};

/**
 * Base configuration with ESLint recommended, TypeScript strict, and core quality rules
 */
export function baseConfig(
  options: BaseConfigOptions = {},
): TSESLint.FlatConfig.ConfigArray {
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
    // Unicorn recommended with overrides
    unicorn.configs["flat/recommended"],
    {
      rules: {
        "unicorn/prevent-abbreviations": "off",
        "unicorn/no-null": "off",
        "unicorn/no-process-exit": "off",
        "unicorn/filename-case": ["error", { case: "kebabCase" }],
        "unicorn/prefer-single-call": "off",
        "unicorn/switch-case-braces": "off",
        "unicorn/no-immediate-mutation": "off",
        "unicorn/no-array-reduce": "off",
        "unicorn/no-array-for-each": "off",
        "unicorn/no-array-reverse": "off",
        "unicorn/prefer-top-level-await": "off",
      },
    },
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
    // Report unused disable directives as errors
    { linterOptions: { reportUnusedDisableDirectives: "error" } },
    // ESLint disable directive rules
    {
      plugins: {
        "eslint-comments": eslintComments as unknown,
      },
      rules: {
        "eslint-comments/no-unlimited-disable": "error",
        "eslint-comments/no-unused-disable": "error",
        "eslint-comments/require-description": "error",
        "eslint-comments/no-duplicate-disable": "error",
        "eslint-comments/no-unused-enable": "error",
        "eslint-comments/no-restricted-disable": [
          "error",
          "@typescript-eslint/no-explicit-any",
          "@typescript-eslint/no-unsafe-assignment",
        ],
        "eslint-comments/no-use": [
          "error",
          { allow: ["eslint-disable-next-line"] },
        ],
      },
    },
    // No secrets plugin
    {
      plugins: {
        "no-secrets": noSecrets,
      },
      rules: {
        "no-secrets/no-secrets": ["error", { tolerance: 4.5 }],
      },
    },
    {
      rules: {
        // Code quality and complexity limits
        "max-lines": [
          "error",
          { max: 500, skipBlankLines: false, skipComments: false },
        ],
        "max-lines-per-function": [
          "error",
          { max: 400, skipBlankLines: true, skipComments: true },
        ],
        complexity: ["error", { max: 20 }],
        "max-depth": ["error", { max: 4 }],
        "max-params": ["error", { max: 4 }],
        curly: ["error", "all"],
        "no-console": ["error", { allow: ["warn", "error"] }],
        "no-shadow": "off",

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
        "@typescript-eslint/ban-ts-comment": [
          "error",
          {
            "ts-ignore": true,
            "ts-nocheck": true,
            "ts-expect-error": "allow-with-description",
            minimumDescriptionLength: 10,
          },
        ],
        "@typescript-eslint/switch-exhaustiveness-check": "error",
        "@typescript-eslint/no-redundant-type-constituents": "error",
        "@typescript-eslint/no-duplicate-type-constituents": "error",
        "@typescript-eslint/no-meaningless-void-operator": "error",
        "@typescript-eslint/no-mixed-enums": "error",
        "@typescript-eslint/prefer-return-this-type": "error",
        "@typescript-eslint/strict-boolean-expressions": "warn",
        "@typescript-eslint/prefer-readonly": "error",
        "@typescript-eslint/require-array-sort-compare": "error",
        "@typescript-eslint/method-signature-style": ["error", "property"],
        "@typescript-eslint/no-shadow": "error",
      },
    },
    // Block Node.js module imports in favor of Bun equivalents
    {
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "fs",
                message: "Use Bun.file() / Bun.write() instead of Node fs.",
              },
              {
                name: "node:fs",
                message: "Use Bun.file() / Bun.write() instead of Node fs.",
              },
              {
                name: "fs/promises",
                message:
                  "Use Bun.file() / Bun.write() instead of Node fs/promises.",
              },
              {
                name: "child_process",
                message:
                  "Use Bun.spawn() / Bun.$ instead of Node child_process.",
              },
              {
                name: "crypto",
                message:
                  "Use Bun.CryptoHasher or Web Crypto API instead of Node crypto.",
              },
              {
                name: "path",
                message:
                  "Use Bun.pathToFileURL or import from 'node:path' if needed.",
              },
            ],
          },
        ],
      },
    },
  ] as TSESLint.FlatConfig.ConfigArray;
}
