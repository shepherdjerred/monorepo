import type {
  BuildContext,
  BuildProgram,
} from "@shepherdjerred/mc-build/dsl/context.ts";
import { box, ground, boundary, stairX, objective } from "./lib/arena.ts";
import { deployment } from "./lib/deployment.ts";

function vault(
  ctx: BuildContext,
  x: number,
  z: number,
  ...shape: [w: number, d: number, height: number]
) {
  const [w, d, height] = shape;
  box(ctx, x, 9, z, w, height, d, "deepslate_bricks");
  ctx.clear({ x: x + 2, y: 9, z: z + 2, w: w - 4, h: height, d: d - 4 });
  ctx.clear({ x, y: 9, z: z + Math.floor(d / 2) - 2, w, h: 5, d: 5 });
  ctx.clear({ x: x + Math.floor(w / 2) - 2, y: 9, z, w: 5, h: 5, d });
  // Broken barrel vaults leave generous skylights and readable underground routes.
  for (let dx = 2; dx < w - 2; dx += 7) {
    box(ctx, x + dx, 9, z + 1, 1, height, 2, "polished_basalt");
    box(ctx, x + dx, 9, z + d - 3, 1, height, 2, "polished_basalt");
    box(ctx, x + dx, 9 + height, z + 2, 1, 1, d - 4, "deepslate_tiles");
    for (const dz of [3, d - 4]) {
      box(ctx, x + dx, 9, z + dz, 1, 2, 1, "chiseled_stone_bricks");
      ctx.set(x + dx, 11, z + dz, "soul_lantern");
    }
  }
  for (let dx = 4; dx < w - 3; dx += 8) {
    for (const dz of [1, d - 2]) {
      box(ctx, x + dx, 10, z + dz, 3, 3, 1, "chiseled_stone_bricks");
      ctx.set(x + dx + 1, 11, z + dz, "bone_block[axis=z]");
    }
  }
}

export default ((ctx) => {
  const w = 112,
    d = 112;
  ground(ctx, w, d, "cracked_stone_bricks", "deepslate");
  boundary(ctx, w, d, "deepslate_tiles");
  // Three staggered burial galleries connect across the excavated cloister.
  vault(ctx, 29, 16, 54, 19, 8);
  vault(ctx, 35, 43, 42, 27, 12);
  vault(ctx, 24, 78, 64, 19, 7);
  for (const [x, z] of [
    [27, 37],
    [79, 64],
    [20, 68],
    [88, 34],
  ] as const) {
    box(ctx, x, 9, z, 5, 3, 8, "mossy_stone_bricks");
    box(ctx, x + 1, 12, z + 1, 3, 1, 6, "stone_brick_slab");
  }
  // Raised transepts have two stairs, parapets and a central walkable crossing.
  for (const x of [31, 75]) {
    box(ctx, x, 9, 35, 6, 6, 43, "deepslate_bricks");
    ctx.clear({ x, y: 9, z: 53, w: 6, h: 4, d: 7 });
    box(ctx, x, 15, 35, 1, 1, 43, "deepslate_tile_wall");
    box(ctx, x + 5, 15, 35, 1, 1, 43, "deepslate_tile_wall");
    stairX(ctx, x - 6, 39, 9, 6, 4, true, "deepslate_brick_stairs");
    stairX(ctx, x + 11, 70, 9, 6, 4, false, "deepslate_brick_stairs");
  }
  box(ctx, 47, 9, 51, 18, 2, 12, "polished_blackstone");
  for (const x of [47, 62]) {
    box(ctx, x, 11, 51, 3, 14, 3, "chiseled_deepslate");
    box(ctx, x, 11, 60, 3, 11, 3, "chiseled_deepslate");
    ctx.set(x + 1, 25, 52, "soul_lantern");
  }
  // A surviving sepulchral spire rises above the opened vaults.
  box(ctx, 53, 11, 54, 6, 17, 6, "chiseled_deepslate");
  box(ctx, 52, 28, 53, 8, 2, 8, "polished_blackstone");
  box(ctx, 54, 30, 55, 4, 4, 4, "bone_block[axis=y]");
  box(ctx, 55, 34, 56, 2, 3, 2, "polished_blackstone");
  // Moss follows the exposed excavation edges rather than random floor confetti.
  for (const [x, z, width] of [
    [10, 18, 15],
    [86, 76, 14],
    [42, 102, 22],
    [48, 7, 18],
  ] as const) {
    box(ctx, x, 8, z, width, 1, 4, "moss_block");
    for (let dx = 1; dx < width; dx += 4) ctx.set(x + dx, 9, z + 1, "azalea");
  }
  for (const [x, z] of [
    [18, 40],
    [86, 40],
    [18, 70],
    [86, 70],
    [50, 38],
    [60, 73],
  ] as const) {
    box(ctx, x, 9, z, 3, 2, 5, "bone_block[axis=x]");
    ctx.set(x + 1, 11, z + 2, "soul_lantern");
  }
  objective(ctx, w, d);
  deployment(ctx, w, d, "deepslate_tiles");
}) satisfies BuildProgram;
