import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";

type Context = Parameters<BuildProgram>[0];
type Material = Parameters<Context["fill"]>[1];
type Point = readonly [number, number, number];
type Cell = { x: number; y: number; z: number };
type Deck = Map<string, Cell>;

export type BeaconOptions = {
  path: readonly Point[];
  palette: "stone" | "sand" | "red" | "cherry" | "mushroom";
};

const DIRECTIONS = [
  { dx: 1, dz: 0, dir: "right" },
  { dx: -1, dz: 0, dir: "left" },
  { dx: 0, dz: 1, dir: "front" },
  { dx: 0, dz: -1, dir: "back" },
] as const;
const key = (x: number, z: number) => `${x.toString()},${z.toString()}`;
const edge = (deck: Deck, cell: Cell) =>
  DIRECTIONS.some(({ dx, dz }) => !deck.has(key(cell.x + dx, cell.z + dz)));

function boxes(ctx: Context) {
  return ([x, y, z]: Point, [w, h, d]: Point, material: Material) => {
    ctx.fill({ x, y, z, w, h, d }, material);
  };
}

function apron(
  deck: Deck,
  [x0, x1, z0, z1]: readonly [number, number, number, number],
): void {
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) deck.set(key(x, z), { x, y: 0, z });
}

function planDeck(points: readonly Point[]): Deck {
  const deck: Deck = new Map();
  for (const [x, y, z] of points) {
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const at = key(x + dx, z + dz),
          previous = deck.get(at);
        if (previous === undefined || previous.y < y)
          deck.set(at, { x: x + dx, y, z: z + dz });
      }
  }
  for (const rectangle of [
    [-5, 5, -12, -6],
    [-5, 5, 6, 12],
    [6, 12, -5, 5],
    [-12, -6, -7, -3],
  ] as const)
    apron(deck, rectangle);
  return deck;
}

function surfaceDeck(ctx: Context, deck: Deck, wood: string): void {
  for (const cell of deck.values()) {
    const { x, y, z } = cell;
    ctx.clear({ x, y, z, w: 1, h: 4, d: 1 });
    ctx.set(x, y - 1, z, ctx.mat.block(`${wood}_planks`));
    ctx.set(x, y - 2, z, ctx.mat.block(`stripped_${wood}_log`, { axis: "z" }));
    if (!edge(deck, cell)) {
      const up = DIRECTIONS.find(
        ({ dx, dz }) => deck.get(key(x + dx, z + dz))?.y === y + 1,
      );
      if (up !== undefined)
        ctx.set(
          x,
          y,
          z,
          ctx.mat.stairs("stone_brick_stairs", { ascend: up.dir }),
        );
    }
  }
}

function openLanding(ctx: Context, points: readonly Point[]): void {
  const last = points.at(-1),
    before = points.at(-2);
  if (last === undefined || before === undefined)
    throw new Error("An approach needs a surveyed entrance");
  const dx = last[0] - before[0],
    dz = last[2] - before[2];
  for (let forward = 0; forward <= 2; forward++)
    for (let side = -1; side <= 1; side++) {
      ctx.clear({
        x: last[0] + dx * forward + dz * side,
        y: last[1],
        z: last[2] + dz * forward - dx * side,
        w: 1,
        h: 4,
        d: 1,
      });
    }
}

function guardDeck(ctx: Context, deck: Deck, wood: string): void {
  let index = 0;
  for (const cell of deck.values()) {
    const { x, y, z } = cell;
    if (Math.max(Math.abs(x), Math.abs(z)) < 9 || !edge(deck, cell)) continue;
    ctx.set(x, y, z, ctx.mat.block(`${wood}_fence`));
    if (index++ % 12 === 0) {
      ctx.fill({ x, y, z, w: 1, h: 2, d: 1 }, "tuff_brick_wall");
      ctx.set(x, y + 2, z, ctx.mat.block("lantern"));
    }
  }
}

