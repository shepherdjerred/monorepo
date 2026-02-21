/**
 * packages/eslint-config
 *
 * A comprehensive ESLint configuration with custom rules for TypeScript projects.
 * Includes support for React, Astro, accessibility, and Bun-specific patterns.
 */

import type { TSESLint } from "@typescript-eslint/utils";

// Export composable configs
export { baseConfig, type BaseConfigOptions } from "./configs/base.js";
export { importsConfig, type ImportsConfigOptions } from "./configs/imports.js";
export { reactConfig } from "./configs/react.js";
export { accessibilityConfig } from "./configs/accessibility.js";
export { astroConfig } from "./configs/astro.js";
export { namingConfig } from "./configs/naming.js";

// Export custom rules plugin
export { customRulesPlugin } from "./rules/index.js";

// Export individual rules for advanced use cases
export {
  zodSchemaNaming,
  noRedundantZodParse,
  satoriBestPractices,
  prismaClientDisconnect,
  noTypeAssertions,
  preferZodValidation,
  preferBunApis,
  noReExports,
  noUseEffect,
  preferDateFns,
  noFunctionOverloads,
  noParentImports,
  noTypeGuards,
  requireTsExtensions,
  preferAsyncAwait,
  noDtoNaming,
  preferStructuredLogging,
  noShadcnThemeTokens,
  knipUnused,
  noCodeDuplication,
} from "./rules/index.js";

// Import configs for the recommended preset
import { baseConfig, type BaseConfigOptions } from "./configs/base.js";
import { importsConfig, type ImportsConfigOptions } from "./configs/imports.js";
import { reactConfig } from "./configs/react.js";
import { accessibilityConfig } from "./configs/accessibility.js";
import { namingConfig } from "./configs/naming.js";
import { customRulesPlugin } from "./rules/index.js";
import prettierConfig from "eslint-config-prettier";

export type RecommendedOptions = BaseConfigOptions &
  ImportsConfigOptions & {
    /** Include React and React Hooks rules */
    react?: boolean;
    /** Include accessibility (jsx-a11y) rules */
    accessibility?: boolean;
    /** Custom rules configuration */
    customRules?: {
      /** Enable React-specific rules (no-use-effect) */
      reactRules?: boolean;
      /** Enable Raw* naming rule (no *Dto suffix) */
      noDtoNaming?: boolean;
      /** Enable structured logging rule */
      structuredLogging?: boolean;
      /** Enable shadcn token restriction rule */
      noShadcnThemeTokens?: boolean;
      /** Enable project-wide analysis rules (knip/jscpd) */
      analysisRules?: boolean;
    };
  };

/**
 * Pre-composed recommended configuration
 *
 * Combines base TypeScript, imports, and optionally React/accessibility configs
 * with sensible defaults for custom rules.
 *
 * @example
 * ```ts
 * // eslint.config.ts
 * import { recommended } from "../eslint-config/local.ts";
 *
 * export default recommended({
 *   tsconfigRootDir: import.meta.dirname,
 *   react: true,
 *   accessibility: true,
 * });
 * ```
 */
export function recommended(
  options: RecommendedOptions = {},
): TSESLint.FlatConfig.ConfigArray {
  const {
    react = false,
    accessibility = false,
    customRules = {
      reactRules: true,
      noDtoNaming: false,
      structuredLogging: false,
      noShadcnThemeTokens: false,
      analysisRules: false,
    },
    ...baseOptions
  } = options;

  const configs: TSESLint.FlatConfig.ConfigArray = [
    ...baseConfig(baseOptions),
    ...importsConfig(baseOptions),
  ];

  if (react) {
    configs.push(...reactConfig());
  }

  if (accessibility) {
    configs.push(...accessibilityConfig());
  }

  // Always include naming conventions
  configs.push(...namingConfig());

  // Custom rules — always-on core rules + opt-in specialized rules
  const customRulesConfig: TSESLint.FlatConfig.Config = {
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      // Always on — type safety
      "custom-rules/no-type-assertions": "error",
      "custom-rules/no-type-guards": "error",
      "custom-rules/no-function-overloads": "error",
      // Always on — code organization
      "custom-rules/no-re-exports": "error",
      "custom-rules/no-parent-imports": "error",
      // Always on — async style
      "custom-rules/prefer-async-await": "error",
      // Always on — Bun
      "custom-rules/prefer-bun-apis": "error",
      "custom-rules/require-ts-extensions": "error",
      // Always on — Zod
      "custom-rules/zod-schema-naming": "error",
      "custom-rules/no-redundant-zod-parse": "error",
      "custom-rules/prefer-zod-validation": "error",
    },
  };

  if (customRules.reactRules === true && react) {
    customRulesConfig.rules = {
      ...customRulesConfig.rules,
      "custom-rules/no-use-effect": "warn",
    };
  }

  if (customRules.noDtoNaming === true) {
    customRulesConfig.rules = {
      ...customRulesConfig.rules,
      "custom-rules/no-dto-naming": "error",
    };
  }

  if (customRules.structuredLogging === true) {
    customRulesConfig.rules = {
      ...customRulesConfig.rules,
      "custom-rules/prefer-structured-logging": "error",
    };
  }

  if (customRules.noShadcnThemeTokens === true) {
    customRulesConfig.rules = {
      ...customRulesConfig.rules,
      "custom-rules/no-shadcn-theme-tokens": "error",
    };
  }

  if (customRules.analysisRules === true) {
    customRulesConfig.rules = {
      ...customRulesConfig.rules,
      "custom-rules/knip-unused": "warn",
      "custom-rules/no-code-duplication": "warn",
    };
  }

  configs.push(customRulesConfig);

  // Test file overrides - relax some rules for tests
  configs.push({
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.integration.test.ts"],
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "max-lines": [
        "error",
        { max: 1500, skipBlankLines: false, skipComments: false },
      ],
      "max-lines-per-function": [
        "error",
        { max: 200, skipBlankLines: true, skipComments: true },
      ],
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
      "@typescript-eslint/strict-boolean-expressions": "off",
      // Still catch chained assertions in tests
      "custom-rules/no-type-assertions": "error",
      // Too many false positives in tests
      "custom-rules/prefer-zod-validation": "off",
    },
  });

  // Integration test specific rules
  configs.push({
    files: ["**/*.integration.test.ts"],
    plugins: {
      "custom-rules": customRulesPlugin,
    },
    rules: {
      "custom-rules/prisma-client-disconnect": "error",
    },
  });

  // Config files may import local workspace entrypoints for shared lint config.
  configs.push({
    files: [
      "eslint.config.ts",
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.cjs",
    ],
    rules: {
      "custom-rules/no-parent-imports": "off",
      "import/no-relative-packages": "off",
    },
  });

  // Must be LAST: disables ESLint rules that conflict with prettier formatting
  configs.push(prettierConfig);

  return configs;
}

// Default export for convenience
export default recommended;
