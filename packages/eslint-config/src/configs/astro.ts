/**
 * Astro-specific linting configuration
 */
import astroPlugin from "eslint-plugin-astro";
import type { TSESLint } from "@typescript-eslint/utils";

/**
 * Configuration for Astro component linting
 */
export function astroConfig(): TSESLint.FlatConfig.ConfigArray {
  return [
    {
      files: ["**/*.astro"],
      plugins: {
        astro: astroPlugin,
      },
      // Extend astro's recommended flat config which includes the parser
      ...(astroPlugin.configs?.["flat/base"] ?? {}),
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
  ] as TSESLint.FlatConfig.ConfigArray;
}
