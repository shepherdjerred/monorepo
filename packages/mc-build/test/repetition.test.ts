import { describe, expect, test } from "vitest";
import { BlockGrid } from "#src/core/grid.ts";
import { repetitionRatio } from "#src/lint/repetition.ts";

/** The block of a 7×6×7 hut at local (x, y, z): stone floor, plank walls, cobble corners, a door gap. */
function hutBlock(x: number, y: number, z: number): string | null {
  if (y === 0) return "minecraft:stone";
  const onX = x === 0 || x === 6;
  const onZ = z === 0 || z === 6;
  if (!onX && !onZ) return null;
  if (x === 3 && z === 6 && y < 3) return null; // door
  return onX && onZ ? "minecraft:cobblestone" : "minecraft:oak_planks";
}

function hut(grid: BlockGrid, ox: number, oz: number): void {
  for (let x = 0; x < 7; x += 1) {
    for (let y = 0; y < 6; y += 1) {
      for (let z = 0; z < 7; z += 1) {
        const state = hutBlock(x, y, z);
        if (state !== null) grid.set(ox + x, y, oz + z, state);
      }
    }
  }
}

describe("repetitionRatio", () => {
  test("baseline repetition hashes removals and distinguishes replacement", () => {
    const baseline = new BlockGrid({ x: 24, y: 8, z: 8 }, "minecraft:stone");
    const grid = new BlockGrid(baseline.size, "minecraft:stone");
    for (const ox of [0, 8, 16])
      for (let x = 0; x < 4; x += 1)
        for (let y = 0; y < 4; y += 1)
          for (let z = 0; z < 4; z += 1)
            grid.set(
              ox + x,
              y,
              z,
              ox === 16 ? "minecraft:dirt" : "minecraft:air",
            );
    // The two excavations match; solid bulk replacement retains the default exclusion.
    expect(repetitionRatio(grid, { baseline })).toEqual({
      hashed: 2,
      repeated: 2,
      ratio: 1,
      groups: 1,
    });
    expect(repetitionRatio(baseline, { baseline }).hashed).toBe(0);
    expect(() =>
      repetitionRatio(grid, { baseline: new BlockGrid({ x: 1, y: 1, z: 1 }) }),
    ).toThrow(/differ in size/u);
    grid.set(8, 0, 0, "minecraft:stone");
    expect(repetitionRatio(grid, { baseline }).ratio).toBe(0);
  });
  test("a single hut is not repetition", () => {
    const grid = new BlockGrid({ x: 8, y: 8, z: 8 });
    hut(grid, 0, 0);
    const report = repetitionRatio(grid);
    expect(report.hashed).toBe(1);
    expect(report.repeated).toBe(0);
    expect(report.ratio).toBe(0);
  });

  test("the same hut pasted four times is mostly repetition", () => {
    const grid = new BlockGrid({ x: 16, y: 8, z: 16 });
    for (const [x, z] of [
      [0, 0],
      [8, 0],
      [0, 8],
      [8, 8],
    ] as const) {
      hut(grid, x, z);
    }
    const report = repetitionRatio(grid);
    expect(report.hashed).toBe(4);
    expect(report.groups).toBe(1);
    expect(report.ratio).toBe(1);
  });

  test("solid bulk of one block does not count", () => {
    const grid = new BlockGrid({ x: 16, y: 8, z: 16 }, "minecraft:stone");
    expect(repetitionRatio(grid).hashed).toBe(0);
  });
});
