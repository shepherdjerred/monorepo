import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";
import { box, ground, boundary, hall, stairX, objective } from "./lib/arena.ts";

export default ((ctx) => {
  const w = 128,
    d = 128;
  ground(ctx, w, d, "moss_block", "stone");
  boundary(ctx, w, d, "stone_bricks");
  // Two offset raised courts connected by an exposed garden; every terrace has two stairs.
  for (const [x, z, sw, sd] of [
    [26, 21, 32, 31],
    [70, 76, 32, 31],
  ] as const) {
    box(ctx, x, 9, z, sw, 4, sd, "stone_bricks");
    box(ctx, x + 1, 12, z + 1, sw - 2, 1, sd - 2, "gravel");
    hall(
      ctx,
      x + 5,
      z + 4,
      21,
      15,
      "white_terracotta",
      "deepslate_tile_stairs",
      13,
      6,
    );
    stairX(ctx, x - 4, z + 22, 9, 4, 5, true);
    stairX(ctx, x + sw + 3, z + 22, 9, 4, 5, false);
  }
  hall(ctx, 51, 51, 25, 25, "bamboo_planks", "dark_oak_slab", 9, 9);
  for (let tier = 1; tier <= 4; tier++)
    box(
      ctx,
      49 + tier * 2,
      18 + tier,
      49 + tier * 2,
      29 - tier * 4,
      1,
      29 - tier * 4,
      "deepslate_tiles",
    );
  // Raised roofs have independent flanking stairs, avoiding an uncontestable sniper perch.
  stairX(ctx, 42, 56, 9, 10, 4, true, "dark_oak_stairs");
  stairX(ctx, 84, 66, 9, 10, 4, false, "dark_oak_stairs");
  for (const z of [42, 85]) {
    box(ctx, 59, 9, z, 2, 9, 2, "red_terracotta");
    box(ctx, 68, 9, z, 2, 9, 2, "red_terracotta");
    box(ctx, 56, 17, z - 1, 17, 2, 4, "dark_oak_planks");
  }
  // Bamboo groves stay off movement routes and supply broken visual screens.
  for (const [cx, cz] of [
    [16, 22],
    [109, 24],
    [19, 105],
    [110, 105],
    [38, 94],
    [91, 31],
  ] as const) {
    for (let i = 0; i < 12; i++) {
      const x = cx + Math.floor(ctx.rng() * 7),
        z = cz + Math.floor(ctx.rng() * 7);
      box(
        ctx,
        x,
        9,
        z,
        1,
        5 + Math.floor(ctx.rng() * 6),
        1,
        "bamboo[leaves=large]",
      );
    }
    ctx.craft.tree({
      x: cx + 3,
      y: 9,
      z: cz + 4,
      species: "cherry",
      size: "small",
      seed: cx,
    });
  }
  // Replace the isolated procedural canopy chip with a supported branch cluster.
  box(ctx, 95, 13, 33, 2, 2, 1, "cherry_leaves[persistent=true]");
  box(ctx, 94, 12, 33, 2, 1, 1, "cherry_leaves[persistent=true]");
  for (const [x, z, length] of [
    [23, 67, 20],
    [84, 48, 21],
    [30, 110, 28],
    [72, 16, 20],
  ] as const) {
    box(ctx, x, 9, z, length, 2, 2, "azalea_leaves[persistent=true]");
    box(ctx, x, 8, z - 5, length, 1, 4, "gravel");
  }
  for (const [x, z] of [
    [36, 61],
    [88, 55],
    [49, 105],
    [77, 20],
  ] as const) {
    box(ctx, x, 9, z, 5, 2, 3, "mossy_stone_bricks");
    box(ctx, x, 11, z, 5, 1, 1, "mossy_stone_brick_slab");
  }
  objective(ctx, w, d);
}) satisfies BuildProgram;
