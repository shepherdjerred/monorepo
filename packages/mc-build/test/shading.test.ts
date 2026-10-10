import { describe, expect, it } from "vitest";
import { BlockGrid } from "#src/core/grid.ts";
import { blockLightLevels } from "#src/lint/lint.ts";
import { isPassable } from "#src/lint/physics.ts";
import { skyLightLevels } from "#src/render/shading.ts";

describe("glass skylight", () => {
  it.each([
    { block: "glass", expected: 15 },
    { block: "glass_pane", expected: 15 },
    { block: "white_stained_glass", expected: 15 },
    { block: "blue_stained_glass_pane", expected: 15 },
    { block: "cave_air", expected: 15 },
    { block: "void_air", expected: 15 },
    { block: "tinted_glass", expected: 0 },
    { block: "stone", expected: 0 },
  ])("vertical skylight through $block", ({ block, expected }) => {
    const grid = new BlockGrid({ x: 3, y: 4, z: 3 }, "minecraft:stone");
    grid.set(1, 1, 1, "minecraft:air");
    grid.set(1, 2, 1, "minecraft:air");
    grid.set(1, 3, 1, `minecraft:${block}`);
    expect(skyLightLevels(grid)[grid.index(1, 1, 1)]).toBe(expected);
  });
  it.each(["glass", "red_stained_glass_pane", "tinted_glass", "stone"])(
    "handles sideways transmission through %s",
    (block) => {
      const grid = new BlockGrid({ x: 5, y: 5, z: 5 }, "minecraft:stone");
      for (let y = 1; y < 5; y += 1) grid.set(0, y, 2, "minecraft:air");
      grid.set(1, 2, 2, `minecraft:${block}`);
      grid.set(2, 2, 2, "minecraft:air");
      expect(skyLightLevels(grid)[grid.index(2, 2, 2)]).toBe(
        block === "stone" || block === "tinted_glass" ? 0 : 13,
      );
    },
  );
});

describe("block light through glazed partitions", () => {
  it.each([
    { block: "glass", expected: 13 },
    { block: "glass_pane", expected: 13 },
    { block: "white_stained_glass", expected: 13 },
    { block: "blue_stained_glass_pane", expected: 13 },
    { block: "tinted_glass", expected: 0 },
    { block: "stone", expected: 0 },
    { block: "light_gray_concrete", expected: 0 },
    { block: "light_blue_wool", expected: 0 },
  ])("handles $block without making it passable", ({ block, expected }) => {
    const grid = new BlockGrid({ x: 5, y: 3, z: 3 }, "minecraft:stone");
    grid.set(1, 1, 1, "minecraft:lantern");
    grid.set(2, 1, 1, `minecraft:${block}`);
    grid.set(3, 1, 1, "minecraft:air");
    expect(blockLightLevels(grid)[grid.index(3, 1, 1)]).toBe(expected);
    expect(isPassable(`minecraft:${block}`)).toBe(false);
  });
});

describe("invisible light blocks", () => {
  it.each([
    { state: "minecraft:light", level: 15 },
    ...Array.from({ length: 16 }, (_, level) => ({
      state: `minecraft:light[level=${level.toString()}]`,
      level,
    })),
  ])("propagates $state at its emitted level", ({ state, level }) => {
    const grid = new BlockGrid({ x: 7, y: 3, z: 3 }, "minecraft:stone");
    for (let x = 1; x < 6; x += 1) grid.set(x, 1, 1, "minecraft:air");
    grid.set(1, 1, 1, state);
    const light = blockLightLevels(grid);
    for (let offset = 0; offset < 5; offset += 1) {
      expect(light[grid.index(1 + offset, 1, 1)]).toBe(
        Math.max(0, level - offset),
      );
    }
  });
});
