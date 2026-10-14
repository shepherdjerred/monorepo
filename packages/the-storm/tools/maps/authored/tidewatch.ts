import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";
import {
  box,
  ground,
  boundary,
  hall,
  crates,
  bridge,
  objective,
} from "./lib/arena.ts";

export default ((ctx) => {
  const w = 144,
    d = 128;
  ground(ctx, w, d, "stone_bricks", "andesite");
  boundary(ctx, w, d, "prismarine_bricks");
  // Sheltered harbor basin with one-block-deep perimeter shelves on every shore.
  box(ctx, 48, 5, 39, 48, 4, 50, "water[level=0]");
  box(ctx, 50, 4, 41, 44, 1, 46, "sandstone");
  box(ctx, 48, 7, 39, 48, 1, 2, "sandstone");
  box(ctx, 48, 7, 87, 48, 1, 2, "sandstone");
  box(ctx, 48, 7, 39, 2, 1, 50, "sandstone");
  box(ctx, 94, 7, 39, 2, 1, 50, "sandstone");
  bridge(ctx, 43, 59, 58, 9, 8, "dark_oak_planks");
  hall(ctx, 24, 15, 27, 17, "white_terracotta", "dark_prismarine_stairs");
  hall(ctx, 94, 94, 25, 18, "mud_bricks", "spruce_stairs");
  hall(ctx, 98, 17, 23, 27, "bricks", "waxed_oxidized_cut_copper_stairs");
  // Lighthouse is separate from the warehouses; its beacon locates the northern flank.
  ctx.craft.tower({
    x: 69,
    z: 18,
    y: 9,
    shape: "round",
    radius: 5,
    h: 23,
    wall: "calcite",
    floorEvery: 6,
    floor: "spruce_planks",
    slits: true,
    light: "glowstone",
  });
  ctx.craft.conicalRoof({
    x: 69,
    z: 18,
    y: 32,
    radius: 6,
    stairs: "dark_prismarine_stairs",
    peak: "sea_lantern",
  });
  for (const [x, z, size] of [
    [30, 84, 5],
    [107, 75, 4],
    [63, 100, 4],
    [83, 103, 3],
    [23, 37, 3],
  ] as const)
    crates(ctx, x, z, 9, size);
  // Dock fingers and cranes supply cover without obstructing the return to the banks.
  for (const x of [53, 84]) {
    box(ctx, x, 8, 39, 7, 1, 13, "spruce_planks");
    box(ctx, x + 2, 0, 43, 2, 20, 2, "dark_oak_log");
    box(ctx, x + 2, 19, 43, 9, 2, 2, "dark_oak_log");
    box(ctx, x + 9, 15, 44, 1, 4, 1, "iron_chain");
  }
  // Offset sailboat silhouettes and fish-market stalls distinguish the two quays.
  for (const [x, z, sail] of [
    [57, 74, true],
    [80, 47, false],
  ] as const) {
    box(ctx, x, 8, z, 5, 1, 10, "dark_oak_planks");
    box(ctx, x + 1, 9, z + 1, 3, 1, 8, "spruce_planks");
    box(ctx, x + 2, 9, z + 5, 1, 12, 1, "spruce_log");
    if (sail) box(ctx, x + 2, 14, z + 1, 1, 5, 4, "white_wool");
  }
  for (const [x, z] of [
    [33, 101],
    [24, 77],
    [111, 56],
  ] as const) {
    for (const dx of [0, 7])
      for (const dz of [0, 4])
        box(ctx, x + dx, 9, z + dz, 1, 4, 1, "spruce_fence");
    box(ctx, x - 1, 13, z - 1, 10, 1, 7, "blue_wool");
    box(ctx, x + 1, 9, z + 1, 6, 1, 2, "spruce_planks");
  }
  for (const z of [32, 92]) box(ctx, 8, 8, z, 128, 1, 4, "polished_andesite");
  objective(ctx, w, d);
}) satisfies BuildProgram;
