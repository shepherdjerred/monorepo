import type { BuildContext } from "@shepherdjerred/mc-build/dsl/context.ts";

/** Arena architecture primitives; all positions are local to the authored canvas. */
export function box(
  ctx: BuildContext,
  ...shape: [
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: string,
  ]
) {
  const [x, y, z, w, h, d, material] = shape;
  ctx.fill({ x, y, z, w, h, d }, material);
}

export function ground(
  ctx: BuildContext,
  w: number,
  d: number,
  ...palette: [top: string, rock?: string]
) {
  const [top, rock = "stone"] = palette;
  box(ctx, 0, 0, 0, w, 8, d, rock);
  box(ctx, 0, 8, 0, w, 1, d, top);
  // Explicit empty corner fixes export dimensions, including room for flying visitors.
  ctx.set(w - 1, 47, d - 1, "air");
}

export function boundary(
  ctx: BuildContext,
  w: number,
  d: number,
  material: string,
) {
  box(ctx, 0, 9, 0, w, 4, 2, material);
  box(ctx, 0, 9, d - 2, w, 4, 2, material);
  box(ctx, 0, 9, 0, 2, 4, d, material);
  box(ctx, w - 2, 9, 0, 2, 4, d, material);
  for (let x = 3; x < w - 3; x += 9) {
    box(ctx, x, 9, 1, 2, 6, 2, material);
    box(ctx, x, 9, d - 3, 2, 6, 2, material);
  }
}

export function hall(
  ctx: BuildContext,
  x: number,
  z: number,
  ...design: [
    w: number,
    d: number,
    wall: string,
    roof: string,
    y?: number,
    h?: number,
  ]
) {
  const [w, d, wall, roof, y = 9, h = 7] = design;
  box(ctx, x, y - 1, z, w, 1, d, "stone_bricks");
  box(ctx, x, y, z, w, h, d, wall);
  ctx.clear({ x: x + 1, y, z: z + 1, w: w - 2, h: h - 1, d: d - 2 });
  // Wide opposing entrances create a real through-route rather than a dead end.
  ctx.clear({ x, y, z: z + Math.floor(d / 2) - 2, w, h: 4, d: 5 });
  ctx.clear({ x: x + Math.floor(w / 2) - 2, y, z, w: 5, h: 4, d });
  for (let dx = 0; dx < w; dx += 5) {
    box(ctx, x + dx, y, z, 1, h + 1, 1, "stripped_dark_oak_log");
    box(ctx, x + dx, y, z + d - 1, 1, h + 1, 1, "stripped_dark_oak_log");
  }
  if (roof.endsWith("_slab")) {
    const block =
      roof === "dark_oak_slab" ? "dark_oak_planks" : roof.replace("_slab", "");
    box(ctx, x - 1, y + h, z - 1, w + 2, 1, d + 2, block);
    box(ctx, x - 1, y + h + 1, z - 1, w + 2, 1, 1, roof);
    box(ctx, x - 1, y + h + 1, z + d, w + 2, 1, 1, roof);
    box(ctx, x - 1, y + h + 1, z, 1, 1, d, roof);
    box(ctx, x + w, y + h + 1, z, 1, 1, d, roof);
  } else if (roof === "deepslate_tile_stairs") {
    ctx.craft.hipRoof({ x, z, w, d, y: y + h, stairs: roof, overhang: 2 });
  } else {
    ctx.craft.gableRoof({
      x,
      z,
      w,
      d,
      y: y + h,
      ridge: "z",
      stairs: roof,
      overhang: 1,
      gable: wall,
    });
  }
  for (let dx = 3; dx < w - 2; dx += 5) {
    if (Math.abs(dx - Math.floor(w / 2)) < 4) continue;
    box(ctx, x + dx, y + 2, z, 2, 2, 1, "gray_stained_glass");
    box(ctx, x + dx, y + 2, z + d - 1, 2, 2, 1, "gray_stained_glass");
  }
  for (const dx of [3, w - 4]) {
    box(ctx, x + dx, y, z + 2, 1, 1, 1, "stone_bricks");
    box(ctx, x + dx, y + 1, z + 2, 1, 1, 1, "glowstone");
    box(ctx, x + dx, y, z + d - 3, 1, 1, 1, "stone_bricks");
    box(ctx, x + dx, y + 1, z + d - 3, 1, 1, 1, "glowstone");
  }
}

