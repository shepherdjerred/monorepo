/* eslint-disable max-lines -- can't really split this up */
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import * as eslint from "@eslint/js";
import * as tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";
import { zodSchemaNaming } from "./eslint-rules/zod-schema-naming";
import { noRedundantZodParse } from "./eslint-rules/no-redundant-zod-parse";
import { satoriBestPractices } from "./eslint-rules/satori-best-practices";
import { prismaClientDisconnect } from "./eslint-rules/prisma-client-disconnect";
import { noTypeAssertions } from "./eslint-rules/no-type-assertions";
import { preferZodValidation } from "./eslint-rules/prefer-zod-validation";
import { preferBunApis } from "./eslint-rules/prefer-bun-apis";
import { noReExports } from "./eslint-rules/no-re-exports";
import { noUseEffect } from "./eslint-rules/no-use-effect";
import { preferDateFns } from "./eslint-rules/prefer-date-fns";
import { noFunctionOverloads } from "./eslint-rules/no-function-overloads";
import { noParentImports } from "./eslint-rules/no-parent-imports";
import { noTypeGuards } from "./eslint-rules/no-type-guards";
import { preferAsyncAwait } from "./eslint-rules/prefer-async-await";
import { noDtoNaming } from "./eslint-rules/no-dto-naming";
import { preferStructuredLogging } from "./eslint-rules/prefer-structured-logging";
import { requireTsExtensions } from "./eslint-rules/require-ts-extensions";
import { knipUnused } from "./eslint-rules/knip-unused";
import { noCodeDuplication } from "./eslint-rules/jscpd-duplication";
import { noShadcnThemeTokens } from "./eslint-rules/no-shadcn-theme-tokens";
import * as importPlugin from "eslint-plugin-import";
import * as regexpPlugin from "eslint-plugin-regexp";
import * as eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import * as react from "eslint-plugin-react";
import * as reactHooks from "eslint-plugin-react-hooks";
import * as jsxA11y from "eslint-plugin-jsx-a11y";
import * as astroPlugin from "eslint-plugin-astro";
// MDX linting disabled - parser doesn't support type-aware rules
// import mdx from "eslint-plugin-mdx";
// Tailwind linting disabled - plugin incompatible with Tailwind CSS v4
// import tailwindcss from "eslint-plugin-tailwindcss";

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
    "zod-schema-naming": zodSchemaNaming,
    "no-redundant-zod-parse": noRedundantZodParse,
    "satori-best-practices": satoriBestPractices,
    "prisma-client-disconnect": prismaClientDisconnect,
    "no-type-assertions": noTypeAssertions,
    "prefer-zod-validation": preferZodValidation,
    "prefer-bun-apis": preferBunApis,
    "no-re-exports": noReExports,
    "no-use-effect": noUseEffect,
    "prefer-date-fns": preferDateFns,
    "no-function-overloads": noFunctionOverloads,
    "no-parent-imports": noParentImports,
    "no-type-guards": noTypeGuards,
    "prefer-async-await": preferAsyncAwait,
    "no-dto-naming": noDtoNaming,
    "prefer-structured-logging": preferStructuredLogging,
    "require-ts-extensions": requireTsExtensions,
    "knip-unused": knipUnused,
    "no-code-duplication": noCodeDuplication,
    "no-shadcn-theme-tokens": noShadcnThemeTokens,
  },
};

