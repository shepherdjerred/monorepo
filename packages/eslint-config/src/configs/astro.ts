/**
 * Astro-specific linting configuration
 */
import astroPlugin from "eslint-plugin-astro";
import tseslint from "typescript-eslint";
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
    // Typed linting is not supported on .astro files: astro-eslint-parser has
    // no projectService support (falls back to `project: true`) and its
    // virtual TSX nodes are missing from the esTreeNodeToTSNodeMap, so any
    // type-aware rule can dereference an undefined type and crash ESLint
    // (observed with unbound-method and no-misused-promises). Under bun's
    // isolated linker the program never attached and typed rules silently
    // no-oped — this makes that long-standing effective behavior explicit.
    {
      files: ["**/*.astro"],
      ...tseslint.configs.disableTypeChecked,
    },
    {
      files: ["**/*.astro"],
      rules: {
        // Our own type-aware custom rules fail at load time once
        // disableTypeChecked removes the program for .astro files.
        "custom-rules/zod-schema-naming": "off",
        "custom-rules/no-redundant-zod-parse": "off",
      },
    },
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
