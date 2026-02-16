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
    "zod-schema-naming": zodSchemaNaming as never,
  },
};

// Note: ESLint caching is enabled via --cache CLI flag in package.json scripts
export default defineConfig(
  eslint.configs.recommended,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore-error -- https://github.com/typescript-eslint/typescript-eslint/issues/10899
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
      // Prefer Bun APIs over Node.js imports
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "fs",
              message:
                "Use Bun.file() for reading and Bun.write() for writing instead of fs. See https://bun.sh/docs/api/file-io",
            },
            {
              name: "node:fs",
              message:
                "Use Bun.file() for reading and Bun.write() for writing instead of node:fs. See https://bun.sh/docs/api/file-io",
            },
            {
              name: "fs/promises",
              message:
                "Use Bun.file() for reading and Bun.write() for writing instead of fs/promises. See https://bun.sh/docs/api/file-io",
            },
            {
              name: "node:fs/promises",
              message:
                "Use Bun.file() for reading and Bun.write() for writing instead of node:fs/promises. See https://bun.sh/docs/api/file-io",
            },
            {
              name: "child_process",
              message:
                "Use Bun.spawn() instead of child_process for spawning processes. See https://bun.sh/docs/api/spawn",
            },
            {
              name: "node:child_process",
              message:
                "Use Bun.spawn() instead of node:child_process for spawning processes. See https://bun.sh/docs/api/spawn",
            },
            {
              name: "crypto",
              message:
                "Use Bun.password for password hashing, Bun.hash() for hashing, or Web Crypto API for cryptography instead of crypto. See https://bun.sh/docs/api/hashing",
            },
            {
              name: "node:crypto",
              message:
                "Use Bun.password for password hashing, Bun.hash() for hashing, or Web Crypto API for cryptography instead of node:crypto. See https://bun.sh/docs/api/hashing",
            },
          ],
          patterns: [
            {
              group: ["node:*"],
              message: "Avoid node: imports. Bun provides faster, more modern alternatives. See https://bun.sh/docs",
            },
          ],
        },
      ],
      "max-lines": ["error", { max: 1000, skipBlankLines: false, skipComments: false }],
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
          message:
            "Prefer Zod schema validation over typeof operator. Use schema.safeParse(value) which returns a result with .success for type narrowing, then access .data for validated value. Example: const result = z.string().safeParse(value); if (result.success) { result.data }. Use parse() only when you want to throw on invalid data (e.g., config validation).",
        },
        {
          selector: "CallExpression[callee.object.name='Array'][callee.property.name='isArray']",
          message:
            "Prefer Zod schema validation over Array.isArray(). Use schema.safeParse(value) which returns a result with .success for type narrowing, then access .data. Example: const result = z.array(z.string()).safeParse(value); if (result.success) { result.data }. Use parse() only when you want to throw on invalid data (e.g., config validation).",
        },
        {
          selector: "BinaryExpression[operator='instanceof']",
          message:
            "Prefer Zod schema validation over instanceof operator. Use schema.safeParse(value) which returns a result with .success for type narrowing, then access .data. Example: const result = z.instanceof(Error).safeParse(err); if (result.success) { result.data.message }. Use parse() only when you want to throw on invalid data (e.g., config validation).",
        },
        {
          selector: "CallExpression[callee.object.name='Number'][callee.property.name='isInteger']",
          message:
            "Prefer Zod schema validation over Number.isInteger(). Use schema.safeParse(value) which returns a result with .success for type narrowing, then access .data. Example: const result = z.number().int().safeParse(value); if (result.success) { result.data }. Use parse() only when you want to throw on invalid data (e.g., config validation).",
        },
        {
          selector: "CallExpression[callee.object.name='Number'][callee.property.name='isNaN']",
          message:
            "Prefer Zod schema validation over Number.isNaN(). Use schema.safeParse(value) which returns a result with .success for type narrowing. Zod's z.number() will fail on NaN. Example: const result = z.number().safeParse(value); if (result.success) { result.data }. Use parse() only when you want to throw on invalid data (e.g., config validation).",
        },
        {
          selector: "CallExpression[callee.object.name='Number'][callee.property.name='isFinite']",
          message:
            "Prefer Zod schema validation over Number.isFinite(). Use schema.safeParse(value) which returns a result with .success for type narrowing, then access .data. Example: const result = z.number().finite().safeParse(value); if (result.success) { result.data }. Use parse() only when you want to throw on invalid data (e.g., config validation).",
        },
        {
          selector: "TSTypePredicate",
          message:
            "Prefer Zod schema validation over type guard functions. Use schema.safeParse(value) which returns a result with .success for type narrowing, then access .data. This replaces custom type predicates with runtime-validated types. Use parse() only when you want to throw on invalid data (e.g., config validation).",
        },
        {
          selector: "TSTypeAssertion:not([typeAnnotation.type='TSUnknownKeyword'])",
          message:
            "Type assertions are not allowed except for casting to 'unknown'. For type validation: use schema.safeParse(value) which returns a result with .success for type narrowing, then access .data for the validated value. Use parse() only when you want to throw on invalid data (e.g., config validation).",
        },
        {
          selector:
            "TSAsExpression:not([typeAnnotation.type='TSUnknownKeyword']):not([typeAnnotation.type='TSTypeReference'][typeAnnotation.typeName.name='const'])",
          message:
            "Type assertions are not allowed except for 'as unknown' or 'as const'. For dynamic data: use schema.safeParse(value) which returns a result with .success for type narrowing, then access .data. For literals: use 'as const'. Use parse() only when you want to throw on invalid data (e.g., config validation).",
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            "Use Bun.env instead of process.env to access environment variables. Bun.env is a more modern, typed alternative. See https://bun.sh/docs/runtime/env",
        },
        {
          selector: "Identifier[name='__dirname']",
          message:
            "Use import.meta.dir instead of __dirname. import.meta.dir is the ESM-native way to get the directory path. See https://bun.sh/docs/api/import-meta",
        },
        {
          selector: "Identifier[name='__filename']",
          message:
            "Use import.meta.path instead of __filename. import.meta.path is the ESM-native way to get the file path. See https://bun.sh/docs/api/import-meta",
        },
        {
          selector: "CallExpression[callee.name='require']",
          message:
            "Use ESM import statements instead of require(). Bun fully supports ESM and it's the modern standard. Example: import { foo } from 'module'",
        },
        {
          selector: "Identifier[name='Buffer']:not(VariableDeclarator > Identifier[name='Buffer'])",
          message:
            "Prefer Uint8Array or Bun's binary data APIs over Buffer. For file operations, use Bun.file() which handles binary data natively. See https://bun.sh/docs/api/binary-data",
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
    ignores: ["dist/", "node_modules/", "generated/", ".dagger/sdk/"],
  },
);
