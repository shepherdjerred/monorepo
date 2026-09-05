import { match } from "ts-pattern";
import type {
  ScoutQlSemanticToken,
  ScoutQlTokenKind,
} from "@scout-for-lol/data/model/scoutql/semantic-tokens.ts";

// ── Semantic token encoding ──────────────────────────────────────────────────
// Monaco wants semantic tokens as a flat `Uint32Array` of 5-tuples
//
//   [deltaLine, deltaStartChar, length, tokenTypeIndex, tokenModifierSet]
//
// where deltas are relative to the previous token (and `deltaStartChar` is
// absolute again whenever `deltaLine > 0`). The language service speaks in
// absolute character offsets over the whole document, so something has to do
// the conversion — and doing it here, in a function that imports no Monaco
// runtime code, is what makes it testable: the interesting cases (a token that
// straddles a newline, a malformed query, an empty document) need no editor.

/**
 * The legend, in index order. Monaco matches a semantic token's *type name*
 * against the theme's token rules, so these strings double as the theme rule
 * selectors in `scoutql-monaco-themes.ts`.
 */
export const SCOUTQL_SEMANTIC_TOKEN_TYPES: readonly ScoutQlTokenKind[] = [
  "keyword",
  "aggregate",
  "function",
  "column",
  "alias",
  "source",
  "number",
  "string",
  "operator",
  "comment",
  "renderKind",
  "renderOption",
  "plain",
  "invalid",
];

/** ScoutQL has no token modifiers; the legend still has to declare the axis. */
export const SCOUTQL_SEMANTIC_TOKEN_MODIFIERS: readonly string[] = [];

/**
 * A kind's position in the legend. The ts-pattern match is the exhaustiveness
 * gate: adding a member to `ScoutQlTokenKind` fails typecheck here until it is
 * given a legend index (and `scoutql-monaco-tokens.test.ts` pins the indices
 * against `SCOUTQL_SEMANTIC_TOKEN_TYPES`, so the two cannot drift).
 */
export function scoutQlTokenTypeIndex(kind: ScoutQlTokenKind): number {
  return match(kind)
    .with("keyword", () => 0)
    .with("aggregate", () => 1)
    .with("function", () => 2)
    .with("column", () => 3)
    .with("alias", () => 4)
    .with("source", () => 5)
    .with("number", () => 6)
    .with("string", () => 7)
    .with("operator", () => 8)
    .with("comment", () => 9)
    .with("renderKind", () => 10)
    .with("renderOption", () => 11)
    .with("plain", () => 12)
    .with("invalid", () => 13)
    .exhaustive();
}

/** Content range of one document line, in absolute offsets (newline excluded). */
type LineRange = { start: number; end: number };

/**
 * Line content ranges for a document. Handles both `\n` and `\r\n`, and always
 * yields at least one line so an empty document has a line 0.
 */
export function scoutQlLineRanges(text: string): LineRange[] {
  const ranges: LineRange[] = [];
  let lineStart = 0;
  let index = 0;
  while (index < text.length) {
    if (text[index] === "\n") {
      const end =
        index > lineStart && text[index - 1] === "\r" ? index - 1 : index;
      ranges.push({ start: lineStart, end });
      index += 1;
      lineStart = index;
      continue;
    }
    index += 1;
  }
  ranges.push({ start: lineStart, end: text.length });
  return ranges;
}

/** One token clipped to a single line, in that line's 0-based columns. */
export type ScoutQlLineToken = {
  line: number;
  column: number;
  length: number;
  kind: ScoutQlTokenKind;
};

/**
 * Splits absolute-offset tokens into per-line tokens.
 *
 * Two things happen here that the encoder below depends on:
 *
 *  - **Line splitting.** A Monaco semantic token may not cross a line break,
 *    but a ScoutQL token can (a string literal with an embedded newline, or a
 *    run of whitespace between clauses). Each token is therefore intersected
 *    with every line it touches.
 *  - **`plain` is dropped.** `scoutQlSemanticTokens` tiles the *whole* input,
 *    including whitespace, so that the docs highlighter can reproduce the
 *    source byte for byte. Monaco does not need that: unstyled text should
 *    simply take the editor's foreground colour, and emitting a token per
 *    whitespace run would triple the payload for no visible effect.
 */
export function scoutQlLineTokens(
  text: string,
  tokens: readonly ScoutQlSemanticToken[],
): ScoutQlLineToken[] {
  const lines = scoutQlLineRanges(text);
  const result: ScoutQlLineToken[] = [];
  for (const token of tokens) {
    if (token.kind === "plain") {
      continue;
    }
    const tokenEnd = token.start + token.length;
    for (const [line, range] of lines.entries()) {
      if (range.start > tokenEnd) {
        break;
      }
      const start = Math.max(token.start, range.start);
      const end = Math.min(tokenEnd, range.end);
      if (end <= start) {
        continue;
      }
      result.push({
        line,
        column: start - range.start,
        length: end - start,
        kind: token.kind,
      });
    }
  }
  return result;
}

/**
 * Delta-encodes tokens into Monaco's flat uint32 stream.
 *
 * Pure and Monaco-free on purpose: this is the one place where an off-by-one
 * silently mis-colours the whole document, so it is unit-tested directly
 * rather than through an editor instance.
 */
export function encodeScoutQlSemanticTokens(
  text: string,
  tokens: readonly ScoutQlSemanticToken[],
): number[] {
  const data: number[] = [];
  let previousLine = 0;
  let previousColumn = 0;
  for (const token of scoutQlLineTokens(text, tokens)) {
    const deltaLine = token.line - previousLine;
    const deltaColumn =
      deltaLine === 0 ? token.column - previousColumn : token.column;
    data.push(
      deltaLine,
      deltaColumn,
      token.length,
      scoutQlTokenTypeIndex(token.kind),
      0,
    );
    previousLine = token.line;
    previousColumn = token.column;
  }
  return data;
}
