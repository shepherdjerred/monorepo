import { describe, expect, it } from "vitest";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import {
  builtExtent,
  changedGrid,
  deliveredChecks,
  pathRun,
  treeCount,
} from "#evals/grade/delivered.ts";

/** The captured site: flat grass. */
function captured(): BlockGrid {
  const grid = new BlockGrid({ x: 16, y: 8, z: 16 });
  for (let x = 0; x < 16; x += 1) {
    for (let z = 0; z < 16; z += 1) {
      grid.set(x, 0, z, "minecraft:grass_block[snowy=false]");
    }
  }
  return grid;
}

/** The captured site with a 6×4×6 plank hut, a door, a window, stairs on top and a lantern. */
function site(): BlockGrid {
  const grid = captured();
  for (let x = 4; x < 10; x += 1) {
    for (let z = 4; z < 10; z += 1) {
      for (let y = 1; y < 5; y += 1) {
        if (x === 4 || x === 9 || z === 4 || z === 9) {
          grid.set(x, y, z, "minecraft:oak_planks");
        }
      }
      grid.set(
        x,
        5,
        z,
        "minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]",
      );
    }
  }
  grid.set(
    6,
    1,
    9,
    "minecraft:oak_door[facing=south,half=lower,hinge=left,open=false,powered=false]",
  );
  grid.set(
    6,
    2,
    9,
    "minecraft:oak_door[facing=south,half=upper,hinge=left,open=false,powered=false]",
  );
  grid.set(
    8,
    2,
    9,
    "minecraft:glass_pane[east=false,north=false,south=false,waterlogged=false,west=false]",
  );
  grid.set(6, 3, 6, "minecraft:lantern[hanging=true,waterlogged=false]");
  return grid;
}

