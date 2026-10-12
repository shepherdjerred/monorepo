/**
 * Terrain helpers for map-scale builds: a heightfield over ctx.noise (or any
 * function), slope-aware surfacing, a downhill river carver and jittered
 * paths. Heights are local y of the ground surface block.
 */
import type { BuildContext } from "@shepherdjerred/mc-build/dsl/context.ts";
import type { Material } from "@shepherdjerred/mc-build/dsl/types.ts";

export type Point = readonly [x: number, z: number];

export type Heightfield = {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  /** Surface y at (x, z); null outside the field. */
  at: (x: number, z: number) => number | null;
  set: (x: number, z: number, y: number) => void;
  /** Largest drop to a 4-neighbour (0 on flat ground). */
  steepness: (x: number, z: number) => number;
  /** Water surface y for river and lake cells carved into the field. */
  water: Map<string, number>;
  /** Distance to the nearest water cell, for bank gradients (1 = touching). */
  bank: Map<string, number>;
  /** Cells claimed by paths, plots and buildings ("x,z"). */
  occupied: Set<string>;
};

export const key = (x: number, z: number): string =>
  `${x.toString()},${z.toString()}`;

/** A heightfield over the box x..x+w-1, z..z+d-1 from `height(x, z)`. */
export function heightfield(spec: {
  x: number;
  z: number;
  w: number;
  d: number;
  height: (x: number, z: number) => number;
}): Heightfield {
  const heights = new Int32Array(spec.w * spec.d);
  const index = (x: number, z: number): number | null => {
    const lx = x - spec.x;
    const lz = z - spec.z;
    return lx < 0 || lz < 0 || lx >= spec.w || lz >= spec.d
      ? null
      : lz * spec.w + lx;
  };
  for (let z = spec.z; z < spec.z + spec.d; z += 1) {
    for (let x = spec.x; x < spec.x + spec.w; x += 1) {
      heights[(z - spec.z) * spec.w + (x - spec.x)] = Math.round(
        spec.height(x, z),
      );
    }
  }
  const at = (x: number, z: number): number | null => {
    const i = index(x, z);
    return i === null ? null : (heights[i] ?? null);
  };
  return {
    x: spec.x,
    z: spec.z,
    w: spec.w,
    d: spec.d,
    at,
    set: (x, z, y) => {
      const i = index(x, z);
      if (i !== null) {
        heights[i] = y;
      }
    },
    steepness: (x, z) => {
      const here = at(x, z);
      if (here === null) {
        return 0;
      }
      let drop = 0;
      for (const [dx, dz] of NEIGHBOURS) {
        const there = at(x + dx, z + dz);
        if (there !== null) {
          drop = Math.max(drop, here - there);
        }
      }
      return drop;
    },
    water: new Map(),
    bank: new Map(),
    occupied: new Set(),
  };
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Per-cell deterministic [0, 1) from the build seed. */
function cellRoll(ctx: BuildContext, x: number, z: number, salt: number) {
  return ctx.noise(x, z, { scale: 1, octaves: 1, salt });
}

export type SurfaceStyle = "temperate" | "alpine" | "desert";

const STYLES: Record<
  SurfaceStyle,
  {
    top: readonly (readonly [string, number])[];
    soil: string;
    rock: readonly (readonly [string, number])[];
    shore: string;
  }
> = {
  temperate: {
    top: [
      ["grass_block", 82],
      ["coarse_dirt", 8],
      ["podzol", 4],
      ["rooted_dirt", 3],
      ["moss_block", 3],
    ],
    soil: "dirt",
    rock: [
      ["stone", 60],
      ["andesite", 15],
      ["cobblestone", 10],
      ["tuff", 8],
      ["stone_bricks", 5],
      ["mossy_cobblestone", 2],
    ],
    shore: "sand",
  },
  alpine: {
    top: [
      ["grass_block", 70],
      ["coarse_dirt", 14],
      ["podzol", 10],
      ["gravel", 6],
    ],
    soil: "dirt",
    rock: [
      ["stone", 55],
      ["andesite", 20],
      ["tuff", 12],
      ["cobblestone", 8],
      ["gravel", 5],
    ],
    shore: "gravel",
  },
  desert: {
    top: [
      ["sand", 80],
      ["red_sand", 8],
      ["coarse_dirt", 7],
      ["gravel", 5],
    ],
    soil: "sandstone",
    rock: [
      ["sandstone", 45],
      ["smooth_sandstone", 20],
      ["terracotta", 20],
      ["granite", 15],
    ],
    shore: "sand",
  },
};

/**
 * Fills every column of the field: rock below, soil at least `soil` thick,
 * then a surface block chosen by slope and height (rock where the column
 * drops 2+ to a neighbour, shore near sea level, patchy top cover, snow
 * above `snowAbove`). Water fills carved rivers and everything below `sea`;
 * banks grade mud → clay/dirt → coarse dirt.
 */
export function surface(
  ctx: BuildContext,
  field: Heightfield,
  options: {
    style?: SurfaceStyle;
    /** Lowest y to fill (default 0). */
    bottom?: number;
    sea?: number;
    soil?: number;
    snowAbove?: number;
  } = {},
): void {
  const style = STYLES[options.style ?? "temperate"];
  const top = ctx.mat.noise(style.top, { scale: 3 });
  const rock = ctx.mat.noise(style.rock, { scale: 2 });
  const bottom = options.bottom ?? 0;
  const soilDepth = Math.max(2, options.soil ?? 3);
  const surfacer: Surfacer = {
    ctx,
    field,
    style,
    top,
    rock,
    snowAbove: options.snowAbove,
  };
  for (let z = field.z; z < field.z + field.d; z += 1) {
    for (let x = field.x; x < field.x + field.w; x += 1) {
      const h = Math.max(bottom, field.at(x, z) ?? bottom);
      const steep = field.steepness(x, z) >= 2;
      const waterTop = Math.max(
        field.water.get(key(x, z)) ?? -Infinity,
        options.sea ?? -Infinity,
      );
      for (let y = bottom; y <= h; y += 1) {
        const depth = h - y;
        let block: Material = rock;
        if (depth === 0) {
          block = surfaceBlock(surfacer, { x, z, h, steep, waterTop });
        } else if (!steep && depth < soilDepth) {
          block = style.soil;
        }
        ctx.set(x, y, z, block);
      }
      for (let y = h + 1; y <= waterTop; y += 1) {
        ctx.set(x, y, z, "water");
      }
    }
  }
}

type Surfacer = {
  ctx: BuildContext;
  field: Heightfield;
  style: (typeof STYLES)[SurfaceStyle];
  top: Material;
  rock: Material;
  snowAbove: number | undefined;
};

function surfaceBlock(
  s: Surfacer,
  cell: { x: number; z: number; h: number; steep: boolean; waterTop: number },
): Material {
  const { ctx, field, style, top, rock, snowAbove } = s;
  const { x, z, h } = cell;
  if (cell.waterTop >= h) {
    return cellRoll(ctx, x, z, 41) < 0.3
      ? "gravel"
      : style.soil === "dirt"
        ? "dirt"
        : style.shore;
  }
  const bank = field.bank.get(key(x, z));
  if (bank !== undefined) {
    return bankBlock(ctx, x, z, bank);
  }
  if (snowAbove !== undefined && h >= snowAbove) {
    return cellRoll(ctx, x, z, 43) < 0.75 ? "snow_block" : rock;
  }
  if (cell.steep) {
    return rock;
  }
  return cell.waterTop >= h - 1 ? style.shore : top;
}

/** Bank gradient outward from water: mud, mud/clay, dirt/gravel, coarse dirt. */
function bankBlock(ctx: BuildContext, x: number, z: number, distance: number) {
  const roll = cellRoll(ctx, x, z, 47);
  if (distance <= 1) {
    return roll < 0.75 ? "mud" : "clay";
  }
  if (distance === 2) {
    return roll < 0.45 ? "dirt" : roll < 0.7 ? "gravel" : "mud";
  }
  return roll < 0.55
    ? "coarse_dirt"
    : roll < 0.75
      ? "rooted_dirt"
      : "grass_block";
}

/** Cells along a polyline, one per step (Bresenham between points). */
export function trace(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const [x0, z0] = points[i - 1] ?? [0, 0];
    const [x1, z1] = points[i] ?? [0, 0];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0), 1);
    for (let s = i === 1 ? 0 : 1; s <= steps; s += 1) {
      out.push([
        Math.round(x0 + ((x1 - x0) * s) / steps),
        Math.round(z0 + ((z1 - z0) * s) / steps),
      ]);
    }
  }
  return out;
}

