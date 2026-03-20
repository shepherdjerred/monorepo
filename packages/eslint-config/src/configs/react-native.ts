/**
 * React Native ESLint configuration
 *
 * Adds RN-specific rules, globals, and disables DOM/Bun rules that don't apply.
 */
import reactNative from "eslint-plugin-react-native";
import type { TSESLint } from "@typescript-eslint/utils";

/**
 * Configuration for React Native projects
 *
 * Should be used after reactConfig() — it overrides DOM-specific React rules
 * and adds RN plugin rules and globals.
 */
export function reactNativeConfig(): TSESLint.FlatConfig.ConfigArray {
  return [
    // React Native plugin + rules
    {
      files: ["**/*.tsx", "**/*.ts"],
      plugins: {
        "react-native": reactNative,
      },
      rules: {
        "react-native/no-unused-styles": "warn",
        "react-native/no-inline-styles": "warn",
        "react-native/no-color-literals": "warn",
        "react-native/no-single-element-style-arrays": "error",
        "react-native/no-raw-text": "off",
      },
    },
    // RN globals (no DOM, but has fetch/timers/etc)
    {
      languageOptions: {
        globals: {
          __DEV__: "readonly",
          fetch: "readonly",
          FormData: "readonly",
          Headers: "readonly",
          Request: "readonly",
          Response: "readonly",
          AbortController: "readonly",
          Blob: "readonly",
          URL: "readonly",
          URLSearchParams: "readonly",
          console: "readonly",
          setTimeout: "readonly",
          setInterval: "readonly",
          clearTimeout: "readonly",
          clearInterval: "readonly",
          setImmediate: "readonly",
          clearImmediate: "readonly",
          requestAnimationFrame: "readonly",
          cancelAnimationFrame: "readonly",
          jest: "readonly",
          describe: "readonly",
          it: "readonly",
          expect: "readonly",
          beforeEach: "readonly",
          afterEach: "readonly",
          beforeAll: "readonly",
          afterAll: "readonly",
        },
      },
    },
    // Disable DOM-specific React rules (no DOM in RN)
    {
      files: ["**/*.tsx", "**/*.jsx"],
      rules: {
        "react/no-find-dom-node": "off",
        "react/no-unknown-property": "off",
        "react/void-dom-elements-no-children": "off",
        "react/jsx-no-target-blank": "off",
      },
    },
    // Disable Bun-specific base rules (RN uses Metro, not Bun)
    {
      rules: {
        "no-restricted-imports": "off",
      },
    },
    // RN-appropriate TypeScript rule overrides
    {
      rules: {
        // Conditional rendering idiom uses falsy checks
        "@typescript-eslint/strict-boolean-expressions": "off",
        // Numbers in template literals are common in RN
        "@typescript-eslint/restrict-template-expressions": [
          "error",
          {
            allowNumber: true,
            allowBoolean: false,
            allowAny: false,
            allowNullish: false,
          },
        ],
      },
    },
    // Filename convention: allow PascalCase for RN components alongside kebabCase
    {
      rules: {
        "unicorn/filename-case": [
          "error",
          {
            cases: {
              kebabCase: true,
              pascalCase: true,
            },
          },
        ],
      },
    },
  ] satisfies TSESLint.FlatConfig.ConfigArray;
}
