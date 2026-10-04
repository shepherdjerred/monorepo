import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";

/** A medieval timber cottage: gable roof with eaves, side chimney, garden. */
export default ((ctx) => {
  const { craft, mat } = ctx;
  const t = mat.theme("medieval");
  const fp = { x: 3, z: 3, w: 9, d: 7 };
  const base = craft.foundation({ ...fp, y: 0, material: t.foundation });
  craft.floor({ x: 4, z: 4, w: 7, d: 5, y: 0, material: t.floor });
  const walls = craft.walls({
    ...fp,
    y: base.top,
    h: 5,
    frame: t.frame,
    infill: t.infill,
    postEvery: 4,
    postsAt: { front: [3, 5] },
  });
  craft.door(walls.faces.front, { at: 4, door: t.door });
  for (const at of [1, 6]) {
    craft.window(walls.faces.front, {
      at,
      w: 2,
      sill: t.roof,
      shutters: t.shutter,
    });
  }
  craft.window(walls.faces.left, { at: 2, w: 3, sill: t.roof });
  craft.window(walls.faces.right, { at: 1, w: 2, sill: t.roof });
  for (const at of [1, 5]) {
    craft.window(walls.faces.back, { at, w: 3, sill: t.roof });
  }
  craft.gableRoof({
    ...fp,
    y: walls.top,
    ridge: "x",
    stairs: t.roof,
    overhang: 1,
    gable: t.trim,
    eaves: true,
  });
  craft.chimney({
    x: fp.x + fp.w,
    z: fp.z + 4,
    base: 0,
    height: walls.top + 5,
    material: mat.noise([
      ["stone_bricks", 3],
      ["cobblestone", 2],
      ["mossy_stone_bricks", 1],
    ]),
    cap: "campfire",
  });
  craft.interior({ room: { ...walls.interior, y: base.top } });

  // Garden: lantern posts by the path, flowers and bushes around the plot.
  const doorX = fp.x + 4;
  const front = fp.z + fp.d;
  craft.path({ from: { x: doorX, z: front }, to: { x: doorX, z: 15 }, y: 0 });
  for (const x of [doorX - 1, doorX + 1]) {
    ctx.set(x, 0, front + 1, mat.block("spruce_fence"));
    ctx.set(x, 1, front + 1, t.lantern);
  }
  craft.landscape({
    area: { x: 0, z: 0, w: 16, d: 16 },
    y: 0,
    ground: "grass_block",
    density: 0.16,
    avoid: [
      { x: fp.x - 1, z: fp.z - 1, w: fp.w + 3, d: fp.d + 2 },
      { x: doorX - 1, z: front, w: 3, d: 16 - front },
    ],
  });
}) satisfies BuildProgram;
