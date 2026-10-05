/**
 * Town and castle walls: a thick, terrain-following wall run along a
 * polyline with crenellations on the outer edge, a walkway, buttresses,
 * round towers at the corners and an optional gatehouse with flanking
 * towers and a portcullis.
 */
import type { BuildContext } from "@shepherdjerred/mc-build/dsl/context.ts";
import type { Material } from "@shepherdjerred/mc-build/dsl/types.ts";

export type Point = readonly [x: number, z: number];
export type RampartStyle = "stone" | "dark" | "sandstone";

export type RampartSpec = {
  points: readonly Point[];
  /** Join the last point back to the first. */
  closed?: boolean;
  /** Ground surface y at (x, z), e.g. a terrain heightfield's `at`. */
  ground: (x: number, z: number) => number | null;
  /** Wall height above the ground (default 7). */
  height?: number;
  /** Odd thickness at the base (default 3). */
  thickness?: number;
  style?: RampartStyle;
  /** Round towers at the corners (default true). */
  towers?: boolean;
  /** A gatehouse in the middle of segment `segment` (0 = first). */
  gate?: { segment: number; width?: number; height?: number };
};

export type Ramparts = {
  /** Centre of the gate opening at ground level, if any. */
  gate: { x: number; y: number; z: number } | null;
  /** Wall cells ("x,z") for keeping plots and streets clear. */
  cells: Set<string>;
};

const STYLES: Record<
  RampartStyle,
  {
    body: readonly (readonly [string, number])[];
    base: readonly (readonly [string, number])[];
    merlon: string;
    cap: string;
  }
> = {
  stone: {
    body: [
      ["stone_bricks", 60],
      ["cracked_stone_bricks", 12],
      ["andesite", 13],
      ["cobblestone", 10],
      ["mossy_stone_bricks", 5],
    ],
    base: [
      ["mossy_cobblestone", 40],
      ["cobblestone", 40],
      ["andesite", 20],
    ],
    merlon: "stone_bricks",
    cap: "stone_brick_slab",
  },
  dark: {
    body: [
      ["deepslate_bricks", 55],
      ["cracked_deepslate_bricks", 15],
      ["cobbled_deepslate", 20],
      ["tuff", 10],
    ],
    base: [
      ["cobbled_deepslate", 60],
      ["mossy_cobblestone", 20],
      ["tuff", 20],
    ],
    merlon: "deepslate_bricks",
    cap: "deepslate_brick_slab",
  },
  sandstone: {
    body: [
      ["cut_sandstone", 50],
      ["sandstone", 35],
      ["smooth_sandstone", 15],
    ],
    base: [
      ["sandstone", 60],
      ["granite", 20],
      ["terracotta", 20],
    ],
    merlon: "cut_sandstone",
    cap: "sandstone_slab",
  },
};

const k = (x: number, z: number): string => `${x.toString()},${z.toString()}`;

type Cell = {
  x: number;
  z: number;
  outer: boolean;
  inner: boolean;
  step: number;
};

function trace(a: Point, b: Point): Point[] {
  const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
  const out: Point[] = [];
  for (let s = 0; s <= steps; s += 1) {
    out.push([
      Math.round(a[0] + ((b[0] - a[0]) * s) / steps),
      Math.round(a[1] + ((b[1] - a[1]) * s) / steps),
    ]);
  }
  return out;
}

/** Wall cells of one segment, classified as outer/inner edge or core. */
function segmentCells(
  [a, b]: readonly [Point, Point],
  o: { thickness: number; outward: number; startStep: number },
  cells: Map<string, Cell>,
): number {
  const { thickness, outward, startStep } = o;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = (-(b[1] - a[1]) / length) * outward;
  const nz = ((b[0] - a[0]) / length) * outward;
  const r = Math.floor(thickness / 2);
  const line = trace(a, b);
  line.forEach(([cx, cz], i) => {
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        const across = dx * nx + dz * nz;
        const outer = across > r - 0.5;
        const inner = across < -(r - 0.5);
        const key = k(cx + dx, cz + dz);
        const known = cells.get(key);
        cells.set(key, {
          x: cx + dx,
          z: cz + dz,
          outer: (known?.outer ?? true) && outer,
          inner: (known?.inner ?? true) && inner,
          step: known?.step ?? startStep + i,
        });
      }
    }
  });
  return startStep + line.length;
}

