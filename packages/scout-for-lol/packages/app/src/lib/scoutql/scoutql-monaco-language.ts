import type * as Monaco from "monaco-editor";
import { SCOUTQL_KEYWORDS } from "@scout-for-lol/data/model/scoutql/tokens.ts";

// ── ScoutQL language registration ────────────────────────────────────────────
// Registration is deliberately split from the providers (semantic tokens,
// completion, hover, …) and the themes: this module owns only the things
// Monaco needs before a single provider has answered — the language ID, the
// editing behaviours (comment toggling, bracket/quote pairing), and a minimal
// Monarch grammar for the very first paint.

export const SCOUTQL_LANGUAGE_ID = "scoutql";

const registeredWith = new WeakSet<object>();

/**
 * Registers the ScoutQL language with a Monaco instance. Idempotent per
 * instance — Monaco has no "is this language registered" query, and calling
 * `register` twice installs a second tokenizer.
 */
export function registerScoutQlLanguage(monaco: typeof Monaco): void {
  if (registeredWith.has(monaco)) {
    return;
  }
  registeredWith.add(monaco);
  monaco.languages.register({ id: SCOUTQL_LANGUAGE_ID });
  monaco.languages.setLanguageConfiguration(
    SCOUTQL_LANGUAGE_ID,
    scoutQlLanguageConfiguration(),
  );
  monaco.languages.setMonarchTokensProvider(
    SCOUTQL_LANGUAGE_ID,
    scoutQlMonarchLanguage(),
  );
}

/**
 * Editing behaviour. `comments.lineComment` is what makes Cmd+/ (the
 * `editor.action.commentLine` action) emit `--` rather than nothing at all,
 * and the pairs make typing `(` or `'` behave the way every other editor in
 * the app does.
 *
 * ScoutQL has no block comments and no double-quoted strings on purpose:
 * `"…"` is a DuckDB *identifier* and the analyzer rejects it with a
 * `string-double-quoted` diagnostic, so auto-closing one would be a trap.
 */
export function scoutQlLanguageConfiguration(): Monaco.languages.LanguageConfiguration {
  return {
    comments: { lineComment: "--" },
    brackets: [["(", ")"]],
    autoClosingPairs: [
      { open: "(", close: ")" },
      { open: "'", close: "'", notIn: ["string", "comment"] },
    ],
    surroundingPairs: [
      { open: "(", close: ")" },
      { open: "'", close: "'" },
    ],
    wordPattern: /[A-Za-z_]\w*/u,
  };
}

/**
 * The first-paint layer, and nothing more.
 *
 * Monaco paints Monarch tokens synchronously and only then asks the semantic
 * token provider, so without this a query flashes uncoloured on mount and
 * after every theme switch. It therefore colours ONLY what a regex can decide
 * without any analysis — keywords, strings, numbers, comments — and leaves
 * everything else to `scoutQlSemanticTokens`, which knows the difference
 * between a column, an alias, a source and a function.
 *
 * The keyword list is generated from `SCOUTQL_KEYWORDS` (derived from the
 * Chevrotain token definitions) rather than typed out. The hand-maintained
 * copy this replaces had already drifted from the grammar.
 */
export function scoutQlMonarchLanguage(): Monaco.languages.IMonarchLanguage {
  return {
    ignoreCase: true,
    defaultToken: "",
    keywords: [...SCOUTQL_KEYWORDS],
    tokenizer: {
      root: [
        [/--[^\n\r]*/u, "comment"],
        // Single-quoted, with `''` as the escape — DuckDB's only string form.
        [/'(?:[^']|'')*'/u, "string"],
        [/'.*$/u, "string.invalid"],
        [/\d+(?:\.\d+)?/u, "number"],
        [
          /[A-Za-z_]\w*/u,
          { cases: { "@keywords": "keyword", "@default": "" } },
        ],
      ],
    },
  };
}