/** Perpendicular wander (−1..1) that changes every few blocks (seven-block rule). */
function wander(ctx: BuildContext, step: number, salt: number): number {
  return (ctx.noise(step, 0, { scale: 7, octaves: 2, salt }) - 0.5) * 2;
}

/**
 * Carves a river along `points` (source first) into the field: the water
 * surface never rises downstream, the bed is `depth` below it in the middle
 * and 1 at the edges, banks are recorded for `surface`. Call before
 * `surface`.
 */
export function carveRiver(
  ctx: BuildContext,
  field: Heightfield,
  spec: {
    points: readonly Point[];
    width: number;
    depth?: number;
    /** Width added by the mouth (default width / 2). */
    widen?: number;
    meander?: number;
  },
): void {
  const line = trace(spec.points);
  const depth =
    spec.depth ?? Math.min(3, Math.max(1, Math.round(spec.width / 2)));
  const meander = spec.meander ?? Math.max(1, Math.round(spec.width / 2));
  // Sample the original ground along the course first: carving lowers cells
  // the next steps would otherwise read, and the river would tunnel down.
  const course = line.map(([px, pz], step) => {
    const cx = px + Math.round(wander(ctx, step, 5) * meander);
    return { cx, cz: pz, ground: field.at(cx, pz) };
  });
  let level = Infinity;
  course.forEach(({ cx, cz, ground }, step) => {
    const t = step / Math.max(1, course.length - 1);
    const half = (spec.width + (spec.widen ?? spec.width / 2) * t) / 2;
    if (ground === null) {
      return;
    }
    level = Math.min(level, ground - 1);
    const r = Math.ceil(half);
    for (let dx = -r - 3; dx <= r + 3; dx += 1) {
      for (let dz = -r - 3; dz <= r + 3; dz += 1) {
        const distance = Math.hypot(dx, dz);
        const x = cx + dx;
        const z = cz + dz;
        if (distance <= half) {
          const bed =
            level -
            Math.max(1, Math.round(depth * (1 - (distance / half) ** 2)));
          field.set(x, z, Math.min(field.at(x, z) ?? bed, bed));
          field.water.set(
            key(x, z),
            Math.max(field.water.get(key(x, z)) ?? level, level),
          );
          field.bank.delete(key(x, z));
        } else if (!field.water.has(key(x, z))) {
          const ring = Math.ceil(distance - half);
          const known = field.bank.get(key(x, z));
          field.bank.set(key(x, z), Math.min(known ?? ring, ring));
          const here = field.at(x, z);
          if (here !== null && ring <= 2 && here > level + ring) {
            field.set(x, z, level + ring);
          }
        }
      }
    }
  });
}