/** Consolidate noisy rock columns: thin detached chips become supported stone spires. */
export function solidOutcrop(
  ctx: BuildContext,
  x: number,
  z: number,
  size: number,
) {
  for (let sx = x - size - 5; sx <= x + size + 5; sx++)
    for (let sz = z - size - 5; sz <= z + size + 5; sz++) {
      solidColumn(ctx, sx, sz);
    }
}

function solidColumn(ctx: BuildContext, x: number, z: number) {
  const empty = (y: number) =>
    ctx.get(x, y, z) === ctx.KEEP || ctx.get(x, y, z) === ctx.AIR;
  let top = 40;
  while (top > 8 && empty(top)) top--;
  if (top <= 8) return;
  for (let y = top - 1; y >= 4; y--)
    if (empty(y)) ctx.set(x, y, z, ctx.get(x, top, z));
}

export function crates(
  ctx: BuildContext,
  x: number,
  z: number,
  ...design: [y?: number, size?: number]
) {
  const [y = 9, size = 3] = design;
  box(ctx, x, y, z, size, 2, size, "spruce_planks");
  box(ctx, x, y + 2, z, 1, 1, size, "stripped_spruce_log");
  box(ctx, x + size - 1, y + 2, z, 1, 1, size, "stripped_spruce_log");
}

export function stairX(
  ctx: BuildContext,
  x: number,
  z: number,
  ...design: [
    start: number,
    rise: number,
    width: number,
    east: boolean,
    material?: string,
  ]
) {
  const [start, rise, width, east, material = "stone_brick_stairs"] = design;
  for (let i = 0; i < rise; i++) {
    const sx = x + (east ? i : -i);
    box(ctx, sx, 0, z, 1, start + i, width, "stone_bricks");
    box(
      ctx,
      sx,
      start + i,
      z,
      1,
      1,
      width,
      `${material}[facing=${east ? "east" : "west"}]`,
    );
  }
}

export function bridge(
  ctx: BuildContext,
  x: number,
  z: number,
  ...design: [length: number, width: number, deck: number, material?: string]
) {
  const [length, width, deck, material = "spruce_planks"] = design;
  box(ctx, x, deck, z, length, 1, width, material);
  for (const edge of [z, z + width - 1]) {
    box(ctx, x, deck + 1, edge, length, 1, 1, "oak_fence");
    for (let dx = 0; dx < length; dx += 7)
      box(ctx, x + dx, 0, edge, 1, deck + 2, 1, "dark_oak_log");
  }
}

export function objective(ctx: BuildContext, w: number, d: number) {
  const z = Math.floor(d / 2);
  // Recessed deployment courts prevent every spawn pair from seeing one another.
  for (const x of [24, w - 26]) {
    box(ctx, x, 9, z - 10, 2, 3, 21, ctx.get(0, 9, 0));
    box(ctx, x, 12, z - 10, 2, 1, 21, "stone_brick_slab");
  }
  for (const x of [14, w - 15]) {
    box(ctx, x - 5, 8, z - 7, 11, 1, 15, "polished_andesite");
    ctx.clear({ x: x - 5, y: 9, z: z - 7, w: 11, h: 4, d: 15 });
    ctx.set(x, 9, z, "tnt");
    // Rear blast shelter; bomb can be approached from three sides.
    box(ctx, x < w / 2 ? x - 5 : x + 5, 9, z - 5, 1, 4, 11, "stone_bricks");
    for (const dz of [-6, 6]) {
      box(ctx, x - 3, 9, z + dz, 1, 3, 1, "polished_andesite");
      ctx.set(x - 3, 12, z + dz, "lantern");
    }
  }
}
