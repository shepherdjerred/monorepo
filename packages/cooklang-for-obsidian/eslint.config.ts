import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: ["eslint.config.ts"],
    },
  }),
  {
    files: ["src/cook-parser.ts"],
    rules: {
      // Chevrotain lexer patterns use explicit Unicode character class ranges
      // (Latin Extended, Cyrillic, Greek, Arabic, CJK, Korean) because
      // Chevrotain doesn't support the `u` flag with \p{L}.
      "regexp/no-obscure-range": "off",
      "regexp/no-misleading-unicode-character": "off",
      "regexp/no-misleading-capturing-group": "off",
      // Parser file has many token/rule definitions; hard to split further.
      "max-lines": ["error", { max: 600 }],
    },
  },
  {
    files: ["src/syntax/**/*.ts"],
    rules: {
      // CodeMirror's StreamParser uses stream.match() to test AND consume tokens.
      // This is not String#match — disabling the rule avoids false positives.
      "unicorn/prefer-regexp-test": "off",
    },
  },
];
export default config;
