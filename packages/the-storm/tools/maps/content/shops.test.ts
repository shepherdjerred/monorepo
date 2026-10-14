import { describe, expect, test } from "vitest";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { Details, isShopSign, stripShopSigns } from "./shops.ts";

const sign = (front: string, back = "") => ({
  at: { x: 1, y: 1, z: 1 },
  material: "minecraft:oak_wall_sign",
  front: { lines: [front, "", "", ""], color: "BLACK", glowing: false },
  back: { lines: [back, "", "", ""], color: "BLACK", glowing: false },
  waxed: true,
});
describe("legacy shop removal", () => {
  test("normalizes formatting and case on either face", () => {
    expect(isShopSign(sign("§4[BuY]"))).toBe(true);
    expect(isShopSign(sign("Welcome", "§x§f§f§0§0§0§0[BUY] arrows"))).toBe(
      true,
    );
    expect(isShopSign(sign("Buy supplies", "[Vote]"))).toBe(false);
  });
  test("removes only matching terrain and payloads, preserving containers and other signs", () => {
    const grid = new BlockGrid({ x: 4, y: 4, z: 4 });
    grid.set(
      1,
      1,
      1,
      "minecraft:oak_wall_sign[facing=north,waterlogged=false]",
    );
    grid.set(
      2,
      1,
      1,
      "minecraft:oak_wall_sign[facing=north,waterlogged=false]",
    );
    grid.set(1, 0, 1, "minecraft:stone");
    const welcome = { ...sign("Welcome"), at: { x: 2, y: 1, z: 1 } };
    const containers = [
      { at: { x: 3, y: 1, z: 1 }, contents: ["native item payload"] },
    ];
    const details = Details.parse({
      version: 1,
      blocksSha256: "a".repeat(64),
      containers,
      signs: [sign("[Buy]"), welcome],
    });
    const result = stripShopSigns(grid, details);
    expect(grid.get(1, 1, 1)).toBe("minecraft:air");
    expect(grid.get(1, 0, 1)).toBe("minecraft:stone");
    expect(grid.get(2, 1, 1)).toContain("oak_wall_sign");
    expect(result.details.signs).toEqual([welcome]);
    expect(result.details.containers).toEqual(containers);
    expect(result.removed).toEqual([
      {
        sign: sign("[Buy]"),
        state: "minecraft:oak_wall_sign[facing=north,waterlogged=false]",
      },
    ]);
    expect(stripShopSigns(grid, result.details).removed).toEqual([]);
  });
  test("rejects a stale sign position instead of deleting unrelated terrain", () => {
    const grid = new BlockGrid({ x: 3, y: 3, z: 3 }, "minecraft:stone");
    const details = Details.parse({
      version: 1,
      blocksSha256: "a".repeat(64),
      containers: [],
      signs: [sign("[Buy]")],
    });
    expect(() => stripShopSigns(grid, details)).toThrow("differs from terrain");
    expect(grid.get(1, 1, 1)).toBe("minecraft:stone");
  });
});
