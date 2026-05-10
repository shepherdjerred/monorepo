/**
 * Astro-specific linting configuration
 */
import astroPlugin from "eslint-plugin-astro";
import type { TSESLint } from "@typescript-eslint/utils";

/**
 * Configuration for Astro component linting
 */
export function astroConfig(): TSESLint.FlatConfig.ConfigArray {
  const flatBase = (astroPlugin.configs?.["flat/base"] ??
    []) as TSESLint.FlatConfig.ConfigArray;
  return [
    // eslint-plugin-astro's flat/base is an array of configs (parser + plugin
    // wiring). Spread them directly into the outer array — spreading the array
    // into a single object produces numeric keys ("0", "1", ...) and crashes
    // ESLint with `Unexpected key "0" found`.
    ...flatBase,
    {
      files: ["**/*.astro"],
      plugins: {
        astro: astroPlugin,
      },
      languageOptions: {
        parserOptions: {
          parser: "@typescript-eslint/parser",
          extraFileExtensions: [".astro"],
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
  ];
}
