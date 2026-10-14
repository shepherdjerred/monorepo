import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";
import {
  box,
  ground,
  boundary,
  hall,
  crates,
  bridge,
  stairX,
  objective,
} from "./lib/arena.ts";

export default ((ctx) => {
  const w = 128,
    d = 112;
  ground(ctx, w, d, "polished_andesite", "deepslate");
  boundary(ctx, w, d, "bricks");
  // Two long foundries flank a central furnace tower; diagonal yards connect all lanes.
  hall(ctx, 29, 15, 25, 27, "bricks", "waxed_oxidized_cut_copper_slab");
  hall(ctx, 74, 72, 25, 25, "mud_bricks", "waxed_weathered_cut_copper_slab");
  hall(ctx, 51, 43, 27, 25, "deepslate_bricks", "waxed_cut_copper_slab", 9, 10);
  // Chimneys are varied in height; capped shafts form the landmark silhouette.
  for (const [x, z, height] of [
    [52, 46, 27],
    [73, 62, 33],
    [34, 18, 21],
  ] as const) {
    box(ctx, x, 9, z, 3, height, 3, "bricks");
    box(ctx, x - 1, height + 7, z - 1, 5, 2, 5, "polished_blackstone");
  }
  bridge(ctx, 30, 47, 68, 7, 15, "waxed_oxidized_cut_copper");
  stairX(ctx, 23, 48, 9, 7, 5, true);
  stairX(ctx, 104, 48, 9, 7, 5, false);
  for (const [x, z, size] of [
    [22, 27, 4],
    [91, 24, 5],
    [34, 83, 3],
    [103, 78, 4],
    [58, 87, 3],
    [62, 18, 4],
  ] as const)
    crates(ctx, x, z, 9, size);
  for (const z of [8, 103])
    for (let x = 12; x < 117; x += 13) {
      box(ctx, x, 9, z, 1, 4, 1, "polished_basalt");
      ctx.set(x, 13, z, "lantern");
    }
  // Boiler batteries, pipe manifolds, loading trenches and a rail siding establish an industrial yard.
  for (const [x, z, height] of [
    [82, 21, 7],
    [91, 21, 10],
    [34, 92, 6],
  ] as const) {
    ctx.fill(
      ctx.geo.cylinder({ cx: x, cz: z, y: 9, r: 3, h: height }),
      "waxed_weathered_copper",
    );
    ctx.fill(
      ctx.geo.cylinder({ cx: x, cz: z, y: 9 + height, r: 3, h: 1 }),
      "polished_blackstone",
    );
    box(ctx, x, 10, z + 3, 2, 2, 7, "waxed_cut_copper");
  }
  for (const x of [18, 109])
    box(ctx, x, 9, 10, 1, 1, 91, "rail[shape=north_south]");
  for (const [x, z] of [
    [18, 35],
    [109, 89],
  ] as const) {
    box(ctx, x - 2, 9, z, 5, 1, 9, "dark_oak_planks");
    box(ctx, x - 1, 10, z + 1, 3, 3, 7, "iron_block");
  }
  for (const z of [30, 80]) {
    box(ctx, 8, 8, z, 111, 1, 5, "stone_bricks");
    for (let x = 11; x < 117; x += 17)
      box(ctx, x, 9, z + 1, 6, 2, 1, "polished_blackstone");
  }
  objective(ctx, w, d);
}) satisfies BuildProgram;
