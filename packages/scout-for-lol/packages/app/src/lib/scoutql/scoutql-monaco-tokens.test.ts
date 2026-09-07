import { describe, expect, test } from "vitest";
import type { ScoutQlSemanticToken } from "@scout-for-lol/data/model/scoutql/semantic-tokens.ts";
import { scoutQlSemanticTokens } from "@scout-for-lol/data/model/scoutql/semantic-tokens.ts";
import {
  encodeScoutQlSemanticTokens,
  scoutQlLineRanges,
  scoutQlLineTokens,
  scoutQlTokenTypeIndex,
  SCOUTQL_SEMANTIC_TOKEN_TYPES,
} from "#src/lib/scoutql/scoutql-monaco-tokens.ts";

/** Reads the flat uint32 stream back into absolute positions. */
function decode(
  data: readonly number[],
): { line: number; column: number; length: number; type: number }[] {
  const tokens: {
    line: number;
    column: number;
    length: number;
    type: number;
  }[] = [];
  let line = 0;
  let column = 0;
  for (let index = 0; index < data.length; index += 5) {
    const deltaLine = data[index] ?? 0;
    const deltaColumn = data[index + 1] ?? 0;
    line += deltaLine;
    column = deltaLine === 0 ? column + deltaColumn : deltaColumn;
    tokens.push({
      line,
      column,
      length: data[index + 2] ?? 0,
      type: data[index + 3] ?? 0,
    });
  }
  return tokens;
}

describe("the semantic token legend", () => {
  test("the ts-pattern index map agrees with the legend order", () => {
    for (const [index, kind] of SCOUTQL_SEMANTIC_TOKEN_TYPES.entries()) {
      expect(scoutQlTokenTypeIndex(kind)).toBe(index);
    }
  });

  test("every legend entry is distinct", () => {
    expect(new Set(SCOUTQL_SEMANTIC_TOKEN_TYPES).size).toBe(
      SCOUTQL_SEMANTIC_TOKEN_TYPES.length,
    );
  });
});

describe("line ranges", () => {
  test("an empty document still has one line", () => {
    expect(scoutQlLineRanges("")).toEqual([{ start: 0, end: 0 }]);
  });

  test("carriage returns are excluded from line content", () => {
    expect(scoutQlLineRanges("ab\r\ncd")).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 6 },
    ]);
  });
});

describe("encodeScoutQlSemanticTokens", () => {
  test("delta-encodes a single-line query relative to the previous token", () => {
    const text = "SELECT games";
    const tokens: ScoutQlSemanticToken[] = [
      { start: 0, length: 6, kind: "keyword" },
      { start: 6, length: 1, kind: "plain" },
      { start: 7, length: 5, kind: "column" },
    ];
    expect(encodeScoutQlSemanticTokens(text, tokens)).toEqual([
      0,
      0,
      6,
      scoutQlTokenTypeIndex("keyword"),
      0,
      // Same line, so the column is a delta from the previous token's start.
      0,
      7,
      5,
      scoutQlTokenTypeIndex("column"),
      0,
    ]);
  });

  test("restarts the column at every new line", () => {
    const text = "SELECT games\nFROM match_participants";
    const tokens: ScoutQlSemanticToken[] = [
      { start: 0, length: 6, kind: "keyword" },
      { start: 13, length: 4, kind: "keyword" },
      { start: 18, length: 18, kind: "source" },
    ];
    expect(decode(encodeScoutQlSemanticTokens(text, tokens))).toEqual([
      { line: 0, column: 0, length: 6, type: scoutQlTokenTypeIndex("keyword") },
      { line: 1, column: 0, length: 4, type: scoutQlTokenTypeIndex("keyword") },
      { line: 1, column: 5, length: 18, type: scoutQlTokenTypeIndex("source") },
    ]);
  });

  test("splits a token that straddles a line break", () => {
    // A string literal may contain a newline; Monaco rejects a token that
    // spans lines, so it has to arrive as one token per line.
    const text = "'one\ntwo'";
    const split = scoutQlLineTokens(text, [
      { start: 0, length: 9, kind: "string" },
    ]);
    expect(split).toEqual([
      { line: 0, column: 0, length: 4, kind: "string" },
      { line: 1, column: 0, length: 4, kind: "string" },
    ]);
  });

  test("drops the whitespace tiling the language service emits", () => {
    const text = "SELECT  games";
    const encoded = encodeScoutQlSemanticTokens(text, [
      { start: 0, length: 6, kind: "keyword" },
      { start: 6, length: 2, kind: "plain" },
      { start: 8, length: 5, kind: "column" },
    ]);
    expect(encoded).toHaveLength(10);
    expect(
      decode(encoded).some(
        (token) => token.type === scoutQlTokenTypeIndex("plain"),
      ),
    ).toBe(false);
  });

  test("encodes an empty document as an empty stream", () => {
    expect(encodeScoutQlSemanticTokens("", [])).toEqual([]);
  });
});

describe("encoding real language-service output", () => {
  const cases = [
    {
      name: "a multi-line query",
      text: [
        "SELECT AVG(win::INT) AS win_rate",
        "FROM match_participants",
        "GROUP BY player",
        "RENDER leaderboard",
      ].join("\n"),
    },
    {
      name: "a malformed query",
      text: "SELECT @@ FROM ??? GROUP",
    },
  ];

  for (const { name, text } of cases) {
    test(`${name} encodes to in-range, monotonic tokens`, () => {
      const tokens = scoutQlSemanticTokens(text);
      const decoded = decode(encodeScoutQlSemanticTokens(text, tokens));
      const lines = text.split("\n");

      expect(decoded.length).toBeGreaterThan(0);
      let previous = { line: -1, column: -1 };
      for (const token of decoded) {
        const lineText = lines[token.line];
        expect(lineText).toBeDefined();
        expect(token.column + token.length).toBeLessThanOrEqual(
          lineText?.length ?? 0,
        );
        expect(token.length).toBeGreaterThan(0);
        const advanced =
          token.line > previous.line ||
          (token.line === previous.line && token.column > previous.column);
        expect(advanced).toBe(true);
        previous = { line: token.line, column: token.column };
      }
    });
  }

  test("a malformed query still reports its unmatched text as invalid", () => {
    const text = "SELECT @@ FROM ???";
    const decoded = decode(
      encodeScoutQlSemanticTokens(text, scoutQlSemanticTokens(text)),
    );
    expect(
      decoded.some((token) => token.type === scoutQlTokenTypeIndex("invalid")),
    ).toBe(true);
  });
});