function corner(ctx: Context, [sx, sz]: readonly [number, number]): void {
  const box = boxes(ctx);
  const x = sx < 0 ? -8 : 7,
    z = sz < 0 ? -8 : 7;
  box([x, 0, z], [2, 22, 2], "polished_andesite");
  box([x, 3, z], [2, 2, 2], "chiseled_tuff_bricks");
  box([x, 15, z], [2, 2, 2], "chiseled_tuff_bricks");
  box([sx < 0 ? -10 : 9, 0, z], [1, 6, 2], "polished_andesite");
  box([x, 0, sz < 0 ? -10 : 9], [2, 6, 1], "polished_andesite");
  box([sx < 0 ? -10 : 7, 0, z], [4, 1, 2], "polished_andesite");
  box([x, 0, sz < 0 ? -10 : 7], [2, 1, 4], "polished_andesite");
}

function foundation(ctx: Context, stone: Material): void {
  const { craft } = ctx;
  ctx.clear({ x: -11, y: 0, z: -11, w: 23, h: 33, d: 23 });
  for (const [radius, y] of [
    [4, -4],
    [5, -3],
    [6, -2],
    [8, -1],
  ] as const)
    ctx.fill(
      { x: -radius, y, z: -radius, w: radius * 2 + 1, h: 1, d: radius * 2 + 1 },
      stone,
    );
  craft.tower({
    x: 0,
    z: 0,
    y: 0,
    shape: "square",
    radius: 7,
    h: 21,
    wall: stone,
    floor: "polished_andesite",
    floorEvery: 24,
    crenellations: false,
    slits: false,
  });
  ctx.clear({ x: -6, y: 0, z: -6, w: 13, h: 24, d: 13 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) corner(ctx, [sx, sz]);
}

function entries(ctx: Context): void {
  const box = boxes(ctx);
  ctx.clear({ x: -2, y: 0, z: -7, w: 5, h: 5, d: 1 });
  box([-3, 0, -8], [1, 5, 2], "polished_andesite");
  box([3, 0, -8], [1, 5, 2], "polished_andesite");
  box([-2, 5, -8], [5, 1, 2], "chiseled_tuff_bricks");
  ctx.clear({ x: -2, y: 0, z: 7, w: 5, h: 5, d: 1 });
  box([-3, 0, 7], [1, 5, 2], "polished_andesite");
  box([3, 0, 7], [1, 5, 2], "polished_andesite");
  box([-2, 5, 7], [5, 1, 2], "chiseled_tuff_bricks");
  ctx.clear({ x: 7, y: 0, z: -2, w: 1, h: 5, d: 5 });
  box([7, 0, -3], [2, 5, 1], "polished_andesite");
  box([7, 0, 3], [2, 5, 1], "polished_andesite");
  box([7, 5, -2], [2, 1, 5], "chiseled_tuff_bricks");
  ctx.clear({ x: -7, y: 0, z: -6, w: 1, h: 4, d: 3 });
  box([-8, 0, -7], [2, 4, 1], "polished_andesite");
  box([-8, 0, -3], [2, 4, 1], "polished_andesite");
  box([-8, 4, -6], [2, 1, 3], "chiseled_tuff_bricks");
}

function windows(ctx: Context): void {
  const { mat } = ctx;
  const box = boxes(ctx);
  for (let y = 3; y <= 19; y++)
    for (let u = -2; u <= 2; u++) {
      ctx.set(u, y, 7, mat.block("cyan_stained_glass_pane"));
      ctx.set(-7, y, u, mat.block("cyan_stained_glass_pane"));
      ctx.set(7, y, u, mat.block("cyan_stained_glass_pane"));
      if (y >= 7) ctx.set(u, y, -7, mat.block("cyan_stained_glass_pane"));
    }
  for (const y of [6, 13, 20]) {
    box([-6, y, -8], [13, 1, 1], "polished_andesite");
    box([-6, y, 8], [13, 1, 1], "polished_andesite");
    box([-8, y, -6], [1, 1, 13], "polished_andesite");
    box([8, y, -6], [1, 1, 13], "polished_andesite");
  }
}

function core(ctx: Context): void {
  const { mat } = ctx;
  const box = boxes(ctx);
  box([-1, 0, -1], [3, 21, 3], "polished_tuff");
  for (const y of [1, 7, 13, 19]) {
    box([-1, y, -1], [3, 1, 3], "sea_lantern");
    for (let u = -1; u <= 1; u++) {
      ctx.set(u, y, -2, mat.block("cyan_stained_glass_pane"));
      ctx.set(u, y, 2, mat.block("cyan_stained_glass_pane"));
      ctx.set(-2, y, u, mat.block("cyan_stained_glass_pane"));
      ctx.set(2, y, u, mat.block("cyan_stained_glass_pane"));
    }
  }
}

function terrace(ctx: Context, stone: Material): void {
  for (const [r, y] of [
    [8, 21],
    [9, 22],
    [10, 23],
  ] as const)
    ctx.fill({ x: -r, y, z: -r, w: r * 2 + 1, h: 1, d: r * 2 + 1 }, stone);
  ctx.clear({ x: -6, y: 19, z: -6, w: 12, h: 5, d: 3 });
}

function stairs(ctx: Context): void {
  const { mat } = ctx;
  const box = boxes(ctx);
  box([-6, -1, -6], [3, 1, 3], "polished_andesite");
  box([-6, 5, 3], [3, 1, 3], "polished_andesite");
  box([3, 11, 3], [3, 1, 3], "polished_andesite");
  box([3, 17, -6], [3, 1, 3], "polished_andesite");
  box([-6, 23, -6], [3, 1, 3], "polished_andesite");
  for (let s = 0; s < 6; s++) {
    for (let w = 0; w < 3; w++) {
      box([-6 + w, s - 2, -3 + s], [1, 2, 1], "polished_andesite");
      box([-3 + s, 4 + s, 3 + w], [1, 2, 1], "polished_andesite");
      box([3 + w, 10 + s, 2 - s], [1, 2, 1], "polished_andesite");
      box([2 - s, 16 + s, -6 + w], [1, 2, 1], "polished_andesite");
      ctx.set(
        -6 + w,
        s,
        -3 + s,
        mat.stairs("stone_brick_stairs", { ascend: "front" }),
      );
      ctx.set(
        -3 + s,
        6 + s,
        3 + w,
        mat.stairs("stone_brick_stairs", { ascend: "right" }),
      );
      ctx.set(
        3 + w,
        12 + s,
        2 - s,
        mat.stairs("stone_brick_stairs", { ascend: "back" }),
      );
      ctx.set(
        2 - s,
        18 + s,
        -6 + w,
        mat.stairs("stone_brick_stairs", { ascend: "left" }),
      );
    }
    ctx.set(-3, s, -3 + s, mat.block("polished_andesite"));
    ctx.set(-3, s + 1, -3 + s, mat.block("tuff_brick_wall"));
    ctx.set(-3 + s, 6 + s, 2, mat.block("polished_andesite"));
    ctx.set(-3 + s, 7 + s, 2, mat.block("tuff_brick_wall"));
    ctx.set(2, 12 + s, 2 - s, mat.block("polished_andesite"));
    ctx.set(2, 13 + s, 2 - s, mat.block("tuff_brick_wall"));
    ctx.set(2 - s, 18 + s, -3, mat.block("polished_andesite"));
    ctx.set(2 - s, 19 + s, -3, mat.block("tuff_brick_wall"));
  }
  // Landing end stops make every turn obvious and prevent walking off a flight into the void inside.
  box([-6, 5, 6], [3, 1, 1], "polished_andesite");
  box([-6, 6, 6], [3, 1, 1], "tuff_brick_wall");
  box([6, 11, 3], [1, 1, 3], "polished_andesite");
  box([6, 12, 3], [1, 1, 3], "tuff_brick_wall");
}

function roof(ctx: Context): void {
  const { mat } = ctx;
  const box = boxes(ctx);
  for (let u = -10; u <= 10; u++) {
    for (const z of [-10, 10]) ctx.set(u, 24, z, mat.block("tuff_brick_wall"));
    for (const x of [-10, 10]) ctx.set(x, 24, u, mat.block("tuff_brick_wall"));
  }
  for (let x = -3; x <= 5; x++)
    ctx.set(x, 24, -3, mat.block("tuff_brick_wall"));
  for (let x = -6; x <= 5; x++)
    ctx.set(x, 24, -7, mat.block("tuff_brick_wall"));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      box([sx * 8, 24, sz * 8], [1, 4, 1], "polished_andesite");
      ctx.set(sx * 8, 28, sz * 8, mat.block("sea_lantern"));
      ctx.set(sx * 8, 29, sz * 8, mat.block("oxidized_cut_copper_slab"));
    }
  // One taller broken obelisk gives each beacon a recognisable, asymmetric skyline.
  box([6, 24, 6], [3, 7, 3], "chiseled_tuff_bricks");
  box([7, 26, 5], [1, 4, 1], "cyan_stained_glass_pane");
  box([5, 26, 7], [1, 4, 1], "cyan_stained_glass_pane");
  box([6, 31, 6], [3, 1, 3], "polished_andesite");
  ctx.set(7, 31, 7, mat.block("sea_lantern"));
  ctx.set(7, 32, 7, mat.block("oxidized_cut_copper_slab"));
  box([-1, 23, -1], [3, 1, 3], "dark_prismarine");
  ctx.set(0, 23, 0, mat.block("sea_lantern"));
  box([3, 24, 0], [1, 2, 1], "chiseled_tuff_bricks");
  ctx.set(
    2,
    25,
    0,
    mat.block("stone_button", {
      face: "wall",
      facing: "west",
      powered: "false",
    }),
  );
  ctx.clear({ x: -1, y: 24, z: -1, w: 3, h: 9, d: 3 });
}