/** +1 when the polygon winds so that +normal points outward, else -1. */
function winding(points: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x0, z0] = points[i] ?? [0, 0];
    const [x1, z1] = points[(i + 1) % points.length] ?? [0, 0];
    area += x0 * z1 - x1 * z0;
  }
  return area > 0 ? -1 : 1;
}

export function ramparts(ctx: BuildContext, spec: RampartSpec): Ramparts {
  const height = spec.height ?? 7;
  const thickness = Math.max(1, spec.thickness ?? 3) | 1;
  const style = STYLES[spec.style ?? "stone"];
  const body = ctx.mat.noise(style.body, { scale: 2 });
  const base = ctx.mat.noise(style.base, { scale: 2 });
  const points =
    spec.closed === true
      ? [...spec.points, spec.points[0] ?? [0, 0]]
      : spec.points;
  const outward = spec.closed === true ? winding(spec.points) : 1;
  const cells = new Map<string, Cell>();
  let step = 0;
  for (let i = 1; i < points.length; i += 1) {
    step = segmentCells(
      [points[i - 1] ?? [0, 0], points[i] ?? [0, 0]],
      { thickness, outward, startStep: step },
      cells,
    );
  }
  // Towers own their footprint: no wall columns inside them (that would
  // leave dark sealed pockets in the tower).
  const corners = spec.closed === true ? spec.points : spec.points.slice(1, -1);
  const towerRadius = Math.floor(thickness / 2) + 2;
  const inTower = (cell: Cell): boolean =>
    (spec.towers ?? true) &&
    corners.some(([x, z]) => Math.hypot(cell.x - x, cell.z - z) <= towerRadius);
  for (const cell of cells.values()) {
    if (!inTower(cell)) {
      wallColumn(ctx, spec, cell, { height, body, base, style });
    }
  }
  buttresses(ctx, spec, points, { height, thickness, outward, body });
  if (spec.towers ?? true) {
    for (const [x, z] of corners) {
      tower(ctx, spec, {
        x,
        z,
        radius: towerRadius,
        height: height + 4,
        wall: body,
        round: true,
      });
    }
  }
  const gate =
    spec.gate === undefined
      ? null
      : gatehouse(ctx, spec, points, { height, thickness, body, outward });
  return { gate, cells: new Set(cells.keys()) };
}

function wallColumn(
  ctx: BuildContext,
  spec: RampartSpec,
  cell: Cell,
  o: {
    height: number;
    body: Material;
    base: Material;
    style: (typeof STYLES)[RampartStyle];
  },
): void {
  const ground = spec.ground(cell.x, cell.z);
  if (ground === null) {
    return;
  }
  const top = ground + o.height;
  for (let y = ground - 1; y <= top; y += 1) {
    ctx.set(cell.x, y, cell.z, y <= ground + 1 ? o.base : o.body);
  }
  if (cell.outer && cell.step % 2 === 0) {
    ctx.set(cell.x, top + 1, cell.z, o.style.merlon);
    ctx.set(cell.x, top + 2, cell.z, o.style.cap);
  } else if (cell.outer || cell.inner) {
    ctx.set(cell.x, top + 1, cell.z, o.style.cap);
  }
}

