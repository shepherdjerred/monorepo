import { recommended } from "@shepherdjerred/eslint-config";

export default [
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
