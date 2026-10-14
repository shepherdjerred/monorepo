import type {
  BuildContext,
  BuildProgram,
} from "@shepherdjerred/mc-build/dsl/context.ts";
import { box, ground, boundary, hall, stairX, objective } from "./lib/arena.ts";
import { deployment } from "./lib/deployment.ts";

function gardens(ctx: BuildContext) {
  for (const [x, z, h] of [
    [19, 22, 10],
    [108, 99, 12],
    [108, 27, 9],
    [22, 111, 8],
    [63, 99, 8],
    [63, 25, 9],
  ] as const)
    ctx.craft.tree({ x, y: 9, z, species: "oak", height: h, seed: x + z });
  // Thin the four detached outer leaf tips produced by these deterministic trees.
  for (const [x, y, z] of [
    [108, 16, 98],
    [20, 17, 20],
    [108, 17, 97],
    [108, 23, 101],
  ] as const)
    ctx.set(x, y, z, "air");
  for (const [x, z] of [
    [32, 23],
    [44, 37],
    [81, 86],
    [94, 101],
  ] as const) {
    const y = x < 60 ? 12 : 13;
    box(ctx, x, y, z, 8, 1, 5, "bricks");
    box(ctx, x + 1, y + 1, z + 1, 6, 1, 3, "azalea_leaves[persistent=true]");
    ctx.set(x + 3, y + 1, z + 2, "flowering_azalea_leaves[persistent=true]");
    ctx.set(x, y + 1, z, "lantern");
  }
  for (const [x, y, z] of [
    [19, 17, 22],
    [64, 17, 97],
    [108, 18, 24],
    [63, 18, 97],
    [64, 18, 102],
    [24, 18, 109],
    [25, 18, 112],
    [61, 19, 27],
    [105, 22, 100],
    [106, 22, 101],
  ] as const)
    ctx.set(x, y, z, "glowstone");
}

export default ((ctx) => {
  const w = 128,
    d = 128;
  ground(ctx, w, d, "grass_block", "stone");
  boundary(ctx, w, d, "mossy_stone_bricks");
  // Three staggered garden terraces surround a ruined signal building.
  for (const [x, z, width, depth, rise] of [
    [29, 18, 29, 30, 3],
    [76, 81, 27, 28, 4],
    [50, 49, 31, 30, 6],
  ] as const) {
    box(ctx, x, 9, z, width, rise, depth, "mossy_stone_bricks");
    box(ctx, x + 1, 8 + rise, z + 1, width - 2, 1, depth - 2, "moss_block");
    stairX(
      ctx,
      x - rise,
      z + Math.floor(depth / 2) - 2,
      9,
      rise,
      5,
      true,
      "mossy_stone_brick_stairs",
    );
    stairX(
      ctx,
      x + width + rise - 1,
      z + Math.floor(depth / 2) - 2,
      9,
      rise,
      5,
      false,
      "mossy_stone_brick_stairs",
    );
    for (const dz of [0, depth - 1]) {
      box(ctx, x, 9 + rise, z + dz, width, 1, 1, "mossy_stone_brick_wall");
      ctx.clear({
        x: x + Math.floor(width / 2) - 2,
        y: 9 + rise,
        z: z + dz,
        w: 5,
        h: 2,
        d: 1,
      });
    }
  }
  // Ruined relay has a tall remaining chimney and two opposite open entrances.
  hall(ctx, 54, 53, 23, 22, "mossy_stone_bricks", "dark_oak_slab", 15, 8);
  ctx.clear({ x: 59, y: 23, z: 55, w: 12, h: 3, d: 12 });
  box(ctx, 72, 15, 56, 4, 18, 4, "cracked_stone_bricks");
  box(ctx, 71, 33, 55, 6, 2, 6, "waxed_oxidized_copper");
  box(ctx, 73, 35, 57, 2, 5, 2, "iron_bars");
  box(ctx, 67, 37, 57, 14, 1, 1, "iron_bars");
  // Ground-level broken conservatories form covered flanks with cross-route gaps.
  hall(ctx, 73, 21, 28, 19, "bricks", "waxed_oxidized_cut_copper_slab");
  hall(ctx, 23, 87, 27, 18, "mud_bricks", "dark_oak_slab");
  for (const [x, z, width] of [
    [22, 52, 16],
    [89, 64, 15],
    [43, 77, 13],
    [70, 104, 16],
  ] as const) {
    box(ctx, x, 9, z, width, 2, 3, "mossy_stone_bricks");
    box(ctx, x + 1, 11, z, width - 2, 1, 3, "azalea_leaves[persistent=true]");
    ctx.clear({ x: x + 5, y: 9, z, w: 4, h: 4, d: 3 });
  }
  // A shallow rill is a thematic crossing, with flush stepping stones and step banks.
  box(ctx, 41, 7, 39, 5, 2, 43, "water");
  for (const z of [43, 57, 74])
    box(ctx, 40, 8, z, 7, 1, 4, "mossy_stone_bricks");
  for (const x of [40, 46])
    box(ctx, x, 8, 39, 1, 1, 43, "mossy_stone_brick_stairs[facing=east]");
  gardens(ctx);
  // Fallen antenna fragments and breached walls make the abandoned relay feel occupied.
  for (const [x, z, length] of [
    [31, 71, 10],
    [86, 49, 11],
    [53, 104, 8],
    [62, 33, 9],
  ] as const) {
    box(ctx, x, 9, z, length, 2, 2, "cracked_stone_bricks");
    box(ctx, x + 2, 11, z, length - 5, 1, 2, "moss_block");
    box(ctx, x + length - 2, 9, z + 4, 2, 2, 3, "mossy_stone_bricks");
  }
  for (let x = 11; x < 116; x++) {
    const bend = Math.floor(ctx.noise(x, 21, { scale: 26, salt: 7 }) * 7);
    for (const z of [45 + bend, 83 - bend])
      box(ctx, x, 8, z, 1, 1, 4, "coarse_dirt");
  }
  for (const [x, z] of [
    [31, 28],
    [91, 96],
    [82, 28],
    [31, 94],
  ] as const) {
    box(ctx, x, 9, z, 3, 1, 6, "bricks");
    for (let dz = 0; dz < 6; dz += 2)
      ctx.set(x + 1, 10, z + dz, "flowering_azalea");
  }
  objective(ctx, w, d);
  deployment(ctx, w, d, "mossy_stone_bricks");
}) satisfies BuildProgram;