function buttresses(
  ctx: BuildContext,
  spec: RampartSpec,
  points: readonly Point[],
  o: { height: number; thickness: number; outward: number; body: Material },
): void {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] ?? [0, 0];
    const b = points[i] ?? [0, 0];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = (-(b[1] - a[1]) / length) * o.outward;
    const nz = ((b[0] - a[0]) / length) * o.outward;
    const line = trace(a, b);
    for (let s = 6; s < line.length - 4; s += 9) {
      const [cx, cz] = line[s] ?? [0, 0];
      const x = cx + Math.round(nx * (Math.floor(o.thickness / 2) + 1));
      const z = cz + Math.round(nz * (Math.floor(o.thickness / 2) + 1));
      const ground = spec.ground(x, z);
      if (ground === null) {
        continue;
      }
      for (let y = ground - 1; y <= ground + o.height - 3; y += 1) {
        ctx.set(x, y, z, o.body);
      }
    }
  }
}

function tower(
  ctx: BuildContext,
  spec: RampartSpec,
  o: {
    x: number;
    z: number;
    radius: number;
    height: number;
    wall: Material;
    round: boolean;
  },
): void {
  const { x, z } = o;
  let ground = spec.ground(x, z) ?? 0;
  let peak = ground;
  for (let dx = -o.radius; dx <= o.radius; dx += 1) {
    for (let dz = -o.radius; dz <= o.radius; dz += 1) {
      const here = spec.ground(x + dx, z + dz) ?? ground;
      ground = Math.min(ground, here);
      peak = Math.max(peak, here);
    }
  }
  // Clear terrain inside the tower so uneven ground leaves no dark pockets.
  for (let dx = -o.radius + 1; dx < o.radius; dx += 1) {
    for (let dz = -o.radius + 1; dz < o.radius; dz += 1) {
      for (let y = ground; y <= Math.max(peak + 1, ground + o.height); y += 1) {
        ctx.set(x + dx, y, z + dz, "air");
      }
    }
  }
  ctx.craft.tower({
    x,
    z,
    y: ground - 1,
    shape: o.round ? "round" : "square",
    radius: o.radius,
    h: o.height + 1,
    wall: o.wall,
    floor: "spruce_planks",
    crenellations: true,
    slits: true,
  });
}

function gatehouse(
  ctx: BuildContext,
  spec: RampartSpec,
  points: readonly Point[],
  o: { height: number; thickness: number; body: Material; outward: number },
): { x: number; y: number; z: number } {
  const segment = spec.gate?.segment ?? 0;
  const a = points[segment] ?? [0, 0];
  const b = points[segment + 1] ?? a;
  const line = trace(a, b);
  const [cx, cz] = line[Math.floor(line.length / 2)] ?? a;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / length;
  const uz = (b[1] - a[1]) / length;
  const width = spec.gate?.width ?? 3;
  const tall = spec.gate?.height ?? 5;
  const ground = spec.ground(cx, cz) ?? 0;
  const half = Math.floor(width / 2);
  const reach = Math.floor(o.thickness / 2) + 1;
  const nx = -uz * o.outward;
  const nz = ux * o.outward;
  for (let along = -half; along <= half; along += 1) {
    for (let across = -reach; across <= reach; across += 1) {
      const x = cx + Math.round(ux * along + nx * across);
      const z = cz + Math.round(uz * along + nz * across);
      for (let y = ground; y < ground + tall; y += 1) {
        ctx.set(x, y, z, "air");
      }
      ctx.set(
        x,
        ground - 1,
        z,
        ctx.mat.palette([
          ["cobblestone", 3],
          ["stone_bricks", 2],
          ["gravel", 1],
        ]),
      );
    }
    // Portcullis hangs from the outer face's top row.
    const px = cx + Math.round(ux * along + nx * reach);
    const pz = cz + Math.round(uz * along + nz * reach);
    ctx.set(px, ground + tall - 1, pz, "iron_bars");
  }
  for (const sign of [-1, 1]) {
    const tx = cx + Math.round(ux * (half + 3) * sign);
    const tz = cz + Math.round(uz * (half + 3) * sign);
    tower(ctx, spec, {
      x: tx,
      z: tz,
      radius: 2,
      height: o.height + 3,
      wall: o.body,
      round: false,
    });
  }
  return { x: cx, y: ground, z: cz };
}
