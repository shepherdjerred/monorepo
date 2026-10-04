import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";

/** A 9×7 medieval cottage: timber frame, recessed plaster, gable roof. */
export default ((ctx) => {
  const { craft, mat } = ctx;
  const theme = mat.theme("medieval");
  const fp = { x: 0, z: 0, w: 9, d: 7 };
  const base = craft.foundation({ ...fp, y: 0, material: theme.foundation });
  craft.floor({
    x: 1,
    z: 1,
    w: 7,
    d: 5,
    y: base.top - 1,
    material: theme.floor,
  });
  const walls = craft.walls({
    ...fp,
    y: base.top,
    h: 4,
    frame: theme.frame,
    infill: theme.infill,
    postEvery: 4,
    // Posts either side of the door instead of one through it.
    postsAt: { front: [3, 5] },
  });
  craft.door(walls.faces.front, { at: 4, door: theme.door });
  for (const at of [1, 6]) {
    craft.window(walls.faces.front, { at, y: 1, w: 2, h: 2, sill: theme.roof });
  }
  craft.window(walls.faces.back, { at: 4, y: 1, w: 1, h: 2, sill: theme.roof });
  for (const face of [walls.faces.left, walls.faces.right]) {
    craft.window(face, { at: 2, y: 1, w: 3, h: 2, sill: theme.roof });
  }
  craft.gableRoof({
    ...fp,
    y: walls.top,
    ridge: "x",
    stairs: theme.roof,
    overhang: 1,
    gable: theme.trim,
    eaves: true,
  });
  // Lanterns on the floor in two corners keep the interior lit.
  ctx.set(2, base.top, 2, theme.lantern);
  ctx.set(6, base.top, 4, theme.lantern);
}) satisfies BuildProgram;
