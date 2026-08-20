import { describe, expect, test } from "bun:test";
import { highlightReportQuery } from "#src/model/report-query-highlight.ts";

describe("highlightReportQuery", () => {
  test("preserves exact multiline source including invalid fragments", () => {
    const source =
      'FROM matches\nWHERE queue = "RANKED" AND duration >= 30\nSELECT win_rate @';
    const highlighted = highlightReportQuery(source);

    expect(highlighted.map((token) => token.text).join("")).toBe(source);
    expect(highlighted.find((token) => token.text === "FROM")?.kind).toBe(
      "keyword",
    );
    expect(highlighted.find((token) => token.text === "matches")?.kind).toBe(
      "identifier",
    );
    expect(highlighted.find((token) => token.text === '"RANKED"')?.kind).toBe(
      "string",
    );
    expect(highlighted.find((token) => token.text === "30")?.kind).toBe(
      "number",
    );
    expect(highlighted.find((token) => token.text === ">=")?.kind).toBe(
      "operator",
    );
    expect(highlighted.at(-1)).toEqual({ text: " @", kind: "plain" });
  });

  test("returns no synthetic token for an empty query", () => {
    expect(highlightReportQuery("")).toEqual([]);
  });
});
