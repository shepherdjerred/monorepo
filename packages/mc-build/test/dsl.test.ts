import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { compileProgram, scanProgram } from "#src/compile/runner.ts";
import { mergeBoxes } from "#src/dsl/canvas.ts";
import { createBuildContext } from "#src/dsl/context.ts";
import { loadRegistry } from "#src/registry/registry.ts";

const house = path.join(import.meta.dirname, "fixtures", "house.build.ts");
const temp = await mkdtemp(path.join(os.tmpdir(), "mc-build-dsl-"));
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

describe("materials", () => {
  test("validates blocks against the registry with suggestions", async () => {
    const { ctx } = createBuildContext({
      registry: await loadRegistry(),
      seed: 1,
      site: null,
    });
    expect(ctx.mat.block("oak_stairs", { facing: "east" })).toBe(
      "minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]",
    );
    expect(() => ctx.mat.block("oak_stair")).toThrow(
      /did you mean minecraft:oak_stairs/u,
    );
    expect(() => ctx.mat.block("oak_stairs", { facing: "up" })).toThrow(
      /facing is one of/u,
    );
  });

  test("resolves wood and stone families", async () => {
    const { ctx } = createBuildContext({
      registry: await loadRegistry(),
      seed: 1,
      site: null,
    });
    const spruce = ctx.mat.family("spruce");
    expect(spruce.kind === "wood" && spruce.door).toMatch(
      /^minecraft:spruce_door\[/u,
    );
    const bricks = ctx.mat.family("stone_bricks");
    expect(bricks.kind === "stone" && bricks.stairs).toMatch(
      /^minecraft:stone_brick_stairs\[/u,
    );
    expect(bricks.kind === "stone" && bricks.wall).toMatch(
      /^minecraft:stone_brick_wall\[/u,
    );
  });

  test("stairs ascend toward a build direction", async () => {
    const { ctx } = createBuildContext({
      registry: await loadRegistry(),
      seed: 1,
      site: null,
    });
    expect(ctx.mat.stairs("oak_stairs", { ascend: "back" })).toContain(
      "facing=north",
    );
    expect(
      ctx.mat.stairs("oak_stairs", { ascend: "front", half: "top" }),
    ).toContain("half=top");
  });

  test("palettes are deterministic per cell and seed", async () => {
    const { ctx } = createBuildContext({
      registry: await loadRegistry(),
      seed: 7,
      site: null,
    });
    const mix = ctx.mat.palette([
      ["stone", 1],
      ["andesite", 1],
    ]);
    expect(typeof mix === "function" && mix(1, 2, 3)).toBe(
      typeof mix === "function" && mix(1, 2, 3),
    );
    const seen = new Set<string>();
    for (let x = 0; x < 50; x += 1) {
      seen.add(typeof mix === "function" ? mix(x, 0, 0) : mix);
    }
    expect(seen.size).toBe(2);
  });
});

describe("canvas", () => {
  test("merges explicit air into boxes", () => {
    const cells = new Set(["0,0,0", "1,0,0", "0,0,1", "1,0,1", "5,5,5"]);
    expect(mergeBoxes(cells, { x: 10, y: 0, z: 0 })).toEqual([
      { x: 10, y: 0, z: 0, w: 2, h: 1, d: 2 },
      { x: 15, y: 5, z: 5, w: 1, h: 1, d: 1 },
    ]);
  });
});

describe("compile", () => {
  test("rejects runtime imports and ambient escapes", () => {
    expect(() => {
      scanProgram('import fs from "node:fs"; export default () => {};');
    }).toThrow(/import type/u);
    expect(() => {
      scanProgram("export default () => { Math.random(); };");
    }).toThrow(/Math\.random/u);
    expect(() => {
      scanProgram("// Date in a comment is fine\nexport default () => {};");
    }).not.toThrow();
  });

  test("compiles the sample cottage deterministically", async () => {
    const options = {
      program: house,
      seed: 42,
      anchor: { x: 0, y: 0, z: 0 },
      site: null,
    };
    const first = await compileProgram(options);
    const second = await compileProgram(options);
    expect(first.grid.diff(second.grid).count).toBe(0);
    // Overhang puts the roof one block outside the 9×7 footprint on every side.
    expect(first.min).toEqual({ x: -1, y: 0, z: -1 });
    expect(first.grid.size).toEqual({ x: 11, y: 10, z: 9 });
    const states = first.grid.histogram().map((entry) => entry.state);
    expect(
      states.some((state) => state.startsWith("minecraft:spruce_door[")),
    ).toBe(true);
    expect(
      states.some((state) => state.includes("dark_oak_stairs[facing=north")),
    ).toBe(true);
    expect(
      states.some((state) => state.includes("dark_oak_stairs[facing=south")),
    ).toBe(true);
    // Recessed windows clear the outer plane explicitly.
    expect(first.clears.length).toBeGreaterThan(0);
  });

  test("reports program errors and timeouts", async () => {
    const broken = path.join(temp, "broken.build.ts");
    await Bun.write(
      broken,
      'export default ((ctx) => { ctx.set(0, 0, 0, "minecraft:not_a_block"); });',
    );
    await expect(
      compileProgram({
        program: broken,
        seed: 1,
        anchor: { x: 0, y: 0, z: 0 },
        site: null,
      }),
    ).rejects.toThrow(/Unknown block minecraft:not_a_block/u);
    const slow = path.join(temp, "slow.build.ts");
    await Bun.write(slow, "export default (() => { for (;;) {} });");
    await expect(
      compileProgram({
        program: slow,
        seed: 1,
        anchor: { x: 0, y: 0, z: 0 },
        site: null,
        timeoutMs: 1500,
      }),
    ).rejects.toThrow(/timed out/u);
  });
});
