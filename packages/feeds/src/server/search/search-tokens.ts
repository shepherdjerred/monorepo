/**
 * Full-text search for entry titles and authors.
 *
 * Feeds started on SQLite FTS5 with the `unicode61` tokenizer. PostgreSQL's
 * text parser splits and folds words differently, so the service tokenizes
 * here, exactly as unicode61 does, and hands PostgreSQL finished tsvector and
 * tsquery literals; casting a literal bypasses PostgreSQL's parser. A search
 * therefore returns the entries it returned on SQLite.
 *
 * The per-code-point behaviour comes from `unicode61-table.json`, which
 * `search-tokens.test.ts` checks against SQLite for every code point.
 */
import table from "./unicode61-table.json" with { type: "json" };

/** PostgreSQL rejects tsvector and tsquery lexemes longer than this. */
const MAX_LEXEME_BYTES = 2047;
/** PostgreSQL's largest tsvector position. */
const MAX_POSITION = 16_383;
/** PostgreSQL keeps at most this many positions per lexeme. */
const MAX_POSITIONS_PER_LEXEME = 256;

function parseHexList(raw: string): number[] {
  return raw === ""
    ? []
    : raw.split(",").map((value) => Number.parseInt(value, 16));
}

/** Sorted inclusive [start, end] pairs, flattened. */
const TOKEN_RANGES: readonly number[] = table.tokenRanges
  .split(",")
  .flatMap((range) => {
    const [start = "", end = start] = range.split("-");
    return [Number.parseInt(start, 16), Number.parseInt(end, 16)];
  });
const DROPPED: ReadonlySet<number> = new Set(parseHexList(table.dropped));
const FOLDS: ReadonlyMap<number, string> = new Map(
  table.folds.split(",").map((pair) => {
    const [from = "", to = ""] = pair.split(":");
    return [
      Number.parseInt(from, 16),
      String.fromCodePoint(Number.parseInt(to, 16)),
    ];
  }),
);

function isTokenCodePoint(cp: number): boolean {
  let low = 0;
  let high = TOKEN_RANGES.length / 2 - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = TOKEN_RANGES[mid * 2] ?? 0;
    const end = TOKEN_RANGES[mid * 2 + 1] ?? 0;
    if (cp < start) high = mid - 1;
    else if (cp > end) low = mid + 1;
    else return true;
  }
  return false;
}

/**
 * The tokens of `text` as unicode61 produces them: runs of token characters,
 * each code point folded (lower case, Latin diacritics removed), dropped
 * diacritics omitted.
 */
export function searchTokens(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (!isTokenCodePoint(cp)) {
      if (current !== "") tokens.push(current);
      current = "";
    } else if (!DROPPED.has(cp)) {
      current += FOLDS.get(cp) ?? ch;
    }
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

function fitsLexeme(token: string): boolean {
  return Buffer.byteLength(token, "utf8") <= MAX_LEXEME_BYTES;
}

/**
 * The tsvector literal for an entry. Title tokens take positions 1..n and
 * author tokens start one position later than adjacency allows, so a phrase
 * never spans the two fields (FTS5 matched phrases within one column).
 */
export function entrySearchDocument(title: string, author: string): string {
  const positions = new Map<string, number[]>();
  const add = (token: string, position: number): void => {
    if (!fitsLexeme(token)) return;
    const list = positions.get(token) ?? [];
    const clamped = Math.min(position, MAX_POSITION);
    if (list.length < MAX_POSITIONS_PER_LEXEME && list.at(-1) !== clamped) {
      list.push(clamped);
    }
    positions.set(token, list);
  };
  const titleTokens = searchTokens(title);
  titleTokens.forEach((token, index) => {
    add(token, index + 1);
  });
  searchTokens(author).forEach((token, index) => {
    add(token, titleTokens.length + 2 + index);
  });
  return [...positions]
    .map(([token, list]) => `'${token}':${list.join(",")}`)
    .join(" ");
}

/** One FTS5 phrase: adjacent tokens, the last optionally a prefix. */
type SearchClause = {
  readonly tokens: readonly string[];
  readonly prefix: boolean;
};

export type SearchQuery =
  /** Blank input: no search filter. */
  | { readonly kind: "none" }
  /** Input with nothing searchable in it: matches no entry. */
  | { readonly kind: "nothing" }
  | { readonly kind: "match"; readonly tsquery: string };

const QUERY_WORD = /[\p{L}\p{N}_]+/gu;

function clauseLiteral(clause: SearchClause): string {
  const last = clause.tokens.length - 1;
  const parts = clause.tokens.map((token, index) =>
    index === last && clause.prefix ? `'${token}':*` : `'${token}'`,
  );
  return parts.length === 1 ? (parts[0] ?? "") : `(${parts.join(" <-> ")})`;
}

/**
 * Parses console search input the way the SQLite store did: each `"quoted
 * phrase"` must appear as written, every other word matches as a prefix, and
 * all of them must match. Phrases that tokenize to nothing are ignored, as
 * FTS5 ignored them.
 */
export function parseSearchQuery(raw: string): SearchQuery {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { kind: "none" };
  }
  const clauses: SearchClause[] = [];
  const remainder = trimmed.replaceAll(
    /"([^"]*)"/gu,
    (_full, inner: string) => {
      const words = inner.match(QUERY_WORD) ?? [];
      if (words.length > 0) {
        clauses.push({ tokens: searchTokens(words.join(" ")), prefix: false });
      }
      return " ";
    },
  );
  for (const word of remainder.match(QUERY_WORD) ?? []) {
    clauses.push({ tokens: searchTokens(word), prefix: true });
  }
  const searchable = clauses.filter((clause) => clause.tokens.length > 0);
  if (
    searchable.length === 0 ||
    searchable.some(
      (clause) => !clause.tokens.every((token) => fitsLexeme(token)),
    )
  ) {
    return { kind: "nothing" };
  }
  return {
    kind: "match",
    tsquery: searchable.map((clause) => clauseLiteral(clause)).join(" & "),
  };
}
