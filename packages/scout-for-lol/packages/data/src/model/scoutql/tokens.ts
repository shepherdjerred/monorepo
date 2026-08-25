import { createToken, Lexer, type IToken, type TokenType } from "chevrotain";
import type { ScoutQlSpan } from "#src/model/scoutql/diagnostics.ts";

// ── ScoutQL v2 tokens ────────────────────────────────────────────────────────
// The single token vocabulary for ScoutQL — a bounded subset of DuckDB SQL plus
// RENDER/player()/champion()/kda()/per_minute(). Everything keyword-shaped that
// is NOT listed here (interval units, DATE_TRUNC parts, previous_period,
// function names) deliberately stays an Identifier and is resolved
// semantically. `SCOUTQL_KEYWORDS` is derived from these definitions and is the
// only keyword list in the repo: highlighting, docs, and the AI reference all
// read it from here.

// Identifier must exist before the keywords so they can reference it as their
// `longer_alt` (so e.g. "formatted" lexes as an Identifier, not FROM + …).
export const Identifier = createToken({
  name: "Identifier",
  pattern: /[a-z_]\w*/i,
});

const keywordTokens: TokenType[] = [];
const keywordWords = new Map<TokenType, string>();

/**
 * Category every keyword belongs to. Inside `RENDER … WITH (…)` no keyword is
 * structurally meaningful, so an option value that happens to spell one —
 * `sort = desc`, `mentions = all` — is just a value. Consuming the category
 * there accepts all of them at once, instead of bolting on one alternative per
 * collision as the vocabulary grows.
 */
export const KeywordLike = createToken({
  name: "KeywordLike",
  pattern: Lexer.NA,
});

function keyword(name: string, word: string): TokenType {
  const token = createToken({
    name,
    pattern: new RegExp(word, "iu"),
    longer_alt: Identifier,
    categories: [KeywordLike],
  });
  keywordTokens.push(token);
  keywordWords.set(token, word.toUpperCase());
  return token;
}

export const Select = keyword("Select", "select");
export const From = keyword("From", "from");
export const Where = keyword("Where", "where");
export const Group = keyword("Group", "group");
export const By = keyword("By", "by");
export const Having = keyword("Having", "having");
export const Order = keyword("Order", "order");
export const Limit = keyword("Limit", "limit");
export const Render = keyword("Render", "render");
export const With = keyword("With", "with");
export const As = keyword("As", "as");
export const And = keyword("And", "and");
export const Or = keyword("Or", "or");
export const Not = keyword("Not", "not");
export const In = keyword("In", "in");
export const Is = keyword("Is", "is");
export const Null = keyword("Null", "null");
export const Between = keyword("Between", "between");
export const Like = keyword("Like", "like");
export const Ilike = keyword("Ilike", "ilike");
export const Asc = keyword("Asc", "asc");
export const Desc = keyword("Desc", "desc");
export const Distinct = keyword("Distinct", "distinct");
export const Filter = keyword("Filter", "filter");
export const Interval = keyword("Interval", "interval");
export const Cast = keyword("Cast", "cast");
export const At = keyword("At", "at");
export const Time = keyword("Time", "time");
export const Zone = keyword("Zone", "zone");
export const All = keyword("All", "all");
export const True = keyword("True", "true");
export const False = keyword("False", "false");
export const CurrentTimestamp = keyword(
  "CurrentTimestamp",
  "current_timestamp",
);
export const CurrentDate = keyword("CurrentDate", "current_date");
// CASE lexes so the parser layer can reject it with a targeted
// "case-unsupported" diagnostic pointing at FILTER / arithmetic bucketing.
export const Case = keyword("Case", "case");

/**
 * Every ScoutQL keyword, uppercase, derived from the token definitions above.
 * This is the ONLY keyword list in the repo — highlighters and docs must
 * consume it rather than re-listing keywords.
 */
export const SCOUTQL_KEYWORDS: readonly string[] = keywordTokens.map(
  (token) => {
    const word = keywordWords.get(token);
    if (word === undefined) {
      throw new Error(`ScoutQL keyword token ${token.name} has no word.`);
    }
    return word;
  },
);

export const WhiteSpace = createToken({
  name: "WhiteSpace",
  pattern: /\s+/u,
  group: Lexer.SKIPPED,
});

/** `--` line comments; retained in their own group so a formatter can keep them. */
export const LineComment = createToken({
  name: "LineComment",
  pattern: /--[^\r\n]*/u,
  group: "comments",
});

export const Comma = createToken({ name: "Comma", pattern: /,/u });
export const LParen = createToken({ name: "LParen", pattern: /\(/u });
export const RParen = createToken({ name: "RParen", pattern: /\)/u });
export const DoubleColon = createToken({ name: "DoubleColon", pattern: /::/u });
export const NotEquals = createToken({ name: "NotEquals", pattern: /!=/u });
/** `<>` — normalized to `!=` in the AST. */
export const LtGt = createToken({ name: "LtGt", pattern: /<>/u });
export const LessEqual = createToken({ name: "LessEqual", pattern: /<=/u });
export const GreaterEqual = createToken({
  name: "GreaterEqual",
  pattern: />=/u,
});
export const Less = createToken({ name: "Less", pattern: /</u });
export const Greater = createToken({ name: "Greater", pattern: />/u });
export const Equals = createToken({ name: "Equals", pattern: /=/u });
export const Plus = createToken({ name: "Plus", pattern: /\+/u });
export const Minus = createToken({ name: "Minus", pattern: /-/u });
export const Star = createToken({ name: "Star", pattern: /\*/u });
export const Slash = createToken({ name: "Slash", pattern: /\//u });
export const Percent = createToken({ name: "Percent", pattern: /%/u });
export const Dot = createToken({ name: "Dot", pattern: /\./u });

/** DuckDB-style single-quoted string with `''` doubling. */
export const StringLiteral = createToken({
  name: "StringLiteral",
  pattern: /'(?:[^']|'')*'/u,
});
/**
 * A single-quoted string that never closes. Categorized as StringLiteral so
 * the parser still accepts it (with a "lex-error" diagnostic) instead of
 * cascading unknown-character errors.
 */
