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
});
