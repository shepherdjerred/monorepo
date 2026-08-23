import { describe, expect, test } from "vitest";
import {
  Identifier,
  SCOUTQL_KEYWORDS,
  decodeScoutQlIdentifier,
  decodeScoutQlString,
  scoutQlTokenTypes,
  tokenSpan,
  tokenizeScoutQl,
} from "#src/model/scoutql/tokens.ts";

function tokenNames(text: string): string[] {
  const result = tokenizeScoutQl(text);
  expect(result.errors).toEqual([]);
  return result.tokens.map((token) => token.tokenType.name);
}

describe("keywords", () => {
  test("lex case-insensitively", () => {
    expect(tokenNames("select FROM WhErE")).toEqual([
      "Select",
      "From",
      "Where",
    ]);
  });

  test("longer identifiers win over keyword prefixes (longer_alt)", () => {
    expect(tokenNames("formatted")).toEqual(["Identifier"]);
    expect(tokenNames("intervals")).toEqual(["Identifier"]);
    expect(tokenNames("orderly")).toEqual(["Identifier"]);
    expect(tokenNames("timestamp")).toEqual(["Identifier"]);
    expect(tokenNames("groups")).toEqual(["Identifier"]);
  });

  test("keyword-prefixed keywords lex as themselves", () => {
    expect(tokenNames("interval in")).toEqual(["Interval", "In"]);
    expect(tokenNames("order or")).toEqual(["Order", "Or"]);
    expect(tokenNames("asc as")).toEqual(["Asc", "As"]);
    expect(tokenNames("current_timestamp current_date")).toEqual([
      "CurrentTimestamp",
      "CurrentDate",
    ]);
  });

  test("interval units and function names stay identifiers", () => {
    expect(
      tokenNames("day days week month date_trunc previous_period"),
    ).toEqual([
      "Identifier",
      "Identifier",
      "Identifier",
      "Identifier",
      "Identifier",
      "Identifier",
    ]);
  });
});

