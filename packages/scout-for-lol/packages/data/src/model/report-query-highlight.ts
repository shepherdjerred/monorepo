import type { IToken } from "chevrotain";
import { tokenizeReportQuery } from "#src/model/report-query-lexer.ts";

const KEYWORD_TOKEN_NAMES = new Set([
  "Analyze",
  "And",
  "Asc",
  "By",
  "CurrentTimestamp",
  "Desc",
  "From",
  "Group",
  "Having",
  "In",
  "Interval",
  "Limit",
  "Order",
  "Render",
  "Select",
  "Where",
  "With",
]);

export type ReportQueryHighlightKind =
  "plain" | "keyword" | "identifier" | "number" | "string" | "operator";

export type ReportQueryHighlightToken = {
  text: string;
  kind: ReportQueryHighlightKind;
};

/**
 * Tokenize ScoutQL for lightweight, read-only display.
 *
 * Chevrotain skips whitespace and reports invalid fragments separately, so
 * this rebuilds the gaps from the original string. Joining every returned
 * token therefore always produces the exact source text, including malformed
 * input that an inspector still needs to show faithfully.
 */
export function highlightReportQuery(
  queryText: string,
): ReportQueryHighlightToken[] {
  const highlighted: ReportQueryHighlightToken[] = [];
  let cursor = 0;
  for (const token of tokenizeReportQuery(queryText).tokens) {
    if (token.startOffset > cursor) {
      highlighted.push({
        text: queryText.slice(cursor, token.startOffset),
        kind: "plain",
      });
    }
    const end = (token.endOffset ?? token.startOffset) + 1;
    highlighted.push({
      text: queryText.slice(token.startOffset, end),
      kind: highlightKind(token),
    });
    cursor = end;
  }
  if (cursor < queryText.length) {
    highlighted.push({ text: queryText.slice(cursor), kind: "plain" });
  }
  return highlighted;
}

function highlightKind(token: IToken): ReportQueryHighlightKind {
  const name = token.tokenType.name;
  if (KEYWORD_TOKEN_NAMES.has(name)) {
    return "keyword";
  }
  if (name === "Identifier") {
    return "identifier";
  }
  if (name === "NumberLiteral") {
    return "number";
  }
  if (name === "StringLiteral" || name === "HexColor") {
    return "string";
  }
  return "operator";
}
