import { createToken, Lexer, type IToken, type TokenType } from "chevrotain";
import type { ReportQuerySpan } from "#src/model/report-query-spec.ts";

// ── Report query lexer (Chevrotain) ──────────────────────────────────────────
// Tokenizes the bespoke SQL-like report language with per-token source offsets.
// Keywords are case-insensitive; identifiers (sources, metrics, fields) and
// numbers/strings/operators round out the vocabulary. The hand-written parser
// in report-query-parser.ts consumes these tokens.

// Identifier must exist before the keywords so they can reference it as their
// `longer_alt` (so e.g. "format" lexes as an Identifier, not FROM + "at").
export const Identifier = createToken({
  name: "Identifier",
  pattern: /[a-z_]\w*/i,
});

function keyword(name: string, word: string): TokenType {
  return createToken({
    name,
    pattern: new RegExp(word, "iu"),
    longer_alt: Identifier,
  });
}

export const WhiteSpace = createToken({
  name: "WhiteSpace",
  pattern: /\s+/u,
  group: Lexer.SKIPPED,
});
export const Comma = createToken({ name: "Comma", pattern: /,/u });
export const LParen = createToken({ name: "LParen", pattern: /\(/u });
export const RParen = createToken({ name: "RParen", pattern: /\)/u });
export const GreaterEqual = createToken({
  name: "GreaterEqual",
  pattern: />=/u,
});
export const Equals = createToken({ name: "Equals", pattern: /=/u });
export const StringLiteral = createToken({
  name: "StringLiteral",
  pattern: /'[^']*'|"[^"]*"/u,
});
export const NumberLiteral = createToken({
  name: "NumberLiteral",
  pattern: /\d+/u,
});

export const Select = keyword("Select", "select");
export const From = keyword("From", "from");
export const Where = keyword("Where", "where");
export const Group = keyword("Group", "group");
export const Order = keyword("Order", "order");
export const By = keyword("By", "by");
export const Limit = keyword("Limit", "limit");
export const And = keyword("And", "and");
export const In = keyword("In", "in");
export const Asc = keyword("Asc", "asc");
export const Desc = keyword("Desc", "desc");

// Order matters: multi-char operators before single, keywords before Identifier.
export const reportQueryTokenTypes: TokenType[] = [
  WhiteSpace,
  Comma,
  LParen,
  RParen,
  GreaterEqual,
  Equals,
  StringLiteral,
  NumberLiteral,
  Select,
  From,
  Where,
  Group,
  Order,
  By,
  Limit,
  And,
  In,
  Asc,
  Desc,
  Identifier,
];

const reportQueryLexer = new Lexer(reportQueryTokenTypes, {
  positionTracking: "full",
});

export type ReportLexResult = {
  tokens: IToken[];
  errors: { offset: number; length: number; message: string }[];
};

export function tokenizeReportQuery(text: string): ReportLexResult {
  const result = reportQueryLexer.tokenize(text);
  return {
    tokens: result.tokens,
    errors: result.errors.map((error) => ({
      offset: error.offset,
      length: error.length,
      message: error.message,
    })),
  };
}

// Chevrotain `endOffset` is the inclusive index of the last char; convert to a
// half-open [start, end) span.
export function tokenSpan(token: IToken): ReportQuerySpan {
  const start = token.startOffset;
  const end = (token.endOffset ?? token.startOffset) + 1;
  return { start, end };
}
