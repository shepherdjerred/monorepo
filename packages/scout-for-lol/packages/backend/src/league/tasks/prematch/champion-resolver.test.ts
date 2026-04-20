import { describe, expect, test } from "bun:test";
import { resolveChampionKey } from "#src/utils/champion.ts";

describe("resolveChampionKey", () => {
  test("resolves known champion IDs", () => {
    // Annie = 1
    expect(resolveChampionKey(1)).toBe("Annie");
  });

  test("resolves multi-word champion names to PascalCase", () => {
    // Lee Sin = 64
    const result = resolveChampionKey(64);
    expect(result).toBe("LeeSin");
  });

  test("returns fallback for unknown champion ID", () => {
    const result = resolveChampionKey(99_999);
    expect(result).toStartWith("Champion");
  });

  test("resolves Aatrox (266)", () => {
    expect(resolveChampionKey(266)).toBe("Aatrox");
  });
});
