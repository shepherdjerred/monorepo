import { describe, expect, test } from "bun:test";
import { parseJsonResponse } from "./claude.ts";

function getMerchants(result: unknown): unknown[] {
  if (
    typeof result !== "object" ||
    result === null ||
    !("merchants" in result)
  ) {
    return [];
  }
  const { merchants } = result;
  if (Array.isArray(merchants)) return merchants;
  return [];
}

describe("parseJsonResponse", () => {
  test("parses clean JSON", () => {
    const input =
      '{"merchants": [{"merchantName": "Test", "categoryId": "cat-1", "categoryName": "Shopping", "confidence": "high", "ambiguous": false}]}';
    const merchants = getMerchants(parseJsonResponse(input));

    expect(merchants).toHaveLength(1);
  });

  test("parses markdown-fenced JSON", () => {
    const input =
      '```json\n{"merchants": [{"merchantName": "Test", "categoryId": "cat-1", "categoryName": "Shopping", "confidence": "high", "ambiguous": false}]}\n```';
    const merchants = getMerchants(parseJsonResponse(input));

    expect(merchants).toHaveLength(1);
  });

  test("parses fenced JSON without language tag", () => {
    const input = '```\n{"merchants": []}\n```';
    const merchants = getMerchants(parseJsonResponse(input));

    expect(merchants).toHaveLength(0);
  });

  test("throws on malformed JSON", () => {
    expect(() => parseJsonResponse("{invalid")).toThrow();
  });

  test("handles whitespace around JSON", () => {
    const input = '  \n  {"merchants": []}  \n  ';
    const merchants = getMerchants(parseJsonResponse(input));

    expect(merchants).toHaveLength(0);
  });
});