// eslint-disable-next-line @typescript-eslint/no-deprecated -- we will fix this later
export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  regexpPlugin.configs["flat/recommended"],
  {
    ignores: [
      "**/generated/**/*",
      "**/dist/**/*",
      "**/build/**/*",
      "**/.cache/**/*",
      "**/node_modules/**/*",
      "**/.astro/**/*",
      ".dagger/sdk/**/*",
      "**/src-tauri/target/**/*",
      "**/*.md",
      "**/*.mdx",
      "**/*.astro",
      "**/*.mjs",
      "**/*.js",
      "**/*.cjs",
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.ts",
            "eslint-rules/*.ts",
            "eslint-rules/shared/*.ts",
            "*/tailwind.config.ts",
          ],
        },
        tsconfigRootDir: dirname(fileURLToPath(import.meta.url)),
        extraFileExtensions: [".astro"],
      },
    },
  },
  // ESLint disable directive rules
  {
    plugins: {
      // Type assertion needed due to ESLint plugin type incompatibility
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
    files: ["**/*.{ts,tsx}"],
    extends: [importPlugin.flatConfigs.recommended, importPlugin.flatConfigs.typescript],
    settings: {
      "import/resolver": {
        // Use the Bun-specific TypeScript resolver which properly handles Bun built-in modules
        // (e.g., bun:test, bun:sqlite) without requiring ignore patterns or manual configuration.
        // See: https://www.npmjs.com/package/eslint-import-resolver-typescript-bun
        "typescript-bun": {
          alwaysTryTypes: true,
          project: [
            "./backend/tsconfig.json",
            "./data/tsconfig.json",
            "./report/tsconfig.json",
            "./frontend/tsconfig.json",
            "./desktop/tsconfig.json",
          ],
        },
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx"],
        },
      },
    },
    rules: {
      // Prevent relative imports between packages in monorepo
      "import/no-relative-packages": "error",
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

      // "no-warning-comments": [
      //   "warn",
      //   {
      //     terms: ["todo", "fixme", "hack", "xxx", "to do"],
      //     location: "anywhere",
      //   },
      // ],

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
            {
              name: "path",
              message:
                "Use Bun's built-in path utilities or import.meta.dirname instead of path. See https://bun.sh/docs/api/file-io",
            },
            {
              name: "node:path",
              message:
                "Use Bun's built-in path utilities or import.meta.dirname instead of node:path. See https://bun.sh/docs/api/file-io",
            },
          ],
          patterns: [
            {
              group: ["node:*"],
              message: "Avoid node: imports. Bun provides faster, more modern alternatives. See https://bun.sh/docs",
            },
            {
              group: ["twisted/dist/models-dto*"],
              message:
                "Do not import DTO types from twisted. Use Raw* Zod schemas from @shepherdjerred/scout-data instead (e.g., RawMatch, RawSummonerLeague).",
            },
          ],
        },
      ],
    },
  },
  // Custom rules for type safety and best practices
  {
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "custom-rules/no-type-assertions": "error",
      "custom-rules/prefer-zod-validation": "error",
      "custom-rules/prefer-bun-apis": "error",
      "custom-rules/no-re-exports": "error",
      // enable this one day
      "custom-rules/prefer-date-fns": "off",
      "custom-rules/no-function-overloads": "error",
      "custom-rules/no-parent-imports": "error",
      "custom-rules/no-type-guards": "error",
      "custom-rules/prefer-async-await": "error",
      "custom-rules/no-dto-naming": "error",
      "custom-rules/require-ts-extensions": "error",
      // Project-wide analysis tools (disabled by default - enable manually for analysis)
      // These run external tools (knip, jscpd) and cache results per lint session
      "custom-rules/knip-unused": "off",
      // jscpd-based duplication is useful for IDE visibility, but too noisy to block commits.
      // We keep it as a warning; the strict duplication gate remains `mise check`'s `duplication-check`.
      "custom-rules/no-code-duplication": "warn",
    },
  },
  // Dagger index.ts - Dagger module API can have many parameters for external interface
  {
    files: [".dagger/src/index.ts"],
    rules: {
      "max-params": "off", // this is for the external interface of the Dagger module
    },
  },
  // Test files can be longer and use test-specific patterns
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.integration.test.ts"],
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "max-lines": ["error", { max: 1500, skipBlankLines: false, skipComments: false }],
      "max-lines-per-function": ["error", { max: 200, skipBlankLines: true, skipComments: true }],
      // Allow test mocks and doubles to use any and type assertions
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "custom-rules/no-type-assertions": "error", // Still catch chained assertions in tests (e.g. 'as unknown as Type')
      "custom-rules/prefer-zod-validation": "off", // Too many false positives in tests
    },
  },
  // Integration test specific rules - ensure Prisma clients are disconnected
  {
    files: ["**/*.integration.test.ts"],
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "custom-rules/prisma-client-disconnect": "error",
    },
  },
  // Allow instanceof for Discord.js error handling and channel type checking
  {
    files: ["**/discord/**/*.ts", "**/league/discord/**/*.ts", "**/league/tasks/competition/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.test.tsx", "**/*.integration.test.ts"],
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "custom-rules/no-type-assertions": "error",
      "custom-rules/prefer-zod-validation": "error",
      "custom-rules/prefer-bun-apis": "error",
      "custom-rules/no-re-exports": "error",
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
  // Custom rules for Zod schema naming and validation
  {
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "custom-rules/zod-schema-naming": "error",
      "custom-rules/no-redundant-zod-parse": "error",
    },
  },
  // Satori-specific best practices for all report components
  {
    files: ["report/**/*.tsx", "report/**/*.ts"],
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "custom-rules/satori-best-practices": "error",
    },
  },
  // React and React Hooks rules for TSX files
  {
    files: ["**/*.tsx", "**/*.jsx"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      "custom-rules": customRulesPlugin,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // React best practices
      "react/jsx-key": "error",
      "react/jsx-no-target-blank": "error",
      "react/jsx-pascal-case": "error",
      "react/no-children-prop": "error",
      "react/no-danger": "warn",
      "react/no-danger-with-children": "error",
      "react/no-deprecated": "error",
      "react/no-direct-mutation-state": "error",
      "react/no-find-dom-node": "error",
      "react/no-is-mounted": "error",
      "react/no-render-return-value": "error",
      "react/no-string-refs": "error",
      "react/no-unescaped-entities": "error",
      "react/no-unknown-property": "error",
      "react/no-unsafe": "error",
      "react/require-render-return": "error",
      "react/void-dom-elements-no-children": "error",

      // Disable prop-types (using TypeScript instead)
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off", // Not needed in React 17+

      // React Hooks rules - critical for correctness
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // Avoid useEffect - use better patterns
      "custom-rules/no-use-effect": "warn",
    },
  },
  // JSX Accessibility rules
  {
    files: ["**/*.tsx", "**/*.jsx", "**/*.astro"],
    plugins: {
      "jsx-a11y": jsxA11y,
    },
    rules: {
      // Images must have alt text
      "jsx-a11y/alt-text": "error",
      // Enforce valid ARIA roles
      "jsx-a11y/aria-role": "error",
      // Enforce ARIA props are valid
      "jsx-a11y/aria-props": "error",
      // Enforce ARIA state and property values are valid
      "jsx-a11y/aria-proptypes": "error",
      // Enforce ARIA attributes are used correctly
      "jsx-a11y/aria-unsupported-elements": "error",
      // Enforce anchor elements are valid
      "jsx-a11y/anchor-is-valid": "error",
      // Enforce heading elements have content
      "jsx-a11y/heading-has-content": "error",
      // Enforce HTML elements have valid lang attribute
      "jsx-a11y/html-has-lang": "error",
      // Enforce iframe elements have title
      "jsx-a11y/iframe-has-title": "error",
      // Enforce img elements have alt attribute
      "jsx-a11y/img-redundant-alt": "error",
      // Enforce interactive elements are keyboard accessible
      "jsx-a11y/interactive-supports-focus": "error",
      // Enforce label elements have associated control
      "jsx-a11y/label-has-associated-control": "error",
      // Enforce media elements have captions
      "jsx-a11y/media-has-caption": "warn",
      // Enforce mouse events have keyboard equivalents
      "jsx-a11y/mouse-events-have-key-events": "error",
      // Enforce no access key attribute
      "jsx-a11y/no-access-key": "error",
      // Enforce no autofocus attribute
      "jsx-a11y/no-autofocus": "warn",
      // Enforce no distracting elements
      "jsx-a11y/no-distracting-elements": "error",
      // Enforce no interactive element to noninteractive role
      "jsx-a11y/no-interactive-element-to-noninteractive-role": "error",
      // Enforce no noninteractive element interactions
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      // Enforce no noninteractive tabindex
      "jsx-a11y/no-noninteractive-tabindex": "error",
      // Enforce no redundant roles
      "jsx-a11y/no-redundant-roles": "error",
      // Enforce no static element interactions
      "jsx-a11y/no-static-element-interactions": "error",
      // Enforce tabindex value is not greater than zero
      "jsx-a11y/tabindex-no-positive": "error",
    },
  },
  // Astro-specific rules with type-aware linting enabled
  {
    files: ["**/*.astro"],
    plugins: {
      astro: astroPlugin,
    },
    // Extend astro's recommended flat config which includes the parser
    extends: (astroPlugin.configs ?? {})["flat/base"],
    languageOptions: {
      parserOptions: {
        parser: "@typescript-eslint/parser",
        extraFileExtensions: [".astro"],
        // projectService is already enabled globally, so we don't need to set project here
      },
    },
    rules: {
      // Astro best practices rules
      "astro/no-conflict-set-directives": "error",
      "astro/no-deprecated-astro-canonicalurl": "error",
      "astro/no-deprecated-astro-fetchcontent": "error",
      "astro/no-deprecated-astro-resolve": "error",
      "astro/no-deprecated-getentrybyslug": "error",
      "astro/no-unused-define-vars-in-style": "error",
      "astro/valid-compile": "error",
    },
  },
  // MDX linting disabled - parser doesn't support type-aware rules forwarding
  // Tailwind linting disabled - plugin incompatible with Tailwind v4 (hardcoded resolveConfig import)
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
        // Also allow PascalCase for React components created with forwardRef
        {
          selector: "variable",
          modifiers: ["const", "exported"],
          filter: {
            regex: "Schema$",
            match: false,
          },
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "allow",
        },
        // Non-exported const: camelCase, UPPER_CASE, or PascalCase (for JSX component variables)
        {
          selector: "variable",
          modifiers: ["const"],
          filter: {
            regex: "Schema$",
            match: false,
          },
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
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
  // Config file itself can use relative imports for local eslint rules
  {
    files: ["eslint.config.ts", "eslint-rules/**/*.ts"],
    rules: {
      "no-relative-import-paths/no-relative-import-paths": "off",
      "custom-rules/require-ts-extensions": "off",
      // Allow Node.js APIs in eslint-rules (these run in Node.js, not Bun)
      "no-restricted-imports": "off",
      "custom-rules/prefer-bun-apis": "off",
    },
  },
  // Prefer structured logging over console in backend
  {
    files: ["backend/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.integration.test.ts"],
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "custom-rules/prefer-structured-logging": "error",
    },
  },
  // Prevent shadcn theme tokens in frontend marketing components
  // Marketing components should use explicit Tailwind colors for predictable dark mode behavior
  {
    files: ["frontend/src/**/*.tsx", "frontend/src/**/*.ts"],
    ignores: [
      "frontend/src/components/ui/**", // shadcn UI components can use theme tokens
      "frontend/src/components/review-tool/ui/**", // review tool UI components
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "custom-rules/no-shadcn-theme-tokens": "error",
    },
  },
);
