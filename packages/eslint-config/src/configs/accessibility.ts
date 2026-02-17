/// <reference path="../types.d.ts" />
/**
 * JSX Accessibility (a11y) linting configuration
 */
import jsxA11y from "eslint-plugin-jsx-a11y";
import type { TSESLint } from "@typescript-eslint/utils";

/**
 * Configuration for JSX accessibility linting (WCAG compliance)
 */
export function accessibilityConfig(): TSESLint.FlatConfig.ConfigArray {
  return [
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
  ] as TSESLint.FlatConfig.ConfigArray;
}
