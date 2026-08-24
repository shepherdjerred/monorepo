import {
  definePlugin,
  InlineStyleAnnotation,
  isInlineStyleAnnotation,
  type ExpressiveCodePlugin,
} from "@expressive-code/core";
import { scoutThemes } from "@scout-for-lol/design-system/themes";
import {
  scoutQlTokenSpans,
  type ScoutQlTokenKind,
} from "@scout-for-lol/data/model/scoutql/semantic-tokens.ts";

// ── ScoutQL syntax highlighting for the docs ─────────────────────────────────
// Shiki has no ScoutQL grammar, and writing a TextMate one would be a fourth
// place for the keyword list to drift — which is the exact failure this
// rewrite removes. So the docs run the real tokenizer instead: at build time,
// every ```scoutql fence is handed to `scoutQlTokenSpans` from
// `@scout-for-lol/data`, the same pass that paints the Monaco editor and the
// in-app `<ScoutQlCode>`. A keyword added to the grammar is highlighted in the
// docs on the next build, with no grammar to update.
//
// The tokenizer is total (its spans tile the input byte for byte) and never
// throws, so a fence containing a deliberately broken example still renders —
// the unmatched text is simply painted as `invalid`.

export const SCOUTQL_CODE_LANGUAGE = "scoutql";

/**
 * Shiki must be told what `scoutql` is, or it logs "The language could not be
 * found" for every fence and falls back to plaintext anyway. Aliasing to `txt`
 * keeps the log clean and, more importantly, means Shiki contributes only a
 * single foreground-coloured annotation per line, which this plugin then
 * replaces wholesale.
 */
export const SCOUTQL_SHIKI_LANG_ALIAS = { [SCOUTQL_CODE_LANGUAGE]: "txt" };

type ScoutColorRole = keyof (typeof scoutThemes)["modern-light"]["colors"];

type TokenStyle = {
  role: ScoutColorRole;
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

function style(
  role: ScoutColorRole,
  emphasis?: { bold?: boolean; italic?: boolean; underline?: boolean },
): TokenStyle {
  return {
    role,
    bold: emphasis?.bold ?? false,
    italic: emphasis?.italic ?? false,
    underline: emphasis?.underline ?? false,
  };
}

/**
 * Highlight kind → design-system colour role. `Record<ScoutQlTokenKind, …>` is
 * the exhaustiveness gate: adding a kind to the union fails typecheck here
 * until the docs decide how to paint it.
 *
 * The roles match `app/src/lib/scoutql-monaco-themes.ts`, so a query looks the
 * same in the docs as it does in the editor the reader is about to paste it
 * into.
 */
const TOKEN_STYLES: Record<ScoutQlTokenKind, TokenStyle> = {
  keyword: style("primary", { bold: true }),
  aggregate: style("chart5", { bold: true }),
  function: style("chart5"),
  column: style("text"),
  alias: style("chart7"),
  source: style("focus", { bold: true }),
  number: style("chart6"),
  string: style("chart3"),
  operator: style("textMuted"),
  comment: style("textMuted", { italic: true }),
  renderKind: style("accent", { bold: true }),
  renderOption: style("accent"),
  plain: style("text"),
  invalid: style("danger", { underline: true }),
};

/** One token clipped to a single line, in that line's 0-based columns. */
export type ScoutQlDocsToken = {
  line: number;
  columnStart: number;
  columnEnd: number;
  kind: ScoutQlTokenKind;
};

/**
 * Tokenizes a code block and lays the result out per line.
 *
 * Expressive Code annotates by `(line, columnStart, columnEnd)`, while the
 * tokenizer speaks in absolute offsets over the whole block, so the newlines
 * have to be accounted for exactly — an off-by-one here shifts every colour on
 * the page. Exported so a test can check the layout without building a site.
 */
export function scoutQlDocsTokens(code: string): ScoutQlDocsToken[] {
  const tokens: ScoutQlDocsToken[] = [];
  let line = 0;
  let column = 0;
  for (const span of scoutQlTokenSpans(code)) {
    // A span may contain newlines (whitespace between clauses, or a string
    // literal broken across lines); each piece becomes its own token.
    const pieces = span.text.split("\n");
    for (const [index, piece] of pieces.entries()) {
      if (index > 0) {
        line += 1;
        column = 0;
      }
      if (piece.length > 0) {
        tokens.push({
          line,
          columnStart: column,
          columnEnd: column + piece.length,
          kind: span.kind,
        });
        column += piece.length;
      }
    }
  }
  return tokens;
}

/**
 * The Expressive Code plugin. It runs after Shiki (the engine prepends the
 * bundled plugins), so `postprocessAnalyzedCode` can drop Shiki's plaintext
 * styling and install ScoutQL's own — one annotation per token per theme
 * variant, since a light and a dark theme need different colours for the same
 * span.
 */
export function scoutQlExpressiveCode(): ExpressiveCodePlugin {
  return definePlugin({
    name: "ScoutQL",
    hooks: {
      postprocessAnalyzedCode: ({ codeBlock, styleVariants }) => {
        if (codeBlock.language !== SCOUTQL_CODE_LANGUAGE) {
          return;
        }
        const lines = codeBlock.getLines();
        for (const line of lines) {
          for (const annotation of line.getAnnotations()) {
            if (isInlineStyleAnnotation(annotation)) {
              line.deleteAnnotation(annotation);
            }
          }
        }
        const code = lines.map((line) => line.text).join("\n");
        for (const token of scoutQlDocsTokens(code)) {
          const line = lines[token.line];
          if (line === undefined) {
            continue;
          }
          const tokenStyle = TOKEN_STYLES[token.kind];
          for (const [
            styleVariantIndex,
            styleVariant,
          ] of styleVariants.entries()) {
            const palette =
              scoutThemes[
                styleVariant.theme.type === "dark"
                  ? "modern-dark"
                  : "modern-light"
              ].colors;
            line.addAnnotation(
              new InlineStyleAnnotation({
                styleVariantIndex,
                color: palette[tokenStyle.role],
                italic: tokenStyle.italic,
                bold: tokenStyle.bold,
                underline: tokenStyle.underline,
                inlineRange: {
                  columnStart: token.columnStart,
                  columnEnd: token.columnEnd,
                },
                renderPhase: "earliest",
              }),
            );
          }
        }
      },
    },
  });
}
