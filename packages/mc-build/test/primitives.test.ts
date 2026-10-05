import path from "node:path";
import { describe, expect, test } from "vitest";
import { createBuildContext } from "#src/dsl/context.ts";
import { loadRegistry } from "#src/registry/registry.ts";
import { compileTwice } from "./compile-twice.ts";

const registry = await loadRegistry();

function freshContext() {
  const { ctx, canvas } = createBuildContext({ registry, seed: 3, site: null });
  const read = () => {
    const { grid, min } = canvas.compile();
    return (x: number, y: number, z: number) =>
      grid.get(x - min.x, y - min.y, z - min.z);
  };
  return { ctx, read };
}

describe("towers", () => {
  test("a round tower is a hollow ring with floors, slits and merlons", () => {
    const { ctx, read } = freshContext();
    const tower = ctx.craft.tower({
      x: 0,
      z: 0,
      y: 0,
      shape: "round",
      radius: 3,
      h: 8,
      wall: "stone_bricks",
      floor: "oak_planks",
      door: { dir: "front", block: "oak_door" },
    });
    const at = read();
    expect(tower.top).toBe(8);
    expect(at(3, 3, 0)).toBe("minecraft:stone_bricks");
    expect(at(0, 3, 0)).toBe("minecraft:air");
    expect(at(0, -1, 0)).toBe("minecraft:oak_planks");
    expect(at(0, 7, 0)).toBe("minecraft:oak_planks");
    expect(at(0, 0, 0)).toMatch(/^minecraft:lantern/u);
    expect(at(-3, 1, 0)).toMatch(/^minecraft:iron_bars/u);
    expect(at(0, 0, 3)).toMatch(/^minecraft:oak_door\[.*half=lower/u);
    expect(at(0, 1, 3)).toMatch(/half=upper/u);
    // Merlons alternate around the top ring.
    expect(at(3, 8, 0)).not.toBe(at(3, 8, 1));
  });

  test("a square tower without crenellations lights its roofed platform", () => {
    const { ctx, read } = freshContext();
    ctx.craft.tower({
      x: 0,
      z: 0,
      y: 0,
      shape: "square",
      radius: 2,
      h: 6,
      wall: "cobblestone",
      crenellations: false,
      slits: false,
    });
    const at = read();
    expect(at(2, 2, 2)).toBe("minecraft:cobblestone");
    expect(at(-2, 0, 1)).toBe("minecraft:cobblestone");
    expect(at(0, 6, 0)).toMatch(/^minecraft:lantern/u);
    expect(at(2, 6, 0)).toBe("minecraft:air");
  });
});

describe("roofs", () => {
  test("a conical roof steps in to a capped apex on upside-down stairs", () => {
    const { ctx, read } = freshContext();
    const cone = ctx.craft.conicalRoof({
      x: 0,
      z: 0,
      y: 10,
      radius: 2,
      stairs: "spruce_stairs",
      peak: "lightning_rod",
    });
    const at = read();
    expect(at(3, 10, 0)).toMatch(/spruce_stairs\[facing=west,half=bottom/u);
    expect(at(0, 10, -3)).toMatch(/facing=south/u);
    expect(at(2, 11, 0)).toMatch(/spruce_stairs\[facing=west,half=bottom/u);
    expect(at(2, 10, 0)).toMatch(/half=top/u);
    expect(at(0, 13, 0)).toMatch(/^minecraft:spruce_slab\[type=bottom/u);
    expect(at(0, 14, 0)).toMatch(/^minecraft:lightning_rod/u);
    expect(cone.top).toBe(15);
  });

  test("a mansard roof has steep two-high steps and a flat cap", () => {
    const { ctx, read } = freshContext();
    const roof = ctx.craft.mansardRoof({
      x: 0,
      z: 0,
      w: 9,
      d: 7,
      y: 5,
      wall: "deepslate_tiles",
      stairs: "deepslate_tile_stairs",
      steps: 2,
    });
    const at = read();
    expect(at(0, 5, 3)).toBe("minecraft:deepslate_tiles");
    expect(at(0, 6, 3)).toMatch(/deepslate_tile_stairs\[facing=east/u);
    expect(at(1, 7, 3)).toBe("minecraft:deepslate_tiles");
    expect(at(1, 6, 3)).toBe("minecraft:deepslate_tiles");
    expect(at(4, 8, 3)).toMatch(/^minecraft:deepslate_tile_slab/u);
    expect(roof.top).toBe(9);
  });

  test("a hip roof over a cleared interior still rests on its undersides", () => {
    const plain = freshContext();
    plain.ctx.craft.hipRoof({
      x: 0,
      z: 0,
      w: 9,
      d: 7,
      y: 4,
      stairs: "oak_stairs",
    });
    const cleared = freshContext();
    cleared.ctx.clear({ x: 0, y: 0, z: 0, w: 9, h: 10, d: 7 });
    cleared.ctx.craft.hipRoof({
      x: 0,
      z: 0,
      w: 9,
      d: 7,
      y: 4,
      stairs: "oak_stairs",
    });
    const plainAt = plain.read();
    const clearedAt = cleared.read();
    for (const [x, y] of [
      [0, 4],
      [1, 5],
      [2, 6],
    ] as const) {
      expect(plainAt(x, y, 3)).toMatch(/^minecraft:oak_stairs\[.*half=top/u);
      expect(clearedAt(x, y, 3)).toBe(plainAt(x, y, 3));
    }
  });

  test("a dormer carves the roof and frames a window", () => {
    const { ctx, read } = freshContext();
    ctx.craft.hipRoof({ x: 0, z: 0, w: 9, d: 7, y: 4, stairs: "oak_stairs" });
    ctx.craft.dormer({
      x: 3,
      z: 5,
      w: 3,
      d: 2,
      y: 4,
      facing: "front",
      wall: "white_terracotta",
      stairs: "oak_stairs",
    });
    const at = read();
    expect(at(4, 4, 6)).toMatch(/^minecraft:glass_pane/u);
    expect(at(3, 4, 6)).toBe("minecraft:white_terracotta");
    expect(at(4, 4, 5)).toBe("minecraft:air");
    expect(at(3, 6, 6)).toMatch(/^minecraft:oak_stairs/u);
  });
});

describe("details", () => {
  test("a porch has a deck, posts, a canopy and a railing with an opening", () => {
    const { ctx, read } = freshContext();
    const walls = ctx.craft.walls({
      x: 0,
      z: 0,
      w: 7,
      d: 5,
      y: 1,
      h: 4,
      frame: "spruce_log",
      infill: "oak_planks",
    });
    const porch = ctx.craft.porch({
      face: walls.faces.front,
      at: 1,
      w: 5,
      depth: 2,
      floor: "spruce_planks",
      post: "spruce_fence",
      roof: "spruce_stairs",
      railing: "spruce_fence",
    });
    const at = read();
    expect(at(1, 0, 6)).toBe("minecraft:spruce_planks");
    expect(at(1, 2, 6)).toMatch(/^minecraft:spruce_fence/u);
    expect(at(3, 4, 6)).toMatch(/spruce_stairs\[facing=north/u);
    expect(at(3, 4, 5)).toMatch(/spruce_slab\[type=top/u);
    expect(at(porch.entrance, 1, 6)).toBe("minecraft:air");
    expect(at(2, 1, 6)).toMatch(/^minecraft:spruce_fence/u);
  });

  test("interior places a two-part bed, shelves, a table with chairs and lights", () => {
    const { ctx, read } = freshContext();
    const placed = ctx.craft.interior({
      room: { x: 0, y: 1, z: 0, w: 7, h: 3, d: 5 },
    });
    const at = read();
    expect(at(0, 1, 0)).toMatch(/red_bed\[.*part=head/u);
    expect(at(0, 1, 1)).toMatch(/red_bed\[.*part=foot/u);
    expect(at(6, 2, 0)).toBe("minecraft:bookshelf");
    expect(at(3, 1, 2)).toMatch(/spruce_slab\[type=top/u);
    expect(at(2, 1, 2)).toMatch(/spruce_stairs\[facing=west/u);
    expect(placed.lights.length).toBeGreaterThan(0);
  });

  test("landscape needs ground without a site, and avoids footprints", () => {
    const { ctx, read } = freshContext();
    expect(() =>
      ctx.craft.landscape({ area: { x: 0, z: 0, w: 4, d: 4 }, y: 0 }),
    ).toThrow(/ground/u);
    const result = ctx.craft.landscape({
      area: { x: 0, z: 0, w: 20, d: 20 },
      y: 0,
      ground: "grass_block",
      density: 0.3,
      avoid: [{ x: 0, z: 0, w: 5, d: 20 }],
    });
    const at = read();
    expect(result.plants).toBeGreaterThan(0);
    for (let z = 0; z < 20; z += 1) {
      expect(at(2, 0, z)).toBe("minecraft:air");
      expect(at(2, -1, z)).toBe("minecraft:grass_block[snowy=false]");
    }
  });
});

describe("primitives fixture", () => {
  test("compiles deterministically and lints clean", async () => {
    const program = path.join(
      import.meta.dirname,
      "fixtures",
      "primitives.build.ts",
    );
    const { drift, findings } = await compileTwice(program, 5, registry);
    expect(drift).toBe(0);
    expect(findings).toEqual([]);
  });
});
