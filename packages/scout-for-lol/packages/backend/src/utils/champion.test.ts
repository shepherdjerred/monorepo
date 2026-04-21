import { describe, expect, test } from "bun:test";
import {
  getChampionId,
  getChampionDisplayName,
  resolveChampionKey,
  searchChampions,
  getAllChampions,
} from "#src/utils/champion.ts";

describe("Champion utilities", () => {
  describe("getChampionId", () => {
    test("finds champion by exact name (uppercase)", () => {
      expect(getChampionId("YASUO")).toBe(157);
      expect(getChampionId("TWISTED_FATE")).toBe(4);
    });

    test("finds champion by name (case-insensitive)", () => {
      expect(getChampionId("yasuo")).toBe(157);
      expect(getChampionId("Yasuo")).toBe(157);
      expect(getChampionId("YASUO")).toBe(157);
    });

    test("finds champion with underscores or spaces", () => {
      expect(getChampionId("twisted_fate")).toBe(4);
      expect(getChampionId("twisted fate")).toBe(4);
      expect(getChampionId("Twisted Fate")).toBe(4);
    });

    test("returns undefined for non-existent champion", () => {
      expect(getChampionId("NONEXISTENT")).toBeUndefined();
      expect(getChampionId("")).toBeUndefined();
    });

    test("handles common champions", () => {
      expect(getChampionId("annie")).toBe(1);
      expect(getChampionId("lee_sin")).toBe(64);
      expect(getChampionId("lee sin")).toBe(64);
    });
  });

  describe("getChampionDisplayName", () => {
    test("formats champion names correctly", () => {
      expect(getChampionDisplayName(157)).toBe("Yasuo");
      expect(getChampionDisplayName(4)).toBe("Twisted Fate");
      expect(getChampionDisplayName(64)).toBe("Lee Sin");
      expect(getChampionDisplayName(1)).toBe("Annie");
    });

    // Spot-check the champions whose twisted output is inconsistent
    // (no underscore). The display name is still produced from the raw
    // string, so these render as a single word — covered explicitly
    // to pin current behavior.
    test("formats camelCase-filename champions", () => {
      expect(getChampionDisplayName(421)).toBe("Reksai"); // REKSAI
      expect(getChampionDisplayName(897)).toBe("Ksante"); // KSANTE
      expect(getChampionDisplayName(9)).toBe("Fiddlesticks"); // FIDDLESTICKS
      expect(getChampionDisplayName(59)).toBe("Jarvan Iv"); // JARVAN_IV
      expect(getChampionDisplayName(62)).toBe("Monkey King"); // MONKEY_KING (Wukong)
      expect(getChampionDisplayName(96)).toBe("Kog Maw"); // KOG_MAW
    });

    test("handles invalid champion ID", () => {
      const result = getChampionDisplayName(99_999);
      expect(result).toContain("Champion");
      expect(result).toContain("99999");
    });
  });

  describe("resolveChampionKey", () => {
    // Champions whose on-disk Data Dragon asset is camelCase. Every row
    // must round-trip from champion ID to the exact filename on disk —
    // this is the contract the loading-screen feature depends on.
    const cases: readonly (readonly [number, string])[] = [
      [1, "Annie"],
      [4, "TwistedFate"],
      [5, "XinZhao"],
      [9, "Fiddlesticks"],
      [11, "MasterYi"],
      [21, "MissFortune"],
      [36, "DrMundo"],
      [59, "JarvanIV"],
      [62, "MonkeyKing"],
      [64, "LeeSin"],
      [96, "KogMaw"],
      [136, "AurelionSol"],
      [157, "Yasuo"],
      [223, "TahmKench"],
      [421, "RekSai"],
      [897, "KSante"],
    ];

    test.each(cases)("resolveChampionKey(%i) === %s", (id, expected) => {
      expect(resolveChampionKey(id)).toBe(expected);
    });

    test("falls back for invalid champion id", () => {
      expect(resolveChampionKey(99_999)).toBe("Champion99999");
    });
  });

  describe("searchChampions", () => {
    test("finds champions by prefix", () => {
      const results = searchChampions("yas");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.name).toBe("Yasuo");
    });

    test("finds champions with multi-word names", () => {
      const results = searchChampions("twisted");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.name).toBe("Twisted Fate");
    });

    test("returns empty array for no matches", () => {
      const results = searchChampions("zzznonexistent");
      expect(results).toEqual([]);
    });

    test("limits results to specified limit", () => {
      const results = searchChampions("", 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    test("sorts exact matches first", () => {
      const results = searchChampions("lee");
      const leeSin = results.find((c) => c.name === "Lee Sin");
      expect(leeSin).toBeDefined();
      // Lee Sin should be in top results when searching for "lee"
      if (leeSin) {
        expect(results.slice(0, 5)).toContainEqual(leeSin);
      }
    });

    test("is case-insensitive", () => {
      const lowerResults = searchChampions("yas");
      const upperResults = searchChampions("YAS");
      expect(lowerResults).toEqual(upperResults);
    });

    // Twisted stores Rek'Sai as "REKSAI" (no underscore), so the
    // reverse-lookup key is "reksai". Queries that normalize to the same
    // string find her; queries containing apostrophes or spaces normalize
    // to "rek_sai" and do NOT (known gap — see follow-up normalization
    // layer plan). Pin current behavior so the gap is visible if fixed.
    test("finds Rek'Sai via plain forms", () => {
      for (const query of ["reksai", "REKSAI", "RekSai"]) {
        const results = searchChampions(query);
        const match = results.find((c) => c.id === 421);
        expect(match).toBeDefined();
      }
    });

    test("current gap: Rek'Sai apostrophe/space queries miss", () => {
      for (const query of ["rek'sai", "rek sai"]) {
        const results = searchChampions(query);
        const match = results.find((c) => c.id === 421);
        expect(match).toBeUndefined();
      }
    });

    test("default limit is 25", () => {
      const results = searchChampions("a"); // Common letter
      expect(results.length).toBeLessThanOrEqual(25);
    });
  });

  describe("getAllChampions", () => {
    test("returns array of champions", () => {
      const champions = getAllChampions();
      expect(champions.length).toBeGreaterThan(100); // Should have many champions
      expect(champions.every((c) => c.id > 0)).toBe(true);
      expect(champions.every((c) => c.name.length > 0)).toBe(true);
    });

    test("champions are sorted alphabetically", () => {
      const champions = getAllChampions();
      for (let i = 1; i < champions.length; i++) {
        const prev = champions[i - 1];
        const curr = champions[i];
        if (prev && curr) {
          expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0);
        }
      }
    });

    test("does not include empty champion", () => {
      const champions = getAllChampions();
      expect(
        champions.find((c) => c.name.toLowerCase().includes("empty")),
      ).toBeUndefined();
    });

    test("includes well-known champions", () => {
      const champions = getAllChampions();
      const names = champions.map((c) => c.name);
      expect(names).toContain("Yasuo");
      expect(names).toContain("Twisted Fate");
      expect(names).toContain("Lee Sin");
      expect(names).toContain("Annie");
    });
  });
});