export const UnterminatedStringLiteral = createToken({
  name: "UnterminatedStringLiteral",
  pattern: /'(?:[^']|'')*/u,
  categories: [StringLiteral],
});
/**
 * Double-quoted text is an identifier in SQL, never a string. It lexes (and is
 * accepted wherever an identifier is) but always yields the
 * "string-double-quoted" diagnostic.
 */
export const QuotedIdentifier = createToken({
  name: "QuotedIdentifier",
  pattern: /"(?:[^"]|"")*"/u,
  categories: [Identifier],
});
export const UnterminatedQuotedIdentifier = createToken({
  name: "UnterminatedQuotedIdentifier",
  pattern: /"(?:[^"]|"")*/u,
  categories: [Identifier],
});
/** `#rrggbb` — survives for render options (colors lists). */
export const HexColor = createToken({
  name: "HexColor",
  pattern: /#[0-9a-f]{6}/iu,
});
export const NumberLiteral = createToken({
  name: "NumberLiteral",
  pattern: /\d+(?:\.\d+)?(?:e[+-]?\d+)?/iu,
});

// Longer keywords first so a keyword that prefixes another (IN/INTERVAL,
// OR/ORDER, AS/ASC) cannot shadow it through `longer_alt` resolution.
const keywordsByLength = [...keywordTokens].sort((a, b) => {
  const aWord = keywordWords.get(a) ?? "";
  const bWord = keywordWords.get(b) ?? "";
  return bWord.length - aWord.length;
});

// Order matters: comments before Minus, multi-char operators before their
// single-char prefixes, terminated literals before unterminated fallbacks,
// keywords before Identifier.
export const scoutQlTokenTypes: TokenType[] = [
  WhiteSpace,
  LineComment,
  Comma,
  LParen,
  RParen,
  DoubleColon,
  NotEquals,
  LtGt,
  LessEqual,
  GreaterEqual,
  Less,
  Greater,
  Equals,
  Plus,
  Minus,
  Star,
  Slash,
  Percent,
  StringLiteral,
  UnterminatedStringLiteral,
  QuotedIdentifier,
  UnterminatedQuotedIdentifier,
  HexColor,
  NumberLiteral,
  ...keywordsByLength,
  Identifier,
  Dot,
];

const scoutQlLexer = new Lexer(scoutQlTokenTypes, {
  positionTracking: "full",
});

export type ScoutQlLexError = {
  offset: number;
  length: number;
  message: string;
};

export type ScoutQlLexResult = {
  tokens: IToken[];
  comments: IToken[];
  errors: ScoutQlLexError[];
};

export function tokenizeScoutQl(text: string): ScoutQlLexResult {
  const result = scoutQlLexer.tokenize(text);
  return {
    tokens: result.tokens,
    comments: result.groups["comments"] ?? [],
    errors: result.errors.map((error) => ({
      offset: error.offset,
      length: error.length,
      message: error.message,
    })),
  };
}

/**
 * Half-open [start, end) span of a token, or null for synthetic tokens
 * (EOF, tokens inserted during error recovery) which carry no real location.
 */
export function tokenSpan(token: IToken): ScoutQlSpan | null {
  const { startOffset, endOffset } = token;
  if (
    endOffset === undefined ||
    startOffset < 0 ||
    endOffset < startOffset ||
    !Number.isFinite(startOffset) ||
    !Number.isFinite(endOffset)
  ) {
    return null;
  }
  return { start: startOffset, end: endOffset + 1 };
}

/**
 * Decode a single-quoted string lexeme: strip quotes, fold `''` to `'`.
 * Tolerates a missing closing quote (unterminated literals).
 */
export function decodeScoutQlString(image: string): string {
  let out = "";
  let index = image.startsWith("'") ? 1 : 0;
  while (index < image.length) {
    const char = image[index];
    if (char === undefined) {
      break;
    }
    if (char === "'") {
      if (image[index + 1] === "'") {
        out += "'";
        index += 2;
        continue;
      }
      break;
    }
    out += char;
    index += 1;
  }
  return out;
}

/**
 * Decode an identifier lexeme to its lowercase AST form. Handles plain
 * identifiers and double-quoted identifiers (with `""` doubling, possibly
 * unterminated).
 */
export function decodeScoutQlIdentifier(image: string): string {
  if (!image.startsWith('"')) {
    return image.toLowerCase();
  }
  let out = "";
  let index = 1;
  while (index < image.length) {
    const char = image[index];
    if (char === undefined) {
      break;
    }
    if (char === '"') {
      if (image[index + 1] === '"') {
        out += '"';
        index += 2;
        continue;
      }
      break;
    }
    out += char;
    index += 1;
  }
  return out.toLowerCase();
}
