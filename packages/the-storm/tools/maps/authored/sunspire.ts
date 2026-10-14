import type {
  BuildContext,
  BuildProgram,
} from "@shepherdjerred/mc-build/dsl/context.ts";
import { box, ground, boundary, hall, stairX, objective } from "./lib/arena.ts";
import { deployment } from "./lib/deployment.ts";

function tower(ctx: BuildContext, x: number, z: number, height: number) {
  box(ctx, x, 9, z, 9, height, 9, "cut_sandstone");
  ctx.clear({ x: x + 2, y: 9, z: z + 2, w: 5, h: height - 1, d: 5 });
  ctx.clear({ x, y: 9, z: z + 3, w: 9, h: 4, d: 3 });
  for (const dx of [0, 7])
    for (const dz of [0, 7])
      box(ctx, x + dx, 9 + height, z + dz, 2, 2, 2, "red_sandstone");
  box(ctx, x - 1, 8 + height, z - 1, 11, 1, 11, "smooth_sandstone");
  for (const dx of [0, 8])
    box(ctx, x + dx, 13, z + 4, 1, 2, 1, "orange_stained_glass");
}

function market(ctx: BuildContext) {
  // Low market colonnades make both flanks readable, shaded defensive routes.
  for (const [x, z, width] of [
    [65, 38, 26],
    [65, 88, 25],
    [27, 77, 19],
    [113, 48, 19],
  ] as const) {
    for (let dx = 0; dx < width; dx += 6) {
      box(ctx, x + dx, 9, z, 2, 5, 2, "cut_sandstone");
      box(ctx, x + dx, 9, z + 7, 2, 5, 2, "cut_sandstone");
    }
    box(ctx, x - 1, 14, z - 1, width + 1, 1, 11, "red_sandstone_slab");
    box(ctx, x + 5, 9, z + 2, 5, 2, 3, "orange_terracotta");
    ctx.set(x, 12, z, "glowstone");
    ctx.set(x + 18, 12, z, "glowstone");
  }
}

function keepSteps(ctx: BuildContext) {
  stairX(ctx, 51, 49, 9, 4, 9, true, "sandstone_stairs");
  stairX(ctx, 108, 49, 9, 4, 9, false, "sandstone_stairs");
  for (const x of [59, 100])
    box(ctx, x, 13, 47, 1, 1, 34, "sandstone_stairs[facing=east]");
  for (const z of [46, 81])
    box(ctx, 59, 13, z, 42, 1, 1, "sandstone_stairs[facing=north]");
}

export default ((ctx) => {
  const w = 160,
    d = 128;
  ground(ctx, w, d, "sandstone", "sandstone");
  boundary(ctx, w, d, "cut_red_sandstone");
  // Stepped keep occupies the middle route; side courts remain broad and interlinked.
  box(ctx, 55, 9, 42, 50, 4, 44, "cut_sandstone");
  box(ctx, 60, 13, 47, 40, 2, 34, "smooth_sandstone");
  keepSteps(ctx);
  // Ground-level vaulted underpass gives a short route beneath the objective plaza.
  ctx.clear({ x: 55, y: 9, z: 61, w: 50, h: 3, d: 7 });
  for (let x = 58; x < 104; x += 8)
    for (const z of [60, 68]) ctx.set(x, 10, z, "glowstone");
  for (const x of [61, 94])
    for (const z of [48, 75]) {
      box(ctx, x, 15, z, 5, 10, 5, "chiseled_sandstone");
      box(ctx, x - 1, 25, z - 1, 7, 2, 7, "red_sandstone");
    }
  // Sun obelisk is the shared landmark; the nuke sits on its approachable lower dais.
  box(ctx, 73, 15, 58, 14, 1, 14, "red_sandstone");
  box(ctx, 77, 16, 62, 6, 15, 6, "smooth_sandstone");
  box(ctx, 78, 31, 63, 4, 4, 4, "gold_block");
  box(ctx, 79, 35, 64, 2, 3, 2, "lightning_rod");
  ctx.set(72, 15, 64, "lodestone");
  hall(ctx, 30, 18, 29, 21, "smooth_sandstone", "red_sandstone_slab");
  hall(ctx, 100, 89, 29, 21, "cut_sandstone", "red_sandstone_slab", 9, 8);
  tower(ctx, 108, 21, 15);
  tower(ctx, 42, 91, 12);
  // A shallow oasis has broad stair banks and a walking causeway, never a vertical trap.
  box(ctx, 68, 6, 14, 28, 3, 17, "water");
  for (const z of [13, 31])
    box(ctx, 67, 7, z, 30, 2, 1, "sandstone_stairs[facing=north]");
  for (const x of [67, 96])
    box(ctx, x, 7, 14, 1, 2, 17, "sandstone_stairs[facing=east]");
  box(ctx, 79, 8, 13, 4, 1, 19, "smooth_sandstone");
  for (const [x, z] of [
    [31, 84],
    [121, 42],
    [67, 100],
    [93, 104],
    [36, 45],
    [116, 77],
  ] as const) {
    box(ctx, x, 9, z, 5, 2, 5, "red_sandstone");
    box(ctx, x + 1, 11, z + 1, 3, 1, 3, "smooth_sandstone_slab");
  }
  for (const [x, z, h] of [
    [63, 15, 8],
    [99, 27, 10],
    [70, 108, 7],
    [91, 105, 9],
  ] as const) {
    box(ctx, x, 9, z, 1, h, 1, "jungle_log");
    box(ctx, x - 3, 9 + h, z - 1, 7, 1, 3, "jungle_leaves[persistent=true]");
    box(ctx, x - 1, 9 + h, z - 3, 3, 1, 7, "jungle_leaves[persistent=true]");
  }
  for (const z of [36, 87]) box(ctx, 10, 8, z, 140, 1, 4, "smooth_sandstone");
  market(ctx);
  for (let x = 8; x < w - 8; x++)
    for (const z of [4, 5, 6, 121, 122, 123]) {
      const rise = 1 + Math.floor(ctx.noise(x, z, { scale: 18, salt: 12 }) * 5);
      box(ctx, x, 9, z, 1, rise, 1, "sandstone");
    }
  objective(ctx, w, d);
  deployment(ctx, w, d, "cut_red_sandstone");
}) satisfies BuildProgram;
