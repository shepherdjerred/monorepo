import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";

/** A stone watchtower with a battlemented curtain wall and a gatehouse door. */
export default ((ctx) => {
  const { craft, mat } = ctx;
  const stone = mat.noise([
    ["stone_bricks", 6],
    ["cracked_stone_bricks", 2],
    ["mossy_stone_bricks", 1],
    ["andesite", 1],
  ]);
  craft.foundation({ x: 3, z: 3, w: 9, d: 9, y: 0, material: stone });
  const tower = craft.tower({
    x: 7,
    z: 7,
    y: 1,
    shape: "square",
    radius: 3,
    h: 14,
    wall: stone,
    floor: "spruce_planks",
    floorEvery: 5,
    door: { dir: "front", block: "spruce_door" },
  });
  // Corbelled top: a stepped band of upside-down stairs under the parapet.
  for (let i = -4; i <= 4; i += 1) {
    for (const [x, z, ascend] of [
      [7 + i, 3, "front"],
      [7 + i, 11, "back"],
      [3, 7 + i, "right"],
      [11, 7 + i, "left"],
    ] as const) {
      if (Math.abs(i) <= 3) {
        ctx.set(
          x,
          tower.top - 2,
          z,
          mat.stairs("stone_brick_stairs", { ascend, half: "top" }),
        );
      }
    }
  }
  // A curtain wall running off to the left with merlons and a walkway.
  for (let x = 0; x < 4; x += 1) {
    for (let y = 0; y < 6; y += 1) {
      ctx.set(x, y, 6, stone);
      ctx.set(x, y, 7, stone);
      ctx.set(x, y, 8, stone);
    }
    if (x % 2 === 0) {
      ctx.set(x, 6, 6, stone);
      ctx.set(x, 6, 8, stone);
    }
  }
  // A banner pole and torches on the platform.
  ctx.set(7, tower.top, 7, mat.block("spruce_fence"));
  ctx.set(7, tower.top + 1, 7, mat.block("spruce_fence"));
  ctx.set(7, tower.top + 2, 7, mat.block("lantern"));
  craft.path({ from: { x: 7, z: 11 }, to: { x: 7, z: 14 }, y: 0, width: 2 });
  craft.landscape({
    area: { x: -1, z: 0, w: 17, d: 16 },
    y: 0,
    ground: "grass_block",
    density: 0.08,
    avoid: [
      { x: 2, z: 2, w: 11, d: 11 },
      { x: -1, z: 5, w: 4, d: 5 },
      { x: 6, z: 11, w: 4, d: 5 },
    ],
  });
}) satisfies BuildProgram;
