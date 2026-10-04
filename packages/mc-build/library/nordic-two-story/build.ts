import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";

/** A two-story nordic house: jettied upper floor, hip roof, porch, chimney. */
export default ((ctx) => {
  const { craft, mat } = ctx;
  const t = mat.theme("nordic");
  const fp = { x: 3, z: 3, w: 11, d: 9 };
  const base = craft.foundation({ ...fp, y: 0, material: t.foundation });
  craft.floor({ x: 4, z: 4, w: 9, d: 7, y: 0, material: t.floor });
  const ground = craft.walls({
    ...fp,
    y: base.top,
    h: 4,
    frame: t.frame,
    infill: t.infill,
    postEvery: 5,
    postsAt: { front: [4, 6] },
  });
  craft.door(ground.faces.front, { at: 5, door: t.door });
  for (const at of [1, 8]) {
    craft.window(ground.faces.front, {
      at,
      w: 2,
      sill: t.roof,
      shutters: t.shutter,
    });
  }
  for (const face of [ground.faces.left, ground.faces.right]) {
    craft.window(face, { at: 1, w: 3, sill: t.roof });
    craft.window(face, { at: 5, w: 2, sill: t.roof });
  }
  craft.window(ground.faces.back, { at: 2, w: 3, sill: t.roof });
  craft.window(ground.faces.back, { at: 6, w: 3, sill: t.roof });
  craft.interior({
    room: { ...ground.interior, y: base.top },
    wood: "dark_oak",
    bed: "blue",
  });

  // Upper story: a protruding floor band, then lighter plank walls.
  craft.floor({ x: 4, z: 4, w: 9, d: 7, y: ground.top - 1, material: t.floor });
  for (const face of Object.values(ground.faces)) {
    craft.trim(face, { v: 3, material: t.trim });
  }
  const upper = craft.walls({
    ...fp,
    y: ground.top,
    h: 3,
    frame: t.frame,
    infill: mat.palette([
      ["spruce_planks", 4],
      ["stripped_spruce_wood", 1],
    ]),
    postEvery: 5,
  });
  for (const face of [upper.faces.front, upper.faces.back]) {
    for (const at of [1, 4, 7]) {
      craft.window(face, { at, w: 2, h: 1 });
    }
  }
  for (const face of [upper.faces.left, upper.faces.right]) {
    craft.window(face, { at: 3, w: 3, h: 1 });
  }
  craft.hipRoof({
    ...fp,
    y: upper.top,
    stairs: t.roof,
    overhang: 1,
    eaves: true,
  });
  craft.chimney({
    x: fp.x + fp.w,
    z: fp.z + 2,
    base: 0,
    height: upper.top + 5,
    material: mat.noise([
      ["stone_bricks", 3],
      ["cobblestone", 2],
    ]),
    cap: "campfire",
  });
  craft.porch({
    face: ground.faces.front,
    at: 3,
    w: 5,
    depth: 2,
    floor: "spruce_planks",
    post: "dark_oak_fence",
    roof: "deepslate_tile_stairs",
    railing: "dark_oak_fence",
  });
  // The upper room is open to the attic: light both ends of it.
  ctx.set(5, ground.top, 6, t.lantern);
  ctx.set(11, ground.top, 8, t.lantern);

  const doorX = fp.x + 5;
  const front = fp.z + fp.d + 2;
  craft.path({ from: { x: doorX, z: front }, to: { x: doorX, z: 17 }, y: 0 });
  craft.landscape({
    area: { x: 0, z: 0, w: 18, d: 18 },
    y: 0,
    ground: "grass_block",
    flowers: ["cornflower", "azure_bluet", "lily_of_the_valley", "fern"],
    density: 0.14,
    avoid: [
      { x: fp.x - 1, z: fp.z - 1, w: fp.w + 3, d: fp.d + 4 },
      { x: doorX - 1, z: front, w: 3, d: 18 - front },
    ],
  });
}) satisfies BuildProgram;
