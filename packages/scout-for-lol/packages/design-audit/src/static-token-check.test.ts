import { describe, expect, test } from "bun:test";
import { findInvalidTokenPairs } from "./static-token-check.ts";

describe("Scout semantic token pairs", () => {
  test("rejects same-token foreground and opaque background", () => {
    expect(
      findInvalidTokenPairs(
        '<div class="bg-scout-success text-scout-success">',
        "fixture.tsx",
      ),
    ).toHaveLength(1);
  });

  test("allows the generated ink foreground", () => {
    expect(
      findInvalidTokenPairs(
        '<div class="bg-scout-success text-scout-success-ink">',
        "fixture.tsx",
      ),
    ).toEqual([]);
  });

  test("allows a translucent semantic background", () => {
    expect(
      findInvalidTokenPairs(
        '<div class="bg-scout-success/20 text-scout-success">',
        "fixture.tsx",
      ),
    ).toEqual([]);
  });

  test("does not conflate adjacent sibling elements", () => {
    expect(
      findInvalidTokenPairs(
        '<div class="bg-scout-success"></div><span class="text-scout-success"></span>',
        "fixture.tsx",
      ),
    ).toEqual([]);
  });

  test("rejects same-token fields with whitespace after the background", () => {
    expect(
      findInvalidTokenPairs(
        'const entry = { bg: "bg-scout-warning ", title: "text-scout-warning" };',
        "fixture.tsx",
      ),
    ).toHaveLength(1);
  });
});
