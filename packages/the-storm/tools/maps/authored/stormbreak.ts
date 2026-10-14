import type {
  BuildContext,
  BuildProgram,
} from "@shepherdjerred/mc-build/dsl/context.ts";
import { box, ground, boundary, stairX, objective } from "./lib/arena.ts";
import { deployment } from "./lib/deployment.ts";

function bastion(ctx: BuildContext, x: number, z: number, height: number) {
  box(ctx, x, 9, z, 16, 5, 16, "stone_bricks");
  box(ctx, x, 14, z, 16, height, 16, "stone_bricks");
  ctx.clear({ x: x + 2, y: 14, z: z + 2, w: 12, h: height - 1, d: 12 });
  ctx.clear({ x, y: 14, z: z + 6, w: 16, h: 5, d: 4 });
  ctx.clear({ x: x + 6, y: 14, z, w: 4, h: 5, d: 16 });
  for (const dx of [0, 13])
    for (const dz of [0, 13])
      box(ctx, x + dx, 14 + height, z + dz, 3, 2, 3, "polished_deepslate");
  for (const dz of [0, 15])
    box(ctx, x + 3, 14 + height, z + dz, 10, 1, 1, "stone_brick_wall");
  stairX(ctx, x, z + 5, 14, height, 5, true);
  for (const dx of [3, 12]) {
    box(ctx, x + dx, 14, z + 3, 1, 2, 1, "polished_deepslate");
    ctx.set(x + dx, 16, z + 3, "sea_lantern");
  }
}

export default ((ctx) => {
  const w = 160,
    d = 144;
  ground(ctx, w, d, "cobblestone", "stone");
  boundary(ctx, w, d, "polished_deepslate");
  // Sea moat is only two blocks deep; stone banks and ladders provide many exits.
  box(ctx, 44, 6, 11, 72, 3, 122, "water");
  for (const x of [43, 116])
    box(ctx, x, 7, 11, 1, 2, 122, "stone_brick_stairs[facing=east]");
  // Three wide causeways have railings, staggered cover and joined central island.
  for (const z of [28, 67, 108]) {
    box(ctx, 40, 8, z, 80, 1, 9, "stone_bricks");
    for (const edge of [z, z + 8]) {
      box(ctx, 45, 9, edge, 70, 1, 1, "stone_brick_wall");
      for (const x of [55, 102])
        box(ctx, x, 9, edge, 3, 3, 2, "polished_deepslate");
    }
  }
  box(ctx, 59, 6, 38, 42, 7, 65, "stone_bricks");
  box(ctx, 63, 12, 42, 34, 2, 57, "polished_andesite");
  stairX(ctx, 54, 67, 9, 5, 9, true);
  stairX(ctx, 106, 67, 9, 5, 9, false);
  for (let step = 0; step < 4; step++) {
    box(ctx, 76, 0, 37 + step, 8, 9 + step, 1, "stone_bricks");
    box(ctx, 76, 0, 107 - step, 8, 9 + step, 1, "stone_bricks");
    box(
      ctx,
      76,
      9 + step,
      37 + step,
      8,
      1,
      1,
      "stone_brick_stairs[facing=south]",
    );
    box(
      ctx,
      76,
      9 + step,
      107 - step,
      8,
      1,
      1,
      "stone_brick_stairs[facing=north]",
    );
  }
  box(ctx, 76, 12, 103, 8, 1, 1, "stone_bricks");
  // The exposed nuke court sits between a broken gatehouse and a roofed chapel.
  ctx.set(79, 14, 72, "lodestone");
  for (const [x, z, height] of [
    [64, 42, 15],
    [85, 85, 12],
  ] as const)
    bastion(ctx, x, z, height);
  box(ctx, 76, 14, 48, 14, 8, 12, "deepslate_bricks");
  ctx.clear({ x: 77, y: 14, z: 49, w: 12, h: 7, d: 10 });
  ctx.clear({ x: 80, y: 14, z: 48, w: 5, h: 5, d: 12 });
  ctx.craft.gableRoof({
    x: 76,
    z: 48,
    w: 14,
    d: 12,
    y: 22,
    ridge: "z",
    stairs: "deepslate_tile_stairs",
    overhang: 1,
    gable: "deepslate_bricks",
  });
  // Tall lighthouse anchors the seaward silhouette, with a connected service court.
  box(ctx, 104, 9, 14, 11, 20, 11, "calcite");
  box(ctx, 104, 16, 14, 11, 4, 11, "red_terracotta");
  box(ctx, 103, 29, 13, 13, 1, 13, "polished_deepslate");
  box(ctx, 106, 30, 16, 7, 5, 7, "glass");
  box(ctx, 108, 30, 18, 3, 4, 3, "sea_lantern");
  box(ctx, 103, 34, 13, 13, 1, 13, "polished_deepslate");
  ctx.craft.hipRoof({
    x: 104,
    z: 14,
    w: 11,
    d: 11,
    y: 35,
    stairs: "dark_prismarine_stairs",
    overhang: 1,
  });
  ctx.set(109, 34, 19, "sea_lantern");
  for (const [x, z] of [
    [77, 49],
    [87, 58],
  ] as const)
    box(ctx, x, 20, z, 2, 2, 2, "sea_lantern");
  ctx.set(76, 22, 54, "sea_lantern");
  // Staggered outer batteries shelter long approaches to every causeway.
  for (const [x, z] of [
    [23, 43],
    [125, 87],
    [28, 112],
    [124, 36],
  ] as const) {
    box(ctx, x, 9, z, 11, 4, 2, "stone_bricks");
    box(ctx, x, 9, z + 2, 2, 4, 8, "stone_bricks");
    box(ctx, x + 4, 9, z + 3, 5, 2, 2, "polished_blackstone");
  }
  for (const [x, z] of [
    [29, 27],
    [121, 104],
    [27, 103],
    [122, 27],
    [75, 111],
  ] as const) {
    box(ctx, x, 9, z, 8, 3, 5, "mossy_stone_bricks");
    box(ctx, x + 1, 12, z + 1, 6, 1, 3, "stone_brick_slab");
  }
  for (const z of [19, 49, 90, 122]) {
    box(ctx, 44, 7, z, 1, 2, 2, "ladder[facing=east]");
    box(ctx, 115, 7, z, 1, 2, 2, "ladder[facing=west]");
  }
  for (const [x, z] of [
    [33, 17],
    [126, 119],
    [30, 85],
    [130, 53],
  ] as const) {
    box(ctx, x, 9, z, 1, 6, 1, "dark_oak_log");
    ctx.set(x, 15, z, "lantern");
  }
  objective(ctx, w, d);
  deployment(ctx, w, d, "polished_deepslate");
}) satisfies BuildProgram;
