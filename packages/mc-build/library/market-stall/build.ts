import type {
  BuildContext,
  BuildProgram,
} from "@shepherdjerred/mc-build/dsl/context.ts";

/** One stall: fence posts, a striped sloped canopy, a counter and goods. */
type StallSpec = {
  x0: number;
  z0: number;
  colors: readonly [string, string];
  goods: readonly string[];
};

function stall(ctx: BuildContext, spec: StallSpec): void {
  const { x0, z0, colors, goods } = spec;
  const { mat } = ctx;
  const w = 5;
  const d = 3;
  for (const [x, z] of [
    [x0, z0],
    [x0 + w - 1, z0],
    [x0, z0 + d - 1],
    [x0 + w - 1, z0 + d - 1],
  ] as const) {
    const height = z === z0 ? 4 : 3;
    for (let y = 0; y < height; y += 1) {
      ctx.set(x, y, z, mat.block("spruce_fence"));
    }
  }
  // Canopy: higher at the back, sloping down over the counter, striped.
  for (let x = x0 - 1; x <= x0 + w; x += 1) {
    const color = colors[(x - x0 + 1) % 2] ?? colors[0];
    for (let dz = -1; dz <= d; dz += 1) {
      const y = dz <= 0 ? 4 : 3;
      ctx.set(x, y, z0 + dz, mat.block(`${color}_wool`));
    }
    ctx.set(x, 3, z0 - 1, mat.block(`${color}_wool`));
  }
  // Counter across the front with goods on it; storage at the back.
  for (let x = x0 + 1; x < x0 + w - 1; x += 1) {
    ctx.set(x, 0, z0 + d - 1, mat.block("barrel", { facing: "up" }));
    const good = goods[(x - x0 - 1) % goods.length];
    if (good !== undefined) {
      ctx.set(x, 1, z0 + d - 1, mat.block(good));
    }
    ctx.set(x, 0, z0, mat.block("chest", { facing: "south" }));
  }
  ctx.set(x0 + 2, 2, z0 + 1, mat.block("lantern", { hanging: "true" }));
}

/** A small market: two striped stalls on a cobbled square with a bench. */
export default ((ctx) => {
  const { craft, mat } = ctx;
  const cobbles = mat.noise([
    ["cobblestone", 4],
    ["stone_bricks", 3],
    ["andesite", 2],
    ["mossy_cobblestone", 1],
  ]);
  ctx.fill({ x: 1, y: -1, z: 1, w: 17, h: 1, d: 11 }, cobbles);
  stall(ctx, {
    x0: 3,
    z0: 3,
    colors: ["red", "white"],
    goods: ["melon", "pumpkin", "hay_block"],
  });
  stall(ctx, {
    x0: 11,
    z0: 3,
    colors: ["blue", "yellow"],
    goods: ["bookshelf", "flower_pot", "cake"],
  });
  // Benches facing the stalls and a lamp post between them.
  for (const x of [5, 6, 13, 14]) {
    ctx.set(x, 0, 9, mat.stairs("oak_stairs", { ascend: "front" }));
  }
  for (let y = 0; y < 3; y += 1) {
    ctx.set(9, y, 7, mat.block("dark_oak_fence"));
  }
  ctx.set(9, 3, 7, mat.block("lantern"));
  craft.landscape({
    area: { x: -1, z: -1, w: 21, d: 15 },
    y: 0,
    ground: "grass_block",
    density: 0.14,
    avoid: [{ x: 1, z: 1, w: 17, d: 11 }],
  });
}) satisfies BuildProgram;
