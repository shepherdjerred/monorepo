import type {
  BuildContext,
  BuildProgram,
} from "@shepherdjerred/mc-build/dsl/context.ts";
import {
  box,
  ground,
  boundary,
  hall,
  crates,
  stairX,
  objective,
} from "./lib/arena.ts";
import { deployment } from "./lib/deployment.ts";

function freight(ctx: BuildContext, x: number, z: number, color: string) {
  box(ctx, x, 9, z, 16, 1, 7, "polished_blackstone");
  box(ctx, x + 1, 10, z, 14, 5, 7, color);
  ctx.clear({ x: x + 2, y: 10, z: z + 1, w: 12, h: 4, d: 5 });
  ctx.clear({ x: x + 6, y: 10, z, w: 4, h: 3, d: 7 });
  for (const dx of [2, 12])
    for (const dz of [0, 6]) ctx.set(x + dx, 9, z + dz, "coal_block");
  box(ctx, x + 1, 15, z, 14, 1, 7, "waxed_oxidized_cut_copper_slab");
}

function quarryShoulders(ctx: BuildContext) {
  for (const [x, z, rise] of [
    [36, 65, 5],
    [98, 13, 7],
  ] as const) {
    box(ctx, x, 9, z, 15, rise, 15, "tuff");
    box(ctx, x + 2, 9 + rise, z + 2, 11, 2, 2, "cobbled_deepslate");
    stairX(ctx, x - rise, z + 7, 9, rise, 4, true, "tuff_brick_stairs");
    for (let i = 0; i < 3; i++)
      box(ctx, x + 3 + i * 4, 9 + rise, z + 10, 2, 1, 3, "raw_iron_block");
  }
  // Excavated cliff shoulders frame the yard and expose irregular iron seams.
  for (let x = 7; x < 137; x++)
    for (const z of [3, 4, 5, 6, 89, 90, 91, 92]) {
      const rise = 3 + Math.floor(ctx.noise(x, z, { scale: 17, salt: 10 }) * 8);
      box(ctx, x, 9, z, 1, rise, 1, "tuff");
      if (x % 11 < 3) ctx.set(x, 9 + Math.floor(rise / 2), z, "iron_ore");
    }
}

function cutting(ctx: BuildContext) {
  // The rail cutting is recessed two blocks with uninterrupted stair exits both ends.
  ctx.clear({ x: 32, y: 7, z: 35, w: 80, h: 4, d: 27 });
  box(ctx, 32, 6, 35, 80, 1, 27, "gravel");
  for (const x of [32, 110])
    for (let step = 0; step < 2; step++) {
      box(
        ctx,
        x + step,
        7 + (x < 70 ? 1 - step : step),
        37,
        1,
        1,
        23,
        `stone_stairs[facing=${x < 70 ? "west" : "east"}]`,
      );
    }
  for (const z of [41, 54])
    box(ctx, 32, 7, z, 80, 1, 1, "rail[shape=east_west]");
}

export default ((ctx) => {
  const w = 144,
    d = 96;
  ground(ctx, w, d, "andesite", "stone");
  boundary(ctx, w, d, "deepslate_bricks");
  cutting(ctx);
  // Two quarry shoulders contain covered haul routes and roofed freight shelters.
  hall(
    ctx,
    28,
    13,
    30,
    17,
    "deepslate_bricks",
    "waxed_weathered_cut_copper_slab",
  );
  hall(ctx, 84, 67, 31, 16, "mud_bricks", "waxed_oxidized_cut_copper_slab");
  freight(ctx, 68, 18, "orange_terracotta");
  freight(ctx, 47, 72, "cyan_terracotta");
  freight(ctx, 91, 31, "red_terracotta");
  quarryShoulders(ctx);
  // Central gantry crosses the trench; solid girders and railings prevent accidental falls.
  box(ctx, 66, 9, 31, 10, 1, 35, "waxed_oxidized_cut_copper");
  for (const x of [66, 75]) {
    box(ctx, x, 10, 31, 1, 1, 35, "iron_bars");
    for (const z of [33, 61]) box(ctx, x, 7, z, 1, 3, 1, "polished_basalt");
  }
  // Broad partial baffles break long rifle sightlines without closing the cutting.
  for (const [x, z] of [
    [45, 37],
    [85, 49],
    [61, 52],
  ] as const) {
    box(ctx, x, 7, z, 9, 2, 4, "stone");
    box(ctx, x + 1, 9, z + 1, 7, 1, 2, "raw_iron_block");
  }
  for (const [x, z, size] of [
    [20, 27, 4],
    [117, 63, 4],
    [90, 78, 3],
    [60, 29, 3],
    [25, 70, 3],
    [118, 23, 4],
  ] as const)
    crates(ctx, x, z, 9, size);
  for (const [x, z] of [
    [62, 14],
    [79, 78],
    [21, 34],
    [120, 56],
  ] as const) {
    box(ctx, x, 9, z, 1, 7, 1, "polished_basalt");
    ctx.set(x, 16, z, "lantern");
  }
  // A loading crane provides one unmistakable industrial landmark above the freight.
  box(ctx, 89, 9, 70, 3, 16, 3, "polished_basalt");
  box(ctx, 72, 24, 70, 24, 2, 3, "yellow_concrete");
  box(ctx, 74, 16, 71, 1, 8, 1, "iron_bars");
  box(ctx, 73, 15, 70, 3, 1, 3, "polished_blackstone");
  objective(ctx, w, d);
  deployment(ctx, w, d, "tuff_bricks");
}) satisfies BuildProgram;
