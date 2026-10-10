import { describe, expect, it } from "vitest";
import { BlockGrid } from "#src/core/grid.ts";
import { blockLightLevels } from "#src/lint/block-light.ts";
import { loadRegistry } from "#src/registry/registry.ts";
import { isPassable } from "#src/lint/physics.ts";
import { skyLightLevels } from "#src/render/shading.ts";
const registry = await loadRegistry();

// Flood-field fixtures supply classifications explicitly; renderer tests cover
// the production model/texture classification boundary.
function fixtureTransmission(grid: BlockGrid): ReadonlyMap<string, boolean> {
  return new Map(
    grid.palette.map((state) => [
      state,
      state !== "minecraft:stone" && state !== "minecraft:tinted_glass",
    ]),
  );
}

describe("glass skylight", () => {
  it.each([
    { block: "glass", expected: 15 },
    { block: "glass_pane", expected: 15 },
    { block: "white_stained_glass", expected: 15 },
    { block: "blue_stained_glass_pane", expected: 15 },
    { block: "cave_air", expected: 15 },
    { block: "void_air", expected: 15 },
    { block: "light", expected: 15 },
    ...Array.from({ length: 16 }, (_, level) => ({
      block: `light[level=${level.toString()}]`,
      expected: 15,
    })),
    { block: "tinted_glass", expected: 0 },
    { block: "stone", expected: 0 },
  ])("vertical skylight through $block", ({ block, expected }) => {
    const grid = new BlockGrid({ x: 3, y: 4, z: 3 }, "minecraft:stone");
    grid.set(1, 1, 1, "minecraft:air");
    grid.set(1, 2, 1, "minecraft:air");
    grid.set(1, 3, 1, `minecraft:${block}`);
    expect(
      skyLightLevels(grid, fixtureTransmission(grid))[grid.index(1, 1, 1)],
    ).toBe(expected);
  });
  it.each([
    "glass",
    "red_stained_glass_pane",
    "light[level=0]",
    "tinted_glass",
    "stone",
  ])("handles sideways transmission through %s", (block) => {
    const grid = new BlockGrid({ x: 5, y: 5, z: 5 }, "minecraft:stone");
    for (let y = 1; y < 5; y += 1) grid.set(0, y, 2, "minecraft:air");
    grid.set(1, 2, 2, `minecraft:${block}`);
    grid.set(2, 2, 2, "minecraft:air");
    expect(
      skyLightLevels(grid, fixtureTransmission(grid))[grid.index(2, 2, 2)],
    ).toBe(block === "stone" || block === "tinted_glass" ? 0 : 13);
  });
  it("rejects an incomplete transmission classification", () => {
    const grid = new BlockGrid({ x: 1, y: 1, z: 1 });
    expect(() => skyLightLevels(grid, new Map())).toThrow(
      /Missing light transmission/u,
    );
  });
});

describe("block light through glazed partitions", () => {
  it.each([
    { block: "glass", expected: 13 },
    { block: "glass_pane", expected: 13 },
    { block: "white_stained_glass", expected: 13 },
    { block: "blue_stained_glass_pane", expected: 13 },
    { block: "oak_fence", expected: 13 },
    { block: "iron_bars", expected: 13 },
    { block: "oak_slab[type=bottom]", expected: 13 },
    { block: "oak_slab[type=double]", expected: 0 },
    { block: "tinted_glass", expected: 0 },
    { block: "stone", expected: 0 },
    { block: "light_gray_concrete", expected: 0 },
    { block: "light_blue_wool", expected: 0 },
  ])("handles $block without making it passable", ({ block, expected }) => {
    const grid = new BlockGrid({ x: 5, y: 3, z: 3 }, "minecraft:stone");
    grid.set(1, 1, 1, "minecraft:lantern");
    grid.set(2, 1, 1, `minecraft:${block}`);
    grid.set(3, 1, 1, "minecraft:air");
    expect(blockLightLevels(grid, { registry })[grid.index(3, 1, 1)]).toBe(
      expected,
    );
    expect(isPassable(`minecraft:${block}`)).toBe(false);
  });
});

describe("Paper state emission", () => {
  it.each([
    ["redstone_torch", 7],
    ["redstone_torch[lit=false]", 0],
    ["sea_pickle", 6],
    ["sea_pickle[pickles=4,waterlogged=true]", 15],
    ["sea_pickle[pickles=4,waterlogged=false]", 0],
    ["respawn_anchor[charges=4]", 15],
    ["respawn_anchor[charges=0]", 0],
    ["glow_lichen[north=true]", 7],
    ["candle_cake[lit=true]", 3],
    ["small_amethyst_bud", 1],
    ["amethyst_cluster", 5],
    ["magma_block", 3],
    ["sculk_sensor[sculk_sensor_phase=active]", 1],
    ["copper_bulb[lit=true]", 15],
    ["firefly_bush", 2],
  ] as const)("propagates %s with emission %i", (state, emission) => {
    const grid = new BlockGrid({ x: 5, y: 3, z: 3 }, "minecraft:stone");
    grid.set(1, 1, 1, `minecraft:${state}`);
    grid.set(2, 1, 1, "minecraft:air");
    grid.set(3, 1, 1, "minecraft:air");
    const light = blockLightLevels(grid, { registry });
    expect(light[grid.index(1, 1, 1)]).toBe(emission);
    expect(light[grid.index(2, 1, 1)]).toBe(Math.max(0, emission - 1));
    expect(light[grid.index(3, 1, 1)]).toBe(Math.max(0, emission - 2));
  });

  it("rejects incomplete renderer transmission", () => {
    const grid = new BlockGrid({ x: 1, y: 1, z: 1 });
    expect(() =>
      blockLightLevels(grid, { registry, transmission: new Map() }),
    ).toThrow(/Missing light transmission/u);
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
    const light = blockLightLevels(grid, { registry });
    for (let offset = 0; offset < 5; offset += 1) {
      expect(light[grid.index(1 + offset, 1, 1)]).toBe(
        Math.max(0, level - offset),
      );
    }
  });
});
