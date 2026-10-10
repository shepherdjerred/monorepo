import { describe, expect, it } from "vitest";
import { legacyMap, mapContent, mapId } from "./legacy.ts";

const text = `
Name: Original
Author: Builders
Description: Original description
Border: ['-16,0,-16', '16,0,16']
Teams:
  RED: { Spawns: ['-10,26,0', '-9,26,0'] }
  BLUE: { Spawns: ['10,26,0'] }
  GREEN: { Spawns: ['0,26,10'] }
  PURPLE: { Spawns: ['0,26,-10'] }
Custom:
  RED Bombs: ['-10,27,0']
  BLUE Bombs: ['10,27,0']
  GREEN Bombs: ['0,27,10']
  PURPLE Bombs: ['0,27,-10']
  Random Base: [true]
`;
const terrain = {
  state: "complete",
  minY: 0,
  maxY: 64,
  removedData: 0,
  blocksSha256: "a".repeat(64),
} satisfies Parameters<typeof mapContent>[3];

describe("legacy map metadata", () => {
  it("preserves four teams, every spawn and bomb, and original descriptive metadata", () => {
    const map = legacyMap(text);
    const converted = mapContent("original", 0, map, terrain);
    expect(converted.teams.map((team) => team.spawns.length)).toEqual([
      2, 1, 1, 1,
    ]);
    expect(converted.bombs.map((bomb) => bomb.team)).toEqual([
      "RED",
      "BLUE",
      "GREEN",
      "PURPLE",
    ]);
    expect(converted.teams[0]?.spawns[0]).toMatchObject({
      x: 1030.5,
      y: 26,
      z: 1040.5,
    });
    expect(converted.bombs[0]?.at).toEqual({ x: 1030, y: 27, z: 1040 });
    expect(map.source.Description).toBe("Original description");
    expect(map.source.Custom["Random Base"]).toEqual([true]);
    expect(converted.name).toBe("Original");
    expect(converted.author).toBe("Builders");
  });
  it("places maps deterministically in disjoint grid cells", () => {
    const map = legacyMap(text);
    const first = mapContent("original", 0, map, terrain);
    const sixth = mapContent("sixth", 6, map, terrain);
    expect(sixth.region.min.z - first.region.min.z).toBe(1024);
    expect(sixth.region.min.z).toBeGreaterThan(first.region.max.z);
    expect(mapId("ClonedBeanstalks.zip")).toBe("cloned-beanstalks");
  });
  it("rejects unknown teams, settings, missing bombs and out-of-bounds spawns", () => {
    for (const invalid of [
      text.replace("GREEN:", "ORANGE:"),
      text.replace("Random Base:", "Unknown Setting:"),
      text.replace("  RED Bombs: ['-10,27,0']", ""),
      text.replace("-10,26,0", "-17,26,0"),
    ])
      expect(() => legacyMap(invalid)).toThrow();
  });
});