describe("delivered checks", () => {
  it("counts excavation extent and edits without crediting removed features", () => {
    const baseline = new BlockGrid({ x: 16, y: 8, z: 16 }, "minecraft:stone");
    baseline.set(1, 1, 1, "minecraft:lantern");
    const grid = new BlockGrid(baseline.size, "minecraft:stone");
    for (let x = 1; x <= 4; x += 1) {
      for (let y = 1; y <= 3; y += 1) {
        for (let z = 1; z <= 6; z += 1) grid.set(x, y, z, "minecraft:air");
      }
    }
    const built = builtExtent(grid, baseline);
    expect(built.blocks).toBe(72);
    expect(built.size).toEqual({ w: 4, d: 6, h: 3 });
    expect(built.counts.size).toBe(0);
    expect(
      deliveredChecks(
        grid,
        {
          minBlocks: 72,
          minHeight: 3,
          minFootprint: { w: 4, d: 6 },
          features: ["light"],
        },
        null,
        baseline,
      ).map((check) => check.pass),
    ).toEqual([true, true, true, false]);
    expect(builtExtent(baseline, baseline).blocks).toBe(0);
    expect(() => builtExtent(grid, captured())).not.toThrow();
    expect(() =>
      builtExtent(grid, new BlockGrid({ x: 1, y: 1, z: 1 })),
    ).toThrow(/differ in size/u);
  });

  it("rejects repeated excavations while ignoring untouched terrain", () => {
    const baseline = new BlockGrid({ x: 16, y: 8, z: 8 }, "minecraft:stone");
    const grid = new BlockGrid(baseline.size, "minecraft:stone");
    for (const ox of [0, 8])
      for (let x = 0; x < 4; x += 1)
        for (let y = 0; y < 4; y += 1)
          for (let z = 0; z < 4; z += 1)
            grid.set(ox + x, y, z, "minecraft:air");
    expect(
      deliveredChecks(grid, { maxRepeatRatio: 0.2 }, null, baseline)[0]?.pass,
    ).toBe(false);
    expect(
      deliveredChecks(baseline, { maxRepeatRatio: 0.2 }, null, baseline)[0]
        ?.pass,
    ).toBe(true);
  });
  it("measures what changed since capture, shaped terrain included", () => {
    const grid = site();
    // The agent terraced the slope: natural blocks, but placed by the build.
    for (let x = 0; x < 16; x += 1) {
      grid.set(x, 1, 0, "minecraft:stone");
      grid.set(x, 2, 0, "minecraft:stone");
    }
    const changed = changedGrid(grid, captured());
    expect(changed.isAirAt(0, 0, 0)).toBe(true);
    expect(changed.get(3, 1, 0)).toBe("minecraft:stone");
    const built = builtExtent(grid, captured());
    expect(built.size).toEqual({ w: 16, d: 10, h: 5 });
    // Without the site, natural blocks are excluded and the terrace is invisible.
    expect(builtExtent(grid).size).toEqual({ w: 6, d: 6, h: 5 });
    const checks = deliveredChecks(
      grid,
      { maxRepeatRatio: 0.2 },
      null,
      captured(),
    );
    expect(checks.map((check) => check.pass)).toEqual([true]);
    expect(() =>
      changedGrid(grid, new BlockGrid({ x: 4, y: 4, z: 4 })),
    ).toThrow(/differ in size/u);
  });

  it("measures the built extent without the ground", () => {
    const built = builtExtent(site());
    expect(built.size).toEqual({ w: 6, d: 6, h: 5 });
    expect(built.blocks).toBeGreaterThan(80);
  });

  it("passes a matching spec and fails an over-ambitious one", () => {
    const grid = site();
    const ok = deliveredChecks(
      grid,
      {
        minFootprint: { w: 5, d: 6 },
        minHeight: 4,
        features: ["door", "window", "roofStairs", "light"],
        maxLintWarnings: 2,
        maxRepeatRatio: 0.2,
      },
      1,
    );
    expect(ok.every((check) => check.pass)).toBe(true);
    expect(ok.map((check) => check.name)).toContain("has roofStairs");

    const big = deliveredChecks(
      grid,
      {
        minFootprint: { w: 40, d: 40 },
        features: ["water", "tree"],
        maxLintWarnings: 0,
      },
      1,
    );
    expect(big.map((check) => check.pass)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(big[0]?.detail).toBe("6×6");
  });
});

describe("landscaping evidence", () => {
  it("counts a path only as a walkable connected run, not foundation blocks", () => {
    const walkable = captured();
    for (let x = 2; x < 10; x += 1)
      walkable.set(x, 0, 2, "minecraft:dirt_path");
    expect(pathRun(walkable)).toBe(8);
    const foundation = captured();
    for (let x = 2; x < 10; x += 1) {
      foundation.set(x, 1, 2, "minecraft:cobblestone");
      foundation.set(x, 2, 2, "minecraft:oak_planks");
    }
    expect(pathRun(foundation)).toBe(0);
    const scattered = captured();
    for (const x of [1, 4, 7, 10, 13])
      scattered.set(x, 1, 5, "minecraft:gravel");
    expect(pathRun(scattered)).toBe(1);
    const checks = deliveredChecks(foundation, { features: ["path"] }, null);
    expect(checks[0]?.pass).toBe(false);
    expect(checks[0]?.detail).toContain("walkable");
  });

  it("counts a tree only as a trunk with a canopy, not timber posts", () => {
    const grove = captured();
    for (let y = 1; y <= 4; y += 1)
      grove.set(8, y, 8, "minecraft:oak_log[axis=y]");
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        if (dx !== 0 || dz !== 0) {
          grove.set(
            8 + dx,
            5,
            8 + dz,
            "minecraft:oak_leaves[distance=1,persistent=false,waterlogged=false]",
          );
        }
      }
    }
    expect(treeCount(grove)).toBe(1);
    const frame = captured();
    for (const [x, z] of [
      [2, 2],
      [2, 12],
      [12, 2],
      [12, 12],
      [7, 2],
    ] as const) {
      for (let y = 1; y <= 4; y += 1)
        frame.set(x, y, z, "minecraft:oak_log[axis=y]");
    }
    expect(treeCount(frame)).toBe(0);
    expect(deliveredChecks(frame, { features: ["tree"] }, null)[0]?.pass).toBe(
      false,
    );
  });
});
