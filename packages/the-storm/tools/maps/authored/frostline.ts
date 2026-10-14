import type {
  BuildContext,
  BuildProgram,
} from "@shepherdjerred/mc-build/dsl/context.ts";
import { boulder } from "@shepherdjerred/mc-build/components/rocks/index.ts";
import { box, ground, boundary, hall, crates, objective } from "./lib/arena.ts";

function mountains(ctx: BuildContext, w: number, d: number) {
  // Three overlapping alpine ridges sit outside the broad combat routes.
  for (let x = 3; x < w - 3; x++)
    for (let z = 3; z < d - 3; z++) {
      if (z > 17 && z < 95) continue;
      const ridge = Math.max(0, 1 - Math.min(z - 3, d - 4 - z) / 15);
      const peaks =
        17 * Math.exp(-((x - (z < 50 ? 31 : 106)) ** 2) / 250) +
        10 * Math.exp(-((x - 74) ** 2) / 120);
      const h =
        8 +
        Math.floor(
          ridge *
            (5 +
              peaks +
              ctx.noise(x, z, { scale: 13, octaves: 3, salt: 8 }) * 9),
        );
      box(ctx, x, 9, z, 1, h - 8, 1, "stone");
      ctx.set(x, h, z, "snow_block");
    }
}

export default ((ctx) => {
  const w = 144,
    d = 112;
  ground(ctx, w, d, "snow_block", "stone");
  boundary(ctx, w, d, "cobbled_deepslate");
  mountains(ctx, w, d);
  hall(ctx, 47, 37, 25, 29, "spruce_planks", "dark_oak_stairs", 9, 9);
  hall(ctx, 74, 66, 29, 19, "stripped_spruce_log", "spruce_stairs");
  hall(ctx, 24, 23, 19, 19, "stone_bricks", "dark_oak_stairs");
  // Covered north and south traverse points contrast with the open center.
  for (const [x, z] of [
    [65, 24],
    [33, 80],
    [108, 25],
  ] as const) {
    box(ctx, x, 9, z, 1, 5, 1, "spruce_log");
    box(ctx, x + 10, 9, z, 1, 5, 1, "spruce_log");
    box(ctx, x, 14, z - 2, 11, 1, 5, "spruce_slab");
    ctx.set(x, 13, z + 1, "lantern[hanging=true]");
  }
  for (const [x, z, size] of [
    [37, 61, 3],
    [112, 75, 4],
    [83, 27, 3],
    [16, 88, 4],
  ] as const)
    crates(ctx, x, z, 9, size);
  for (const [x, z, size] of [
    [93, 45, 4],
    [51, 83, 3],
    [118, 37, 3],
  ] as const)
    boulder(ctx, {
      x,
      z,
      y: 9,
      size,
      palette: "stone",
      seed: x,
      satellites: false,
    });
  for (const [x, z, height] of [
    [19, 20, 10],
    [118, 94, 13],
    [37, 95, 11],
    [108, 19, 9],
    [21, 76, 8],
  ] as const)
    ctx.craft.tree({ x, y: 9, z, species: "spruce", height, seed: x });
  // Zigzag snow berms and log revetments create sheltered fire positions in both outer lanes.
  for (const [x, z, length] of [
    [23, 65, 12],
    [88, 31, 15],
    [57, 86, 16],
    [113, 61, 10],
  ] as const) {
    box(ctx, x, 9, z, length, 2, 2, "spruce_log[axis=x]");
    box(ctx, x + 2, 11, z, length - 4, 1, 2, "snow_block");
    box(ctx, x, 9, z + 2, 2, 2, 5, "snow_block");
  }
  // Crushed gravel links entrances and gives the white field visible route structure.
  for (const z of [45, 88])
    for (let x = 8; x < 136; x++) {
      const bend = Math.floor(ctx.noise(x, z, { scale: 23, salt: 2 }) * 6);
      box(ctx, x, 8, z + bend, 1, 1, 4, "gravel");
    }
  objective(ctx, w, d);
}) satisfies BuildProgram;
