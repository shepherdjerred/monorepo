import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import unicorn from "eslint-plugin-unicorn";
import { zodSchemaNaming } from "./eslint-rules/zod-schema-naming.ts";

/**
 * Bridge typescript-eslint rule to ESLint plugin system
 *
 * Type assertion required: @typescript-eslint/utils RuleContext includes extra methods
 * (getAncestors, getDeclaredVariables, getScope, markVariableAsUsed) that base ESLint
 * RuleContext doesn't have. At runtime, typescript-eslint provides a compatible context,
 * but TypeScript sees the types as incompatible. The rule works correctly at runtime.
 */
const customRulesPlugin = {
  rules: {
    // eslint-disable-next-line no-restricted-syntax
    "zod-schema-naming": zodSchemaNaming as never,
  },
};

// Note: ESLint caching is enabled via --cache CLI flag in package.json scripts
export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "max-lines": ["error", { max: 500, skipBlankLines: false, skipComments: false }],
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          assertionStyle: "as",
          objectLiteralTypeAssertions: "never",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "UnaryExpression[operator='typeof']",
          message: "Prefer Zod schema validation over typeof operator. Use z.string(), z.number(), etc. instead.",
        },
        {
          selector: "CallExpression[callee.object.name='Array'][callee.property.name='isArray']",
          message: "Prefer Zod schema validation over Array.isArray(). Use z.array() instead.",
        },
        {
          selector: "BinaryExpression[operator='instanceof']",
          message:
            "Prefer Zod schema validation over instanceof operator. Use appropriate z.instanceof() or custom Zod schemas instead.",
        },
        {
          selector: "CallExpression[callee.object.name='Number'][callee.property.name='isInteger']",
          message: "Prefer Zod schema validation over Number.isInteger(). Use z.number().int() instead.",
        },
        {
          selector: "CallExpression[callee.object.name='Number'][callee.property.name='isNaN']",
          message:
            "Prefer Zod schema validation over Number.isNaN(). Use z.number() with proper error handling instead.",
        },
        {
          selector: "CallExpression[callee.object.name='Number'][callee.property.name='isFinite']",
          message: "Prefer Zod schema validation over Number.isFinite(). Use z.number().finite() instead.",
        },
        {
          selector: "TSTypePredicate",
          message:
            "Prefer Zod schema validation over type guard functions. Use z.schema.safeParse() instead of custom type guards.",
        },
        {
          selector: "TSTypeAssertion:not([typeAnnotation.type='TSUnknownKeyword'])",
          message:
            "Type assertions are not allowed except for casting to 'unknown'. Use 'value as unknown' if you need to cast to unknown, otherwise use Zod schema validation.",
        },
        {
          selector:
            "TSAsExpression:not([typeAnnotation.type='TSUnknownKeyword']):not([typeAnnotation.type='TSTypeReference'][typeAnnotation.typeName.name='const'])",
          message:
            "Type assertions are not allowed except for casting to 'unknown' or 'as const'. Use 'value as unknown' if you need to cast to unknown, 'value as const' for const assertions, otherwise use Zod schema validation.",
        },
      ],
    },
  },
  // Allow instanceof for Discord.js error handling and channel type checking
  {
    files: ["**/discord/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "UnaryExpression[operator='typeof']",
          message: "Prefer Zod schema validation over typeof operator. Use z.string(), z.number(), etc. instead.",
        },
        {
          selector: "TSTypePredicate",
          message:
            "Prefer Zod schema validation over type guard functions. Use z.schema.safeParse() instead of custom type guards.",
        },
        {
          selector: "TSTypeAssertion:not([typeAnnotation.type='TSUnknownKeyword'])",
          message:
            "Type assertions are not allowed except for casting to 'unknown'. Use 'value as unknown' if you need to cast to unknown, otherwise use Zod schema validation.",
        },
        {
          selector:
            "TSAsExpression:not([typeAnnotation.type='TSUnknownKeyword']):not([typeAnnotation.type='TSTypeReference'][typeAnnotation.typeName.name='const'])",
          message:
            "Type assertions are not allowed except for casting to 'unknown' or 'as const'. Use 'value as unknown' if you need to cast to unknown, 'value as const' for const assertions, otherwise use Zod schema validation.",
        },
      ],
    },
  },
  // File naming conventions
  {
    plugins: {
      unicorn,
    },
    rules: {
      "unicorn/filename-case": [
        "error",
        {
          case: "kebabCase",
        },
      ],
    },
  },
  // Custom rules for Zod schema naming
  {
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "custom-rules/zod-schema-naming": "error",
    },
  },
  // Variable and identifier naming conventions
  {
    rules: {
      "@typescript-eslint/naming-convention": [
        "error",
        // Functions: camelCase
        {
          selector: "function",
          format: ["camelCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "allow",
        },
        // Constants: UPPER_SNAKE_CASE or camelCase (excluding *Schema variables - handled by custom rule)
        {
          selector: "variable",
          modifiers: ["const"],
          filter: {
            regex: "Schema$",
            match: false,
          },
          format: ["camelCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
          trailingUnderscore: "allow",
        },
        // All other variables: camelCase (excluding *Schema variables - handled by custom rule)
        {
          selector: "variable",
          filter: {
            regex: "Schema$",
            match: false,
          },
          format: ["camelCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "allow",
        },
        // Parameters: camelCase
        {
          selector: "parameter",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        // Types, interfaces, classes: PascalCase
        {
          selector: ["typeLike"],
          format: ["PascalCase"],
        },
        // Enum members: PascalCase or UPPER_CASE
        {
          selector: "enumMember",
          format: ["PascalCase", "UPPER_CASE"],
        },
      ],
    },
  },
  {
    ignores: ["dist/", "node_modules/", "eslint-rules/", "data/", ".dagger/sdk/"],
  },
);
