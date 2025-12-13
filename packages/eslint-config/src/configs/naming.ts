/**
 * Naming convention configuration
 */
import unicorn from "eslint-plugin-unicorn";
import type { TSESLint } from "@typescript-eslint/utils";

/**
 * Configuration for file and identifier naming conventions
 */
export function namingConfig(): TSESLint.FlatConfig.ConfigArray {
  return [
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
    // Variable and identifier naming conventions
    {
      rules: {
        "@typescript-eslint/naming-convention": [
          "error",
          // Functions: camelCase (React components can be PascalCase)
          {
            selector: "function",
            format: ["camelCase", "PascalCase"],
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
  ] as TSESLint.FlatConfig.ConfigArray;
}
