import type {
  BuildContext,
  BuildProgram,
} from "@shepherdjerred/mc-build/dsl/context.ts";

/** East armory annex: three eight-bay galleries and a sheltered circulation spine. */
export default ((ctx) => {
  ctx.clear({ x: 0, y: 0, z: 0, w: 70, h: 36, d: 100 });
  const fill = painter(ctx);
  fill([0, 0, 8, 68, 5, 84], "cobbled_deepslate");
  fill([0, 5, 8, 68, 1, 84], "polished_andesite");
  fill([2, 5, 12, 8, 1, 76], "polished_deepslate");
  // Open-front circulation spine: paired original-courtyard doors meet this walkway.
  for (const z of [20, 76]) {
    fill([0, 5, z, 12, 1, 5], "polished_andesite");
    fill([0, 6, z - 1, 2, 6, 1], "deepslate_bricks");
    fill([0, 6, z + 5, 2, 6, 1], "deepslate_bricks");
    fill([0, 12, z - 1, 3, 1, 7], "polished_blackstone");
    fill([0, 13, z - 1, 3, 1, 7], "yellow_terracotta");
  }
  for (const z of [12, 30, 48, 66, 86]) {
    fill([1, 6, z, 2, 8, 2], "deepslate_bricks");
    fill([9, 6, z, 2, 8, 2], "deepslate_bricks");
    fill([2, 13, z, 8, 1, 2], "polished_blackstone");
    fill([5, 12, z, 2, 1, 2], "sea_lantern");
  }
  fill([1, 14, 12, 10, 1, 76], "deepslate_tiles");
  // Different gallery accents and a stepped monitor roof keep the annex legible at a glance.
  for (const [index, south] of [12, 39, 66].entries())
    gallery(ctx, index, south);
  // Perimeter edging and planted pockets soften the large armory's foundations.
  fill([0, 5, 8, 68, 1, 1], "polished_deepslate");
  fill([0, 5, 91, 68, 1, 1], "polished_deepslate");
  fill([67, 6, 8, 1, 1, 84], "polished_deepslate_wall");
  for (const z of [14, 36, 62, 86]) {
    fill([64, 6, z, 2, 1, 3], "polished_blackstone");
    fill([64, 7, z, 2, 1, 3], "azalea_leaves[persistent=true]");
  }
}) satisfies BuildProgram;

function painter(ctx: BuildContext) {
  return (
    [x, y, z, w, h, d]: [number, number, number, number, number, number],
    material: string,
  ) => {
    ctx.fill({ x, y, z, w, h, d }, material);
  };
}

function gallery(ctx: BuildContext, index: number, z: number) {
  const fill = painter(ctx);
  const accent = ["red_terracotta", "cyan_terracotta", "yellow_terracotta"][
    index
  ];
  if (accent === undefined) throw new Error("Missing gallery accent");
  fill([13, 6, z, 49, 8, 1], "stone_bricks");
  fill([13, 6, z + 22, 49, 8, 1], "stone_bricks");
  fill([61, 6, z, 1, 8, 23], "stone_bricks");
  fill([13, 6, z, 1, 8, 23], "stone_bricks");
  ctx.clear({ x: 13, y: 6, z: z + 9, w: 1, h: 4, d: 5 });
  fill([13, 10, z + 8, 2, 1, 7], "polished_blackstone");
  fill([13, 11, z + 8, 2, 2, 7], accent);
  fill([14, 5, z + 9, 45, 1, 5], "polished_deepslate");
  for (const x of [15, 25, 35, 45, 55, 60]) {
    fill([x, 6, z, 2, 8, 2], "polished_deepslate");
    fill([x, 6, z + 21, 2, 8, 2], "polished_deepslate");
    fill([x, 11, z + 1, 2, 1, 21], "polished_blackstone");
    fill([x, 10, z + 10, 2, 1, 3], "sea_lantern");
  }
  for (const x of [20, 28, 36, 44])
    for (const south of [z + 4, z + 18]) {
      fill([x - 1, 6, south - 1, 3, 1, 3], "polished_blackstone");
      fill([x, 7, south, 1, 1, 1], "chiseled_deepslate");
      fill([x - 1, 5, south + (south === z + 4 ? 3 : -3), 3, 1, 1], accent);
      fill([x - 2, 6, south + (south === z + 4 ? -2 : 2), 5, 3, 1], accent);
    }
  // A recessed glazed end wall gives each room an observation window.
  fill([61, 8, z + 7, 1, 4, 9], "light_gray_stained_glass");
  fill([60, 7, z + 7, 1, 1, 9], "polished_blackstone");
  fill([60, 12, z + 7, 1, 1, 9], "polished_blackstone");
  fill([12, 14, z - 1, 51, 1, 25], "deepslate_tiles");
  fill([15, 15, z + 3, 45, 1, 17], "deepslate_tiles");
  fill([18, 16, z + 7, 39, 1, 9], "deepslate_tiles");
  fill([18, 15, z + 7, 39, 1, 1], "light_gray_stained_glass");
  fill([18, 15, z + 15, 39, 1, 1], "light_gray_stained_glass");
  // Copper monitor roofs and compact exhaust stacks break the warehouse silhouette.
  fill([22, 17, z + 9, 31, 1, 5], "waxed_oxidized_cut_copper");
  fill([22, 16, z + 9, 31, 1, 1], "light_gray_stained_glass");
  fill([22, 16, z + 13, 31, 1, 1], "light_gray_stained_glass");
  for (const x of [19, 35, 51]) {
    fill([x, 16, z + 5, 2, 3 + index, 2], "polished_blackstone");
    fill([x - 1, 19 + index, z + 4, 4, 1, 4], "polished_blackstone_slab");
  }
  // Gallery endcaps: lit wall displays and a narrow equipment bench.
  fill([58, 6, z + 8, 2, 1, 7], "polished_blackstone");
  fill([60, 9, z + 9, 1, 2, 5], accent);
  fill([60, 9, z + 11, 1, 1, 1], "sea_lantern");
  for (const x of [16, 26, 36, 46, 56]) {
    fill([x, 6, z - 1, 2, 7, 1], "polished_deepslate");
    fill([x, 6, z + 23, 2, 7, 1], "polished_deepslate");
  }
}