export type PathStyle = "rural" | "town" | "rough";

const PATHS: Record<
  PathStyle,
  {
    core: readonly (readonly [string, number])[];
    edge: readonly (readonly [string, number])[];
    slab: string;
  }
> = {
  rural: {
    core: [
      ["dirt_path", 65],
      ["coarse_dirt", 20],
      ["gravel", 10],
      ["packed_mud", 5],
    ],
    edge: [
      ["coarse_dirt", 50],
      ["dirt_path", 30],
      ["grass_block", 20],
    ],
    slab: "cobblestone_slab",
  },
  town: {
    core: [
      ["stone", 40],
      ["andesite", 30],
      ["stone_bricks", 25],
      ["cobblestone", 5],
    ],
    edge: [
      ["cobblestone", 50],
      ["mossy_cobblestone", 30],
      ["andesite", 20],
    ],
    slab: "stone_brick_slab",
  },
  rough: {
    core: [
      ["cobblestone", 50],
      ["mossy_cobblestone", 25],
      ["tuff", 15],
      ["gravel", 10],
    ],
    edge: [
      ["mossy_cobblestone", 40],
      ["coarse_dirt", 40],
      ["grass_block", 20],
    ],
    slab: "cobblestone_slab",
  },
};

/**
 * Lays a path over the field's surface along `points`: the centreline
 * wanders (never more than ~7 straight), edges are nibbled, accents sit at
 * the edges, and a slab marks each 1-block rise. Water cells are skipped
 * (bridge them yourself). Marks the cells occupied. Call after `surface`.
 */
export function path(
  ctx: BuildContext,
  field: Heightfield,
  spec: {
    points: readonly Point[];
    width?: number;
    style?: PathStyle;
    wander?: number;
  },
): { cells: number } {
  const style = PATHS[spec.style ?? "rural"];
  const core = ctx.mat.palette(style.core);
  const edge = ctx.mat.palette(style.edge);
  const half = (spec.width ?? 3) / 2;
  const amount = spec.wander ?? 1;
  const cells = new Map<string, { x: number; z: number; rim: boolean }>();
  trace(spec.points).forEach(([px, pz], step) => {
    const cx = px + Math.round(wander(ctx, step, 11) * amount);
    const cz = pz + Math.round(wander(ctx, step, 13) * amount);
    const r = Math.ceil(half);
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        const distance = Math.hypot(dx, dz);
        const x = cx + dx;
        const z = cz + dz;
        const rim = distance > half - 1;
        if (distance > half || (rim && cellRoll(ctx, x, z, 17) < 0.3)) {
          continue;
        }
        const known = cells.get(key(x, z));
        cells.set(key(x, z), { x, z, rim: (known?.rim ?? true) && rim });
      }
    }
  });
  let placed = 0;
  for (const cell of cells.values()) {
    const h = field.at(cell.x, cell.z);
    if (h === null || field.water.has(key(cell.x, cell.z))) {
      continue;
    }
    ctx.set(cell.x, h, cell.z, cell.rim ? edge : core);
    field.occupied.add(key(cell.x, cell.z));
    placed += 1;
    const rise = NEIGHBOURS.some(([dx, dz]) => {
      const there = field.at(cell.x + dx, cell.z + dz);
      return there === h + 1 && cells.has(key(cell.x + dx, cell.z + dz));
    });
    if (rise) {
      ctx.set(cell.x, h + 1, cell.z, ctx.mat.block(style.slab));
    }
  }
  return { cells: placed };
}