describe("SCOUTQL_KEYWORDS", () => {
  test("contains every keyword token's word and nothing else", () => {
    // Keyword tokens are exactly the tokens whose longer_alt is Identifier;
    // their pattern source is the keyword word. Deriving the expectation from
    // the definitions keeps this the only keyword list in the repo.
    const derived = scoutQlTokenTypes
      .filter((tokenType) => tokenType.LONGER_ALT === Identifier)
      .map((tokenType) => {
        const pattern = tokenType.PATTERN;
        if (!(pattern instanceof RegExp)) {
          throw new TypeError(
            `keyword ${tokenType.name} has a non-RegExp pattern`,
          );
        }
        return pattern.source.toUpperCase();
      });
    expect([...SCOUTQL_KEYWORDS].sort()).toEqual([...derived].sort());
    expect(new Set(SCOUTQL_KEYWORDS).size).toBe(SCOUTQL_KEYWORDS.length);
  });

  test("holds the full uppercase keyword vocabulary", () => {
    expect(SCOUTQL_KEYWORDS).toHaveLength(35);
    for (const word of [
      "SELECT",
      "FROM",
      "GROUP",
      "BY",
      "FILTER",
      "DISTINCT",
      "ILIKE",
      "CURRENT_TIMESTAMP",
      "CURRENT_DATE",
      "CASE",
      "AT",
      "TIME",
      "ZONE",
    ]) {
      expect(SCOUTQL_KEYWORDS).toContain(word);
    }
    for (const word of [
      "DAY",
      "MONTH",
      "DATE_TRUNC",
      "PREVIOUS_PERIOD",
      "COUNT",
    ]) {
      expect(SCOUTQL_KEYWORDS).not.toContain(word);
    }
    for (const word of SCOUTQL_KEYWORDS) {
      expect(word).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe("operators and literals", () => {
  test("multi-char operators before their prefixes", () => {
    expect(tokenNames(":: != <> <= >= < > = + - * / % . ( ) ,")).toEqual([
      "DoubleColon",
      "NotEquals",
      "LtGt",
      "LessEqual",
      "GreaterEqual",
      "Less",
      "Greater",
      "Equals",
      "Plus",
      "Minus",
      "Star",
      "Slash",
      "Percent",
      "Dot",
      "LParen",
      "RParen",
      "Comma",
    ]);
  });

  test("numbers lex with decimals and exponents", () => {
    expect(tokenNames("1 1.5 1.5e3 2E-2")).toEqual([
      "NumberLiteral",
      "NumberLiteral",
      "NumberLiteral",
      "NumberLiteral",
    ]);
  });

  test("hex colors lex for render options", () => {
    expect(tokenNames("#AaBbCc")).toEqual(["HexColor"]);
  });

  test("single-quoted strings with '' doubling lex as one token", () => {
    expect(tokenNames("'a''b' 'x'")).toEqual([
      "StringLiteral",
      "StringLiteral",
    ]);
  });

  test("unterminated strings lex as their own recovery token", () => {
    const result = tokenizeScoutQl("'abc");
    expect(result.errors).toEqual([]);
    expect(result.tokens.map((token) => token.tokenType.name)).toEqual([
      "UnterminatedStringLiteral",
    ]);
  });

  test("double-quoted text lexes as a quoted identifier", () => {
    expect(tokenNames('"win rate"')).toEqual(["QuotedIdentifier"]);
    const unterminated = tokenizeScoutQl('"abc');
    expect(unterminated.tokens.map((token) => token.tokenType.name)).toEqual([
      "UnterminatedQuotedIdentifier",
    ]);
  });
});

describe("comments", () => {
  test("-- comments go to the comments group, not the token stream", () => {
    const result = tokenizeScoutQl("-- top\nSELECT 1 -- tail");
    expect(result.errors).toEqual([]);
    expect(result.comments.map((token) => token.image)).toEqual([
      "-- top",
      "-- tail",
    ]);
    expect(result.tokens.map((token) => token.tokenType.name)).toEqual([
      "Select",
      "NumberLiteral",
    ]);
  });

  test("comment spans are exact", () => {
    const text = "SELECT 1 -- note";
    const result = tokenizeScoutQl(text);
    const [comment] = result.comments;
    if (comment === undefined) {
      throw new Error("expected a comment token");
    }
    expect(tokenSpan(comment)).toEqual({
      start: text.indexOf("-- note"),
      end: text.length,
    });
  });
});

describe("tokenSpan", () => {
  test("returns half-open spans for real tokens", () => {
    const result = tokenizeScoutQl("SELECT games");
    const [select, games] = result.tokens;
    if (select === undefined || games === undefined) {
      throw new Error("expected two tokens");
    }
    expect(tokenSpan(select)).toEqual({ start: 0, end: 6 });
    expect(tokenSpan(games)).toEqual({ start: 7, end: 12 });
  });

  test("returns null for synthetic locations", () => {
    const result = tokenizeScoutQl("SELECT");
    const [select] = result.tokens;
    if (select === undefined) {
      throw new Error("expected a token");
    }
    expect(tokenSpan({ ...select, startOffset: -1 })).toBeNull();
    expect(
      tokenSpan({ ...select, endOffset: select.startOffset - 1 }),
    ).toBeNull();
    expect(tokenSpan({ ...select, startOffset: Number.NaN })).toBeNull();
  });
});

describe("lexeme decoding", () => {
  test("decodes string escapes", () => {
    expect(decodeScoutQlString("'Kai''Sa'")).toBe("Kai'Sa");
    expect(decodeScoutQlString("''")).toBe("");
    expect(decodeScoutQlString("'abc")).toBe("abc");
    expect(decodeScoutQlString("'ab''")).toBe("ab'");
  });

  test("decodes and lowercases identifiers", () => {
    expect(decodeScoutQlIdentifier("Win_Rate")).toBe("win_rate");
    expect(decodeScoutQlIdentifier('"Quoted""Name"')).toBe('quoted"name');
    expect(decodeScoutQlIdentifier('"open')).toBe("open");
  });
});