function mouths(ctx: Context, wood: string): void {
  const box = boxes(ctx);
  box([-2, -1, -11], [5, 1, 5], wood + "_planks");
  ctx.clear({ x: -1, y: 0, z: -11, w: 3, h: 4, d: 5 });
  ctx.clear({ x: -1, y: 0, z: 7, w: 3, h: 4, d: 5 });
  ctx.clear({ x: 7, y: 0, z: -1, w: 5, h: 4, d: 3 });
  ctx.clear({ x: -11, y: 0, z: -6, w: 5, h: 4, d: 3 });
}

/** Ancient beacon derived from the curated watchtower, fitted to a captured island and surveyed route. */
export function beacon(ctx: Context, options: BeaconOptions): void {
  if (ctx.site === null)
    throw new Error("Capture the real island before compiling");
  const stones =
    options.palette === "sand"
      ? (["cut_sandstone", "smooth_sandstone", "sandstone"] as const)
      : options.palette === "red"
        ? ([
            "cut_red_sandstone",
            "smooth_red_sandstone",
            "red_sandstone",
          ] as const)
        : (["tuff_bricks", "stone_bricks", "mossy_stone_bricks"] as const);
  const stone = ctx.mat.noise(
    [
      [stones[0], 6],
      [stones[1], 3],
      [stones[2], 1],
    ],
    { scale: 4 },
  );
  const wood =
    options.palette === "cherry"
      ? "cherry"
      : options.palette === "mushroom"
        ? "dark_oak"
        : "spruce";
  const deck = planDeck(options.path);
  surfaceDeck(ctx, deck, wood);
  foundation(ctx, stone);
  entries(ctx);
  windows(ctx);
  core(ctx);
  terrace(ctx, stone);
  stairs(ctx);
  roof(ctx);
  mouths(ctx, wood);
  guardDeck(ctx, deck, wood);
  openLanding(ctx, options.path);
}
