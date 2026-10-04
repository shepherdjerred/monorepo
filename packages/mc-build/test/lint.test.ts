import path from "node:path";
import { describe, expect, test } from "vitest";
import { compileProgram } from "#src/compile/runner.ts";
import { BlockGrid } from "#src/core/grid.ts";
import { lintGrid } from "#src/lint/lint.ts";
import { GRAVITY_IDS } from "#src/lint/physics.ts";
import { loadRegistry } from "#src/registry/registry.ts";

const registry = await loadRegistry();
const codes = (grid: BlockGrid) =>
  lintGrid(grid, { registry }).findings.map((finding) => finding.code);

function slab(size: { x: number; z: number }, state: string, y = 0): BlockGrid {
  const grid = new BlockGrid({ x: size.x, y: 6, z: size.z });
  for (let x = 0; x < size.x; x += 1) {
    for (let z = 0; z < size.z; z += 1) {
      grid.set(x, y, z, state);
    }
  }
  return grid;
}

describe("lint", () => {
  test("physics table names exist in the registry", () => {
    for (const id of GRAVITY_IDS) {
      expect(registry.has(id), id).toBe(true);
    }
  });

  test("flags unknown blocks and bad states", () => {
    const grid = slab({ x: 2, z: 2 }, "stone");
    grid.set(0, 1, 0, "minecraft:stoen");
    grid.set(1, 1, 0, "minecraft:oak_stairs[facing=up]");
    const report = lintGrid(grid, { registry });
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["E_UNKNOWN_BLOCK", "E_BAD_STATE"]),
    );
    expect(report.ok).toBe(false);
    expect(
      report.findings.find((finding) => finding.code === "E_UNKNOWN_BLOCK")
        ?.hint,
    ).toContain("minecraft:stone");
  });

  test("flags floating parts, falling sand and unsupported torches", () => {
    const grid = slab({ x: 3, z: 3 }, "stone");
    grid.set(1, 4, 1, "oak_planks");
    // Sand on a pillar's side overhang: connected, but nothing directly below.
    grid.set(0, 1, 0, "stone");
    grid.set(0, 2, 0, "stone");
    grid.set(1, 2, 0, "sand");
    grid.set(2, 3, 2, "torch");
    expect(codes(grid)).toEqual(
      expect.arrayContaining(["E_FLOATING", "E_GRAVITY", "E_ATTACHMENT"]),
    );
  });

  test("accepts a wall torch on a wall and flags one in mid-air", () => {
    const grid = slab({ x: 3, z: 3 }, "stone");
    grid.set(1, 1, 1, "stone");
    grid.set(1, 1, 2, "wall_torch[facing=south]");
    expect(codes(grid)).not.toContain("E_ATTACHMENT");
    grid.set(1, 1, 1, "air");
    expect(codes(grid)).toContain("E_ATTACHMENT");
  });

  test("flags decaying leaves but not persistent ones", () => {
    const grid = slab({ x: 3, z: 3 }, "stone");
    grid.set(1, 1, 1, "oak_leaves[persistent=false]");
    expect(codes(grid)).toContain("E_LEAVES_DECAY");
    grid.set(1, 1, 1, "oak_leaves[persistent=true]");
    expect(codes(grid)).not.toContain("E_LEAVES_DECAY");
  });

  test("warns about flat, monotone walls and dark interiors", () => {
    const grid = new BlockGrid({ x: 8, y: 6, z: 8 });
    grid.forEach((x, y, z) => {
      const shell =
        x === 0 || x === 7 || z === 0 || z === 7 || y === 0 || y === 5;
      if (shell) {
        grid.set(x, y, z, "cobblestone");
      }
    });
    const found = codes(grid);
    expect(found).toEqual(
      expect.arrayContaining([
        "W_FLAT_FACADE",
        "W_MONOTONE",
        "W_DARK_INTERIOR",
      ]),
    );
    grid.set(3, 1, 3, "lantern");
    expect(codes(grid)).not.toContain("W_DARK_INTERIOR");
  });

  test("the sample cottage is clean", async () => {
    const compiled = await compileProgram({
      program: path.join(import.meta.dirname, "fixtures", "house.build.ts"),
      seed: 42,
      anchor: { x: 0, y: 0, z: 0 },
      site: null,
    });
    const report = lintGrid(compiled.grid, { registry });
    expect(report.findings).toEqual([]);
  });

  test("the hip-roof house has no errors", async () => {
    const compiled = await compileProgram({
      program: path.join(import.meta.dirname, "fixtures", "hip-house.build.ts"),
      seed: 42,
      anchor: { x: 0, y: 0, z: 0 },
      site: null,
    });
    const report = lintGrid(compiled.grid, { registry });
    expect(report.findings.map((finding) => finding.code)).toEqual([]);
  });
});
