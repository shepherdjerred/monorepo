import { describe, expect, test } from "vitest";
import { contrastRatio, parseColor } from "./contrast.ts";

describe("contrast helpers", () => {
  test("parses opaque and alpha colors", () => {
    expect(parseColor("#010A13")).toEqual([1, 10, 19, 1]);
    expect(parseColor("rgba(255, 255, 255, 0.5)")).toEqual([
      255, 255, 255, 0.5,
    ]);
  });

  test("calculates WCAG contrast ratio", () => {
    const white = parseColor("#FFFFFF");
    const black = parseColor("#000000");
    if (white === null || black === null)
      throw new Error("Fixture colors did not parse");
    expect(contrastRatio(white, black)).toBe(21);
  });
});
