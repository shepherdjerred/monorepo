import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { compileProgram } from "#src/compile/runner.ts";
import { scanProgram } from "#src/compile/scan.ts";
import { mergeBoxes, stairShape } from "#src/dsl/canvas.ts";
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

describe("themes and roofs", () => {
  const themes = ["medieval", "nordic", "desert"] as const;

  test.each(themes)(
    "%s resolves every key and builds both roof types",
    async (name) => {
      const registry = await loadRegistry();
      for (const roof of ["gableRoof", "hipRoof"] as const) {
        const { ctx, canvas } = createBuildContext({
          registry,
          seed: 3,
          site: null,
        });
        const theme = ctx.mat.theme(name);
        for (const value of Object.values(theme)) {
          const state = typeof value === "string" ? value : value(1, 2, 3);
          expect(registry.resolve(state)).toBe(state);
        }
        const fp = { x: 0, z: 0, w: 7, d: 5 };
        const base = ctx.craft.foundation({
          ...fp,
          y: 0,
          material: theme.foundation,
        });
        const walls = ctx.craft.walls({
          ...fp,
          y: base.top,
          h: 3,
          frame: theme.frame,
          infill: theme.infill,
        });
        ctx.craft.window(walls.faces.front, { at: 2, w: 2, sill: theme.roof });
        if (roof === "gableRoof") {
          ctx.craft.gableRoof({
            ...fp,
            y: walls.top,
            ridge: "x",
            stairs: theme.roof,
            gable: theme.trim,
          });
        } else {
          ctx.craft.hipRoof({ ...fp, y: walls.top, stairs: theme.roof });
        }
        expect(() => canvas.compile()).not.toThrow();
      }
    },
  );

  test("hip roofs turn their corners and cap an odd ridge", async () => {
    const { ctx, canvas } = createBuildContext({
      registry: await loadRegistry(),
      seed: 1,
      site: null,
    });
    ctx.craft.hipRoof({
      x: 0,
      z: 0,
      w: 3,
      d: 3,
      y: 0,
      stairs: "oak_stairs",
      overhang: 0,
    });
    const { grid, min } = canvas.compile();
    const at = (x: number, y: number, z: number) =>
      grid.get(x - min.x, y - min.y, z - min.z);
    expect(at(0, 0, 2)).toContain("facing=north");
    expect(at(0, 0, 2)).toContain("shape=outer_right");
    expect(at(2, 0, 2)).toContain("shape=outer_left");
    expect(at(0, 0, 0)).toContain("facing=south");
    expect(at(0, 0, 0)).toContain("shape=outer_left");
    expect(at(2, 0, 0)).toContain("shape=outer_right");
    expect(at(0, 0, 1)).toContain("facing=east");
    expect(at(0, 0, 1)).toContain("shape=straight");
    expect(at(1, 1, 1)).toMatch(/^minecraft:oak_slab\[/u);
    // The apex rests on an upside-down stair, so lint sees one structure.
    expect(at(1, 0, 1)).toContain("half=top");
  });

  test("stair shapes follow vanilla's corner rules", () => {
    const north = { facing: "north", half: "bottom" } as const;
    expect(stairShape(north, () => null)).toBe("straight");
    expect(
      stairShape(north, (side) =>
        side === "south" ? { facing: "east", half: "bottom" } : null,
      ),
    ).toBe("inner_right");
    expect(
      stairShape(north, (side) =>
        side === "south" ? { facing: "west", half: "bottom" } : null,
      ),
    ).toBe("inner_left");
    // A neighbour of the other half never bends a stair.
    expect(
      stairShape(north, (side) =>
        side === "north" ? { facing: "east", half: "top" } : null,
      ),
    ).toBe("straight");
  });

  test("chimneys stack masonry and take a cap", async () => {
    const { ctx, canvas } = createBuildContext({
      registry: await loadRegistry(),
      seed: 1,
      site: null,
    });
    const chimney = ctx.craft.chimney({
      x: 0,
      z: 0,
      base: 0,
      height: 4,
      material: "bricks",
      size: 2,
      cap: "campfire",
    });
    expect(chimney.top).toBe(4);
    const { grid } = canvas.compile();
    expect(grid.size).toEqual({ x: 2, y: 5, z: 2 });
    expect(grid.get(1, 3, 1)).toBe("minecraft:bricks");
    expect(grid.get(0, 4, 0)).toMatch(/^minecraft:campfire\[/u);
  });

  test("compiles the two-story hip-roof house deterministically", async () => {
    const options = {
      program: path.join(import.meta.dirname, "fixtures", "hip-house.build.ts"),
      seed: 42,
      anchor: { x: 0, y: 0, z: 0 },
      site: null,
    };
    const first = await compileProgram(options);
    const second = await compileProgram(options);
    expect(first.grid.diff(second.grid).count).toBe(0);
    const corners = first.grid
      .histogram()
      .filter((entry) =>
        /deepslate_tile_stairs\[.*shape=outer/u.test(entry.state),
      )
      .reduce((sum, entry) => sum + entry.count, 0);
    expect({ size: first.grid.size, corners }).toMatchInlineSnapshot(`
      {
        "corners": 20,
        "size": {
          "x": 13,
          "y": 14,
          "z": 11,
        },
      }
    `);
  });
});
