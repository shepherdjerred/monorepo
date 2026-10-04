import type {
  BuildContext,
  BuildProgram,
} from "@shepherdjerred/mc-build/dsl/context.ts";
import type { Material } from "@shepherdjerred/mc-build/dsl/types.ts";

const LENGTH = 21;
const WIDTH = 3;
const Z0 = 6;
const CANAL_X = 6;
const CANAL_W = 9;

/** Dirt body under the plot and a walled canal cut into it, closed at both ends. */
function canal(ctx: BuildContext, stone: Material): void {
  ctx.fill({ x: -2, y: -4, z: 0, w: 25, h: 3, d: 15 }, ctx.mat.block("dirt"));
  const water = ctx.mat.block("water");
  for (let z = 0; z < 15; z += 1) {
    for (let x = CANAL_X; x < CANAL_X + CANAL_W; x += 1) {
      const bank =
        x === CANAL_X || x === CANAL_X + CANAL_W - 1 || z === 0 || z === 14;
      ctx.set(x, -4, z, stone);
      ctx.fill({ x, y: -3, z, w: 1, h: 2, d: 1 }, bank ? stone : water);
      ctx.set(x, -1, z, bank ? stone : ctx.AIR);
    }
  }
}

/** Deck height above ground at x: rises in two steps toward the middle. */
function rise(x: number): number {
  const fromCenter = Math.abs(x - 10);
  if (fromCenter >= 7) {
    return 0;
  }
  return fromCenter >= 4 ? 1 : 2;
}

/** The deck and its brick-wall railings. */
function deck(ctx: BuildContext, stone: Material): void {
  const railing = ctx.mat.block("stone_brick_wall");
  for (let x = 0; x < LENGTH; x += 1) {
    const top = rise(x) - 1;
    ctx.fill({ x, y: -1, z: Z0, w: 1, h: top + 2, d: WIDTH }, stone);
    for (const z of [Z0 - 1, Z0 + WIDTH]) {
      ctx.set(x, top, z, stone);
      ctx.set(x, top + 1, z, railing);
    }
  }
}

/** Upside-down stairs and top slabs shaping an arch under the span. */
function arch(ctx: BuildContext, stone: Material): void {
  const { mat } = ctx;
  const slab = mat.block("stone_brick_slab", { type: "top" });
  for (let z = Z0 - 1; z <= Z0 + WIDTH; z += 1) {
    ctx.set(
      7,
      -1,
      z,
      mat.stairs("stone_brick_stairs", { ascend: "left", half: "top" }),
    );
    ctx.set(
      13,
      -1,
      z,
      mat.stairs("stone_brick_stairs", { ascend: "right", half: "top" }),
    );
    for (let x = 8; x <= 12; x += 1) {
      ctx.set(x, -1, z, x === 10 ? stone : slab);
    }
  }
}

/** Wall-post lamps at both ends of the bridge. */
function lamps(ctx: BuildContext): void {
  const { mat } = ctx;
  for (const x of [0, LENGTH - 1]) {
    for (const z of [Z0 - 1, Z0 + WIDTH]) {
      ctx.fill({ x, y: 0, z, w: 1, h: 2, d: 1 }, mat.block("stone_brick_wall"));
      ctx.set(x, 2, z, mat.block("lantern"));
    }
  }
}

/** An arched stone bridge over a canal, with wall railings and lamp posts. */
export default ((ctx) => {
  const stone = ctx.mat.noise([
    ["stone_bricks", 5],
    ["mossy_stone_bricks", 2],
    ["cracked_stone_bricks", 1],
  ]);
  canal(ctx, stone);
  deck(ctx, stone);
  arch(ctx, stone);
  lamps(ctx);
  ctx.craft.landscape({
    area: { x: -2, z: 0, w: 25, d: 15 },
    y: 0,
    ground: "grass_block",
    density: 0.12,
    avoid: [
      { x: CANAL_X, z: 0, w: CANAL_W, d: 15 },
      { x: -2, z: Z0 - 1, w: 25, d: WIDTH + 2 },
    ],
  });
}) satisfies BuildProgram;
