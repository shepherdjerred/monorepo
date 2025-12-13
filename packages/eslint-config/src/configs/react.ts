/**
 * React and React Hooks linting configuration
 */
import * as react from "eslint-plugin-react";
import * as reactHooks from "eslint-plugin-react-hooks";
import type { TSESLint } from "@typescript-eslint/utils";

/**
 * Configuration for React and React Hooks linting
 */
export function reactConfig(): TSESLint.FlatConfig.ConfigArray {
  return [
    {
      files: ["**/*.tsx", "**/*.jsx"],
      plugins: {
        react,
        "react-hooks": reactHooks,
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
      },
    },
  ] as TSESLint.FlatConfig.ConfigArray;
}
