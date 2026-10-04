import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";

/** A two-story nordic house: stacked timber walls, hip roof, side chimney. */
export default ((ctx) => {
  const { craft, mat } = ctx;
  const theme = mat.theme("nordic");
  const fp = { x: 0, z: 0, w: 11, d: 9 };
  const base = craft.foundation({ ...fp, y: 0, material: theme.foundation });
  craft.floor({
    x: 1,
    z: 1,
    w: 9,
    d: 7,
    y: base.top - 1,
    material: theme.floor,
  });

  const ground = craft.walls({
    ...fp,
    y: base.top,
    h: 4,
    frame: theme.frame,
    infill: theme.infill,
    postEvery: 5,
    postsAt: { front: [4, 6] },
  });
  craft.door(ground.faces.front, { at: 5, door: theme.door });
  for (const at of [1, 8]) {
    craft.window(ground.faces.front, {
      at,
      y: 1,
      w: 2,
      h: 2,
      sill: theme.roof,
      shutters: theme.shutter,
    });
  }
  for (const face of [ground.faces.left, ground.faces.right]) {
    craft.window(face, { at: 3, y: 1, w: 3, h: 2, sill: theme.roof });
  }

  // Second story on the first: a jettied floor band, then shorter walls.
  craft.floor({
    x: 1,
    z: 1,
    w: 9,
    d: 7,
    y: ground.top - 1,
    material: theme.floor,
  });
  craft.trim(ground.faces.front, { v: 3, material: theme.trim });
  craft.trim(ground.faces.back, { v: 3, material: theme.trim });
  const upper = craft.walls({
    ...fp,
    y: ground.top,
    h: 3,
    frame: theme.frame,
    infill: mat.palette([
      ["spruce_planks", 4],
      ["stripped_spruce_wood", 1],
    ]),
    postEvery: 5,
  });
  for (const at of [2, 7]) {
    craft.window(upper.faces.front, { at, y: 1, w: 2, h: 1 });
    craft.window(upper.faces.back, { at, y: 1, w: 2, h: 1 });
  }

  craft.hipRoof({
    ...fp,
    y: upper.top,
    stairs: theme.roof,
    overhang: 1,
    eaves: true,
  });
  // An exterior stack against the right wall, cutting through the eaves.
  craft.chimney({
    x: fp.x + fp.w,
    z: 1,
    base: 0,
    height: upper.top + 4,
    material: mat.noise([
      ["stone_bricks", 3],
      ["cobblestone", 2],
    ]),
    cap: "campfire",
  });
  ctx.set(2, base.top, 2, theme.lantern);
  ctx.set(8, base.top, 6, theme.lantern);
  // The upper room is open to the attic under the hip roof: light both ends.
  ctx.set(2, ground.top, 2, theme.lantern);
  ctx.set(8, ground.top, 6, theme.lantern);
}) satisfies BuildProgram;
