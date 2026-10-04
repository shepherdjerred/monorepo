import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";

/** A stone chapel: a long nave with tall windows, pews, and a bell tower. */
export default ((ctx) => {
  const { craft, mat } = ctx;
  const stone = mat.noise([
    ["stone_bricks", 5],
    ["cracked_stone_bricks", 1],
    ["andesite", 1],
  ]);
  const nave = { x: 4, z: 3, w: 9, d: 15 };
  const base = craft.foundation({ ...nave, y: 0, height: 1, material: stone });
  craft.floor({ x: 5, z: 4, w: 7, d: 13, y: 0, material: "polished_andesite" });
  const walls = craft.walls({
    ...nave,
    y: base.top,
    h: 6,
    frame: "stripped_oak_log",
    infill: stone,
    postEvery: 3,
    postsAt: { left: [0, 3, 6, 9, 12], right: [0, 3, 6, 9, 12] },
  });
  for (const face of [walls.faces.left, walls.faces.right]) {
    for (const at of [1, 4, 7, 10, 13]) {
      craft.window(face, { at, y: 1, w: 2, h: 3, sill: "stone_brick_stairs" });
    }
  }
  craft.window(walls.faces.back, { at: 3, y: 2, w: 3, h: 3 });
  craft.gableRoof({
    ...nave,
    y: walls.top,
    ridge: "z",
    stairs: "deepslate_tile_stairs",
    overhang: 1,
    gable: stone,
    eaves: true,
  });

  // Bell tower in front, with the entrance through its base.
  const tower = craft.tower({
    x: 8,
    z: nave.z + nave.d + 2,
    y: 1,
    shape: "square",
    radius: 2,
    h: 12,
    wall: stone,
    floor: "spruce_planks",
    floorEvery: 6,
    crenellations: false,
    door: { dir: "front", block: "spruce_door" },
  });
  craft.foundation({
    x: 6,
    z: nave.z + nave.d,
    w: 5,
    d: 5,
    y: 0,
    material: stone,
  });
  // Open the tower into the nave.
  ctx.fill({ x: 8, y: 1, z: nave.z + nave.d - 1, w: 1, h: 2, d: 2 }, ctx.AIR);
  craft.hipRoof({
    x: 6,
    z: nave.z + nave.d,
    w: 5,
    d: 5,
    y: tower.top,
    stairs: "deepslate_tile_stairs",
    overhang: 1,
    eaves: true,
  });
  ctx.set(
    8,
    tower.top - 1,
    nave.z + nave.d + 2,
    mat.block("bell", { attachment: "floor" }),
  );

  // Pews facing the altar at the back, and lights down the aisle.
  for (let z = nave.z + 5; z <= nave.z + nave.d - 4; z += 2) {
    for (const x of [5, 6, 10, 11]) {
      ctx.set(x, 1, z, mat.stairs("spruce_stairs", { ascend: "front" }));
    }
  }
  ctx.fill(
    { x: 7, y: 1, z: nave.z + 2, w: 3, h: 1, d: 1 },
    mat.block("quartz_block"),
  );
  ctx.set(8, 2, nave.z + 2, mat.block("candle", { lit: "true" }));
  for (const z of [nave.z + 4, nave.z + 9, nave.z + 13]) {
    ctx.set(8, 1, z, mat.block("lantern"));
  }

  craft.path({
    from: { x: 8, z: nave.z + nave.d + 5 },
    to: { x: 8, z: 25 },
    y: 0,
    width: 2,
  });
  craft.landscape({
    area: { x: 0, z: 0, w: 18, d: 27 },
    y: 0,
    ground: "grass_block",
    density: 0.1,
    avoid: [
      { x: nave.x - 2, z: nave.z - 2, w: nave.w + 4, d: nave.d + 3 },
      { x: 5, z: nave.z + nave.d, w: 7, d: 6 },
      { x: 7, z: nave.z + nave.d + 5, w: 4, d: 6 },
    ],
  });
}) satisfies BuildProgram;
