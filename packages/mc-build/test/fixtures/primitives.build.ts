import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";

/**
 * Every newer craft primitive on one plot: a round tower with a conical roof,
 * a battlemented square tower, a mansard house with dormers, a porch, a
 * furnished interior, a path and landscaping.
 */
export default ((ctx) => {
  const { craft, mat } = ctx;
  const stone = mat.noise([
    ["stone_bricks", 5],
    ["cracked_stone_bricks", 2],
    ["andesite", 1],
  ]);
  const plot = { x: -2, z: -2, w: 34, d: 24 };

  // A mansard house with two dormers and a front porch.
  const house = { x: 2, z: 4, w: 11, d: 9 };
  const base = craft.foundation({ ...house, y: 0, material: stone });
  const walls = craft.walls({
    ...house,
    y: base.top,
    h: 4,
    frame: "dark_oak_log",
    infill: "white_terracotta",
    postEvery: 5,
    postsAt: { front: [4, 6] },
  });
  craft.floor({
    x: 3,
    z: 5,
    w: 9,
    d: 7,
    y: base.top - 1,
    material: "oak_planks",
  });
  craft.door(walls.faces.front, { at: 5, door: "dark_oak_door" });
  for (const at of [1, 8]) {
    craft.window(walls.faces.front, {
      at,
      y: 1,
      w: 2,
      h: 2,
      sill: "dark_oak_stairs",
    });
  }
  craft.interior({ room: { ...walls.interior, y: base.top } });
  const roof = craft.mansardRoof({
    ...house,
    y: walls.top,
    wall: "deepslate_tiles",
    stairs: "deepslate_tile_stairs",
    steps: 2,
  });
  craft.dormer({
    x: 3,
    z: 11,
    w: 3,
    d: 2,
    y: walls.top,
    facing: "front",
    wall: "white_terracotta",
    stairs: "dark_oak_stairs",
  });
  craft.dormer({
    x: 9,
    z: 11,
    w: 3,
    d: 2,
    y: walls.top,
    facing: "front",
    wall: "white_terracotta",
    stairs: "dark_oak_stairs",
  });
  craft.porch({
    face: walls.faces.front,
    at: 3,
    w: 5,
    depth: 2,
    floor: "spruce_planks",
    post: "spruce_fence",
    roof: "spruce_stairs",
    railing: "spruce_fence",
  });
  ctx.log(`mansard top ${roof.top.toString()}`);

  // A round tower with a conical roof.
  const round = craft.tower({
    x: 20,
    z: 8,
    y: 0,
    shape: "round",
    radius: 3,
    h: 11,
    wall: stone,
    floor: "spruce_planks",
    crenellations: false,
    door: { dir: "front", block: "spruce_door" },
  });
  craft.conicalRoof({
    x: 20,
    z: 8,
    y: round.top,
    radius: 3,
    stairs: "dark_oak_stairs",
    peak: "lightning_rod",
  });

  // A battlemented square tower.
  craft.tower({
    x: 27,
    z: 15,
    y: 0,
    shape: "square",
    radius: 2,
    h: 8,
    wall: stone,
    door: { dir: "left", block: "spruce_door" },
  });

  craft.path({ from: { x: 7, z: 20 }, to: { x: 7, z: 16 }, y: 0, width: 2 });
  craft.path({ from: { x: 9, z: 18 }, to: { x: 20, z: 12 }, y: 0 });
  craft.landscape({
    area: plot,
    y: 0,
    ground: "grass_block",
    density: 0.1,
    avoid: [
      { x: 1, z: 3, w: 13, d: 13 },
      { x: 16, z: 4, w: 9, d: 9 },
      { x: 24, z: 12, w: 7, d: 7 },
      { x: 6, z: 15, w: 16, d: 7 },
    ],
  });
}) satisfies BuildProgram;
