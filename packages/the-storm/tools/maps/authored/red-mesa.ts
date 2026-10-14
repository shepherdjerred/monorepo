import type {
  BuildContext,
  BuildProgram,
} from "@shepherdjerred/mc-build/dsl/context.ts";
import { boulder } from "@shepherdjerred/mc-build/components/rocks/index.ts";
import {
  box,
  ground,
  boundary,
  hall,
  bridge,
  stairX,
  solidOutcrop,
  objective,
} from "./lib/arena.ts";

function ravine(ctx: BuildContext) {
  // The playable central ravine is shallow, with continuous stepped banks.
  for (let x = 43; x <= 84; x++) {
    const top = Math.max(4, 8 - Math.floor(Math.min(x - 43, 84 - x) / 2));
    ctx.clear({ x, y: top + 1, z: 5, w: 1, h: 8 - top, d: 118 });
    box(ctx, x, top, 5, 1, 1, 118, "smooth_red_sandstone");
  }
}

function rim(ctx: BuildContext) {
  for (let x = 4; x < 124; x++)
    for (const north of [true, false]) rimColumn(ctx, x, north);
}

function rimColumn(ctx: BuildContext, x: number, north: boolean) {
  const h =
    8 +
    Math.floor(ctx.noise(x, north ? 1 : 100, { scale: 13, salt: 9 }) * 18) +
    Math.floor(9 * Math.exp(-((x - (north ? 36 : 93)) ** 2) / 170));
  for (let depth = 0; depth < 9; depth++)
    box(
      ctx,
      x,
      9,
      north ? 3 + depth : 124 - depth,
      1,
      Math.max(1, h - depth * 2),
      1,
      depth < 3 ? "terracotta" : "red_sandstone",
    );
}

export default ((ctx) => {
  const w = 128,
    d = 128;
  ground(ctx, w, d, "red_sandstone", "terracotta");
  boundary(ctx, w, d, "red_sandstone");
  ravine(ctx);
  bridge(ctx, 42, 25, 44, 8, 8, "acacia_planks");
  bridge(ctx, 42, 94, 44, 8, 8, "acacia_planks");
  hall(ctx, 23, 39, 18, 23, "packed_mud", "smooth_red_sandstone_slab");
  hall(ctx, 87, 68, 18, 23, "mud_bricks", "smooth_red_sandstone_slab");
  stairX(ctx, 16, 43, 9, 7, 4, true, "red_sandstone_stairs");
  stairX(ctx, 111, 84, 9, 7, 4, false, "red_sandstone_stairs");
  // Unequal but mirrored outcrop clusters block direct spawn sightlines.
  for (const [x, z, size, seed] of [
    [34, 83, 6, 1],
    [94, 43, 6, 2],
    [29, 18, 5, 3],
    [98, 109, 5, 4],
    [66, 62, 5, 5],
  ] as const) {
    boulder(ctx, {
      x,
      z,
      y: 9,
      size,
      shape: "tall",
      palette: "sandstone",
      seed,
      satellites: false,
    });
    solidOutcrop(ctx, x, z, size);
  }
  // Terraced rim relief makes a canyon silhouette rather than a painted arena.
  rim(ctx);
  for (let z = 18; z < 114; z += 17) {
    box(ctx, 58, 4, z, 11, 1, 7, "coarse_dirt");
    box(ctx, z < 65 ? 55 : 71, 5, z, 2, 3, 5, "red_sandstone");
  }
  objective(ctx, w, d);
}) satisfies BuildProgram;
