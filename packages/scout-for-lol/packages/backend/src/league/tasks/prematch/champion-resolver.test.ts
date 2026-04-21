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

  // Loading-screen regression pins: these champions' twisted outputs drop
  // the underscore ("REKSAI", "KSANTE") or contain Roman numerals
  // ("JARVAN_IV") and would 404 the on-disk asset without the
  // `championNameOverrides` map in @scout-for-lol/data.
  describe("camelCase Data Dragon filenames", () => {
    const cases: readonly (readonly [number, string])[] = [
      [421, "RekSai"],
      [897, "KSante"],
      [59, "JarvanIV"],
      [62, "MonkeyKing"],
      [96, "KogMaw"],
      [136, "AurelionSol"],
      [36, "DrMundo"],
      [223, "TahmKench"],
      [4, "TwistedFate"],
      [11, "MasterYi"],
      [21, "MissFortune"],
      [5, "XinZhao"],
      [9, "Fiddlesticks"],
    ];

    test.each(cases)("champion id %i resolves to %s", (id, expected) => {
      expect(resolveChampionKey(id)).toBe(expected);
    });
  });
});
