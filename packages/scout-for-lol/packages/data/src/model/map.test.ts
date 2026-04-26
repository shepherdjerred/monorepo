import { describe, test, expect } from "bun:test";
import { mapIdToName, type MapName } from "./map.ts";

describe("mapIdToName", () => {
  // Source of truth: https://static.developer.riotgames.com/docs/lol/maps.json
  const cases: readonly (readonly [number, MapName])[] = [
    [11, "Summoner's Rift"],
    [12, "Howling Abyss"],
    [21, "Nexus Blitz"],
    [22, "Star Guardian"],
    [30, "Rings of Wrath"],
    [35, "The Bandlewood"],
  ];

  test.each(cases)("map id %i resolves to %s", (id, expected) => {
    expect(mapIdToName(id)).toBe(expected);
  });

  test("throws on unknown map id", () => {
    expect(() => mapIdToName(99_999)).toThrow(/Unknown map ID/);
  });
});
