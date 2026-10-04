import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  formatBlockState,
  isAir,
  normalizeBlockState,
  parseBlockState,
  withProperties,
} from "#src/core/block-state.ts";
import { BlockGrid, gridFromRegionRead } from "#src/core/grid.ts";
import { RegionReadSchema } from "#src/core/region-read.ts";
import { readSchematic, writeSchematic } from "#src/core/schem.ts";

const fixtures = path.join(import.meta.dirname, "fixtures");

describe("block states", () => {
  test("parses, namespaces and sorts properties", () => {
    expect(parseBlockState("oak_stairs[half=top,facing=east]")).toEqual({
      id: "minecraft:oak_stairs",
      properties: { half: "top", facing: "east" },
    });
    expect(normalizeBlockState("oak_stairs[half=top,facing=east]")).toBe(
      "minecraft:oak_stairs[facing=east,half=top]",
    );
    expect(formatBlockState({ id: "minecraft:stone", properties: {} })).toBe(
      "minecraft:stone",
    );
  });

  test("rejects malformed states", () => {
    expect(() => parseBlockState("Stone")).toThrow(/Invalid block state/u);
    expect(() => parseBlockState("stone[facing]")).toThrow(/Invalid property/u);
    expect(() => parseBlockState("stone[a=1,a=2]")).toThrow(/Duplicate/u);
  });

  test("merges properties and detects air", () => {
    expect(withProperties("oak_log[axis=y]", { axis: "x" })).toBe(
      "minecraft:oak_log[axis=x]",
    );
    expect(isAir("cave_air")).toBe(true);
    expect(isAir("minecraft:glass")).toBe(false);
  });
});

describe("BlockGrid", () => {
  test("indexes YZX and round-trips states", () => {
    const grid = new BlockGrid({ x: 3, y: 2, z: 2 });
    grid.set(2, 1, 1, "stone");
    expect(grid.index(2, 1, 1)).toBe(11);
    expect(grid.get(2, 1, 1)).toBe("minecraft:stone");
    expect(grid.get(9, 9, 9)).toBe("minecraft:air");
    expect(() => {
      grid.set(3, 0, 0, "stone");
    }).toThrow(/outside/u);
    expect(grid.histogram()).toEqual([
      { state: "minecraft:air", count: 11 },
      { state: "minecraft:stone", count: 1 },
    ]);
  });

  test("diffs grids of equal size", () => {
    const a = new BlockGrid({ x: 2, y: 1, z: 1 });
    const b = new BlockGrid({ x: 2, y: 1, z: 1 });
    b.set(1, 0, 0, "dirt");
    expect(a.diff(b)).toEqual({
      count: 1,
      mismatches: [
        {
          at: { x: 1, y: 0, z: 0 },
          expected: "minecraft:air",
          actual: "minecraft:dirt",
        },
      ],
    });
  });

  test("decodes a bridge region read", async () => {
    const region = RegionReadSchema.parse(
      await Bun.file(path.join(fixtures, "bridge-region.json")).json(),
    );
    const grid = gridFromRegionRead(region);
    expect(grid.size).toEqual({ x: 3, y: 2, z: 2 });
    expect(grid.get(0, 1, 0)).toBe(
      "minecraft:oak_stairs[facing=east,half=top,shape=straight,waterlogged=false]",
    );
    expect(grid.get(1, 1, 0)).toBe(
      "minecraft:chest[facing=south,type=single,waterlogged=false]",
    );
    expect(grid.blockEntities).toEqual([
      { id: "minecraft:chest", pos: { x: 1, y: 1, z: 0 } },
    ]);
  });
});

describe("Sponge v3 schematics", () => {
  test("reads a schematic written by the bridge (WorldEdit)", async () => {
    const bytes = new Uint8Array(
      await Bun.file(
        path.join(fixtures, "bridge-snapshot.schem"),
      ).arrayBuffer(),
    );
    const schematic = await readSchematic(bytes);
    expect(schematic.dataVersion).toBe(4903);
    expect(schematic.offset).toEqual({ x: 0, y: 0, z: 0 });
    const region = RegionReadSchema.parse(
      await Bun.file(path.join(fixtures, "bridge-region.json")).json(),
    );
    expect(schematic.grid.diff(gridFromRegionRead(region)).count).toBe(0);
    expect(schematic.grid.blockEntities).toEqual([
      { id: "minecraft:chest", pos: { x: 1, y: 1, z: 0 } },
    ]);
  });

  test("round-trips a grid with a palette larger than one varint byte", async () => {
    const grid = new BlockGrid({ x: 20, y: 2, z: 10 });
    let n = 0;
    grid.forEach((x, y, z) => {
      grid.set(x, y, z, `minecraft:stone[n=${(n % 200).toString()}]`);
      n += 1;
    });
    const read = await readSchematic(writeSchematic(grid, 4903));
    expect(read.grid.palette.length).toBe(200);
    expect(read.grid.diff(grid).count).toBe(0);
    expect(read.dataVersion).toBe(4903);
  });
});
