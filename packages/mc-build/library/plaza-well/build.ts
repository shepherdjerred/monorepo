import type {
  BuildContext,
  BuildProgram,
} from "@shepherdjerred/mc-build/dsl/context.ts";

const C = 8;

/** A round cobble plaza on a dirt bed. */
function plaza(ctx: BuildContext): void {
  const cobbles = ctx.mat.noise([
    ["cobblestone", 4],
    ["stone_bricks", 2],
    ["andesite", 1],
    ["mossy_cobblestone", 1],
  ]);
  ctx.fill({ x: -2, y: -2, z: -2, w: 21, h: 1, d: 21 }, ctx.mat.block("dirt"));
  for (let x = 0; x <= 16; x += 1) {
    for (let z = 0; z <= 16; z += 1) {
      if ((x - C) ** 2 + (z - C) ** 2 <= 6.5 ** 2) {
        ctx.set(x, -1, z, cobbles);
      }
    }
  }
}

/** 3×3 water inside a 5×5 stone rim, corner posts, a hip roof and a lantern. */
function well(ctx: BuildContext): void {
  const { mat, craft } = ctx;
  for (let x = C - 2; x <= C + 2; x += 1) {
    for (let z = C - 2; z <= C + 2; z += 1) {
      const rim = Math.abs(x - C) === 2 || Math.abs(z - C) === 2;
      ctx.set(x, -2, z, mat.block("stone_bricks"));
      ctx.set(x, -1, z, mat.block(rim ? "stone_bricks" : "water"));
      if (rim) {
        ctx.set(x, 0, z, mat.block("stone_brick_wall"));
      }
    }
  }
  for (const [dx, dz] of [
    [-2, -2],
    [2, -2],
    [-2, 2],
    [2, 2],
  ] as const) {
    ctx.fill(
      { x: C + dx, y: 1, z: C + dz, w: 1, h: 3, d: 1 },
      mat.block("spruce_fence"),
    );
  }
  craft.hipRoof({
    x: C - 2,
    z: C - 2,
    w: 5,
    d: 5,
    y: 4,
    stairs: "spruce_stairs",
    overhang: 0,
  });
  ctx.set(C, 4, C, mat.block("iron_chain"));
  ctx.set(C, 3, C, mat.block("lantern", { hanging: "true" }));
}

/** Benches facing the well on four sides. */
function benches(ctx: BuildContext): void {
  for (const [dx, dz, ascend] of [
    [0, -5, "back"],
    [0, 5, "front"],
    [-5, 0, "left"],
    [5, 0, "right"],
  ] as const) {
    for (const o of [-1, 0, 1]) {
      ctx.set(
        C + dx + (dx === 0 ? o : 0),
        0,
        C + dz + (dz === 0 ? o : 0),
        ctx.mat.stairs("oak_stairs", { ascend }),
      );
    }
  }
}

/** Leaf planters with lamp posts beside them on the diagonals. */
function planters(ctx: BuildContext): void {
  const { mat } = ctx;
  for (const [dx, dz] of [
    [-4, -4],
    [4, -4],
    [-4, 4],
    [4, 4],
  ] as const) {
    const x = C + dx;
    const z = C + dz;
    ctx.set(x, -1, z, mat.block("grass_block"));
    ctx.set(x, 0, z, mat.block("oak_leaves", { persistent: "true" }));
    const post = x + Math.sign(dx);
    ctx.fill(
      { x: post, y: 0, z, w: 1, h: 3, d: 1 },
      mat.block("dark_oak_fence"),
    );
    ctx.set(post, 3, z, mat.block("lantern"));
  }
}

/** A village well on a cobbled plaza with benches, planters and lamp posts. */
export default ((ctx) => {
  plaza(ctx);
  well(ctx);
  benches(ctx);
  planters(ctx);
  ctx.craft.landscape({
    area: { x: -2, z: -2, w: 21, d: 21 },
    y: 0,
    ground: "grass_block",
    density: 0.15,
    avoid: [{ x: 1, z: 1, w: 15, d: 15 }],
  });
}) satisfies BuildProgram;
