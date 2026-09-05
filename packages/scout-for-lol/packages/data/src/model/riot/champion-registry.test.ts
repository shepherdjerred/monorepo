import { describe, test, expect } from "vitest";
import {
  getChampionById,
  getChampionByKey,
  getChampionDisplayName,
  resolveChampionKey,
  getChampionIdByName,
  normalizeChampionName,
  searchChampions,
  getAllChampions,
} from "./champion-registry.ts";

describe("champion-registry", () => {
  test("resolves champion by ID", () => {
    const annie = getChampionById(1);
    expect(annie).toBeDefined();
    expect(annie?.key).toBe("Annie");
    expect(annie?.name).toBe("Annie");

    const tf = getChampionById(4);
    expect(tf).toBeDefined();
    expect(tf?.key).toBe("TwistedFate");
    expect(tf?.name).toBe("Twisted Fate");

    const leeSin = getChampionById(64);
    expect(leeSin?.key).toBe("LeeSin");
    expect(leeSin?.name).toBe("Lee Sin");
  });

  test("resolves champion by Data Dragon key", () => {
    const wukong = getChampionByKey("MonkeyKing");
    expect(wukong?.id).toBe(62);
    expect(wukong?.name).toBe("Wukong");

    const velkoz = getChampionByKey("Velkoz");
    expect(velkoz?.id).toBe(161);
    expect(velkoz?.name).toBe("Vel'Koz");
  });

  test("resolves display names with punctuation", () => {
    expect(getChampionDisplayName(161)).toBe("Vel'Koz");
    expect(getChampionDisplayName(121)).toBe("Kha'Zix");
    expect(getChampionDisplayName(62)).toBe("Wukong");
    expect(getChampionDisplayName(4)).toBe("Twisted Fate");
    expect(getChampionDisplayName(999_999)).toBe("Champion 999999");
  });

  test("resolves Data Dragon key from ID", () => {
    expect(resolveChampionKey(1)).toBe("Annie");
    expect(resolveChampionKey(64)).toBe("LeeSin");
    expect(resolveChampionKey(62)).toBe("MonkeyKing");
    expect(resolveChampionKey(421)).toBe("RekSai");
    expect(resolveChampionKey(888)).toBe("Renata");
    expect(resolveChampionKey(999_999)).toBe("Champion999999");
  });

  test("resolves champion ID by various name formats", () => {
    expect(getChampionIdByName("yasuo")).toBe(157);
    expect(getChampionIdByName("Yasuo")).toBe(157);
    expect(getChampionIdByName("YASUO")).toBe(157);
    expect(getChampionIdByName("Twisted Fate")).toBe(4);
    expect(getChampionIdByName("twisted_fate")).toBe(4);
    expect(getChampionIdByName("twisted fate")).toBe(4);
    expect(getChampionIdByName("wukong")).toBe(62);
    expect(getChampionIdByName("MonkeyKing")).toBe(62);
    expect(getChampionIdByName("lee sin")).toBe(64);
    expect(getChampionIdByName("LeeSin")).toBe(64);
    expect(getChampionIdByName("nonexistent")).toBeUndefined();
  });

  test("normalizes champion names and quirks", () => {
    expect(normalizeChampionName("leesin")).toBe("LeeSin");
    expect(normalizeChampionName("fiddlesticks")).toBe("Fiddlesticks");
    expect(normalizeChampionName("wukong")).toBe("MonkeyKing");
    expect(normalizeChampionName("Nunu & Willump")).toBe("Nunu");
  });

  test("searches champions by query with proper ranking", () => {
    const yasuoResults = searchChampions("yas");
    expect(yasuoResults.length).toBeGreaterThan(0);
    expect(yasuoResults[0]?.name).toBe("Yasuo");
    expect(yasuoResults[0]?.id).toBe(157);

    const tfResults = searchChampions("twisted");
    expect(tfResults[0]?.name).toBe("Twisted Fate");
    expect(tfResults[0]?.id).toBe(4);
  });

  test("returns all champions sorted alphabetically", () => {
    const all = getAllChampions();
    expect(all.length).toBeGreaterThan(150);
    expect(all[0]?.name.localeCompare(all[1]?.name ?? "")).toBeLessThanOrEqual(
      0,
    );
  });
});
