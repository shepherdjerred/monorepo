import type {
  BuildContext,
  BuildProgram,
} from "@shepherdjerred/mc-build/dsl/context.ts";

type Rect = { x: number; z: number; w: number; d: number };

/** A flat roof with a one-block parapet and corner posts. */
function flatRoof(ctx: BuildContext, rect: Rect, y: number): void {
  const cap = ctx.mat.block("cut_sandstone_slab", { type: "top" });
  const parapet = ctx.mat.block("smooth_sandstone");
  for (let x = rect.x; x < rect.x + rect.w; x += 1) {
    for (let z = rect.z; z < rect.z + rect.d; z += 1) {
      const edge =
        x === rect.x ||
        z === rect.z ||
        x === rect.x + rect.w - 1 ||
        z === rect.z + rect.d - 1;
      ctx.set(x, y, z, cap);
      if (edge) {
        ctx.set(x, y + 1, z, parapet);
      }
    }
  }
  for (const [x, z] of [
    [rect.x, rect.z],
    [rect.x + rect.w - 1, rect.z],
    [rect.x, rect.z + rect.d - 1],
    [rect.x + rect.w - 1, rect.z + rect.d - 1],
  ] as const) {
    ctx.set(x, y + 2, z, ctx.mat.block("chiseled_sandstone"));
  }
}

/** An L-shaped desert house: two flat-roofed wings, awning, courtyard. */
export default ((ctx) => {
  const { craft, mat } = ctx;
  const t = mat.theme("desert");
  const main = { x: 3, z: 3, w: 11, d: 7 };
  const wing = { x: 9, z: 9, w: 5, d: 6 };
  for (const rect of [main, wing]) {
    craft.foundation({ ...rect, y: 0, material: t.foundation });
    craft.floor({
      x: rect.x + 1,
      z: rect.z + 1,
      w: rect.w - 2,
      d: rect.d - 2,
      y: 0,
      material: t.floor,
    });
  }
  const mainWalls = craft.walls({
    ...main,
    y: 1,
    h: 4,
    frame: t.frame,
    infill: t.infill,
    postEvery: 5,
    postsAt: { front: [1, 3, 5] },
  });
  const wingWalls = craft.walls({
    ...wing,
    y: 1,
    h: 4,
    frame: t.frame,
    infill: t.infill,
    postEvery: 5,
    postsAt: { left: [2, 4] },
  });
  // Open the wing into the main room where they meet.
  ctx.fill({ x: 10, y: 1, z: 9, w: 3, h: 3, d: 1 }, ctx.AIR);
  craft.door(mainWalls.faces.front, { at: 2, door: t.door });
  craft.door(wingWalls.faces.left, { at: 3, door: t.door });
  craft.window(mainWalls.faces.front, { at: 4, w: 1, sill: t.roof });
  for (const at of [1, 4, 7]) {
    craft.window(mainWalls.faces.back, { at, w: 2, sill: t.roof });
  }
  craft.window(mainWalls.faces.left, { at: 2, w: 3, sill: t.roof });
  craft.window(wingWalls.faces.front, { at: 1, w: 3, sill: t.roof });
  craft.window(wingWalls.faces.right, { at: 2, w: 2, sill: t.roof });
  flatRoof(ctx, main, mainWalls.top);
  flatRoof(ctx, wing, wingWalls.top);
  craft.interior({
    room: { x: 5, y: 1, z: 5, w: 7, h: 4, d: 3 },
    wood: "acacia",
    bed: "orange",
  });
  ctx.set(11, 1, 12, t.lantern);
  ctx.set(12, 1, 10, t.lantern);

  // A striped awning over the courtyard door, and the courtyard itself.
  for (let z = 10; z <= 13; z += 1) {
    const wool = mat.block(z % 2 === 0 ? "orange_wool" : "white_wool");
    for (const x of [6, 7, 8]) {
      ctx.set(x, 4, z, wool);
    }
  }
  for (const z of [10, 13]) {
    for (let y = 0; y < 4; y += 1) {
      ctx.set(6, y, z, mat.block("acacia_fence"));
    }
  }
  ctx.set(7, 3, 11, mat.block("lantern", { hanging: "true" }));
  craft.path({ from: { x: 5, z: 10 }, to: { x: 5, z: 16 }, y: 0, width: 2 });
  craft.landscape({
    area: { x: 0, z: 0, w: 18, d: 18 },
    y: 0,
    ground: mat.noise([
      ["sand", 5],
      ["smooth_sandstone", 1],
    ]),
    flowers: ["dead_bush", "short_dry_grass"],
    bushes: false,
    density: 0.1,
    avoid: [
      { x: 2, z: 2, w: 13, d: 9 },
      { x: 8, z: 8, w: 7, d: 8 },
      { x: 4, z: 9, w: 4, d: 9 },
    ],
  });
  for (const [x, z] of [
    [1, 14],
    [15, 4],
  ] as const) {
    for (let y = 0; y < 3; y += 1) {
      ctx.set(x, y, z, mat.block("cactus"));
    }
  }
}) satisfies BuildProgram;
