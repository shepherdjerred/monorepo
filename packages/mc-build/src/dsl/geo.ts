import type { Box, Dir, Region } from "./types.ts";

function assertBox(spec: Box): void {
  for (const key of ["x", "y", "z", "w", "h", "d"] as const) {
    if (!Number.isInteger(spec[key])) {
      throw new TypeError(
        `box.${key} must be an integer, got ${String(spec[key])}`,
      );
    }
  }
  if (spec.w <= 0 || spec.h <= 0 || spec.d <= 0) {
    throw new RangeError(
      `box size must be positive, got w=${spec.w.toString()} h=${spec.h.toString()} d=${spec.d.toString()}`,
    );
  }
}

function inBox(spec: Box, x: number, y: number, z: number): boolean {
  return (
    x >= spec.x &&
    y >= spec.y &&
    z >= spec.z &&
    x < spec.x + spec.w &&
    y < spec.y + spec.h &&
    z < spec.z + spec.d
  );
}

function unionBounds(boxes: readonly Box[]): Box {
  const [first] = boxes;
  if (first === undefined) {
    throw new RangeError("union of no regions");
  }
  let minX = first.x;
  let minY = first.y;
  let minZ = first.z;
  let maxX = first.x + first.w;
  let maxY = first.y + first.h;
  let maxZ = first.z + first.d;
  for (const entry of boxes) {
    minX = Math.min(minX, entry.x);
    minY = Math.min(minY, entry.y);
    minZ = Math.min(minZ, entry.z);
    maxX = Math.max(maxX, entry.x + entry.w);
    maxY = Math.max(maxY, entry.y + entry.h);
    maxZ = Math.max(maxZ, entry.z + entry.d);
  }
  return {
    x: minX,
    y: minY,
    z: minZ,
    w: maxX - minX,
    h: maxY - minY,
    d: maxZ - minZ,
  };
}

export function box(spec: Box): Region {
  assertBox(spec);
  return { bounds: { ...spec }, has: (x, y, z) => inBox(spec, x, y, z) };
}

/** A box shell `thickness` thick (walls, floor and ceiling). */
export function hollowBox(spec: Box, thickness = 1): Region {
  assertBox(spec);
  const inner: Box = {
    x: spec.x + thickness,
    y: spec.y + thickness,
    z: spec.z + thickness,
    w: spec.w - 2 * thickness,
    h: spec.h - 2 * thickness,
    d: spec.d - 2 * thickness,
  };
  const hollow = inner.w > 0 && inner.h > 0 && inner.d > 0;
  return {
    bounds: { ...spec },
    has: (x, y, z) =>
      inBox(spec, x, y, z) && !(hollow && inBox(inner, x, y, z)),
  };
}

/** The vertical perimeter ring of a box: four walls, no floor or ceiling. */
export function outline(spec: Box): Region {
  assertBox(spec);
  return {
    bounds: { ...spec },
    has: (x, y, z) =>
      inBox(spec, x, y, z) &&
      (x === spec.x ||
        x === spec.x + spec.w - 1 ||
        z === spec.z ||
        z === spec.z + spec.d - 1),
  };
}

/** A vertical cylinder centered on (cx, cz), radius r (cells within r + 0.5). */
export function cylinder(spec: {
  cx: number;
  cz: number;
  y: number;
  r: number;
  h: number;
  hollow?: boolean;
}): Region {
  const reach = spec.r + 0.5;
  const bounds: Box = {
    x: spec.cx - spec.r,
    y: spec.y,
    z: spec.cz - spec.r,
    w: spec.r * 2 + 1,
    h: spec.h,
    d: spec.r * 2 + 1,
  };
  assertBox(bounds);
  const within = (x: number, z: number, radius: number) =>
    (x - spec.cx) ** 2 + (z - spec.cz) ** 2 <= radius * radius;
  return {
    bounds,
    has: (x, y, z) =>
      inBox(bounds, x, y, z) &&
      within(x, z, reach) &&
      !(spec.hollow === true && within(x, z, reach - 1)),
  };
}

export function union(...regions: Region[]): Region {
  return {
    bounds: unionBounds(regions.map((region) => region.bounds)),
    has: (x, y, z) => regions.some((region) => region.has(x, y, z)),
  };
}

export function subtract(from: Region, ...cut: Region[]): Region {
  return {
    bounds: { ...from.bounds },
    has: (x, y, z) =>
      from.has(x, y, z) && !cut.some((region) => region.has(x, y, z)),
  };
}

export function intersect(a: Region, b: Region): Region {
  return {
    bounds: { ...a.bounds },
    has: (x, y, z) => a.has(x, y, z) && b.has(x, y, z),
  };
}

/** The one-cell-thick side of a box facing `dir` (or its top/bottom). */
export function face(spec: Box, dir: Dir | "up" | "down"): Region {
  assertBox(spec);
  const slab: Box = { ...spec };
  switch (dir) {
    case "front": {
      slab.z = spec.z + spec.d - 1;
      slab.d = 1;
      break;
    }
    case "back": {
      slab.d = 1;
      break;
    }
    case "right": {
      slab.x = spec.x + spec.w - 1;
      slab.w = 1;
      break;
    }
    case "left": {
      slab.w = 1;
      break;
    }
    case "up": {
      slab.y = spec.y + spec.h - 1;
      slab.h = 1;
      break;
    }
    case "down": {
      slab.h = 1;
      break;
    }
  }
  return box(slab);
}

/** The 12 edges of a box. */
export function edges(spec: Box): Region {
  assertBox(spec);
  const onX = (x: number) => x === spec.x || x === spec.x + spec.w - 1;
  const onY = (y: number) => y === spec.y || y === spec.y + spec.h - 1;
  const onZ = (z: number) => z === spec.z || z === spec.z + spec.d - 1;
  return {
    bounds: { ...spec },
    has: (x, y, z) =>
      inBox(spec, x, y, z) &&
      [onX(x), onY(y), onZ(z)].filter(Boolean).length >= 2,
  };
}

/** Iterates every cell of a region inside its bounds. */
export function* cells(region: Region): Generator<[number, number, number]> {
  const { bounds } = region;
  for (let y = bounds.y; y < bounds.y + bounds.h; y += 1) {
    for (let z = bounds.z; z < bounds.z + bounds.d; z += 1) {
      for (let x = bounds.x; x < bounds.x + bounds.w; x += 1) {
        if (region.has(x, y, z)) {
          yield [x, y, z];
        }
      }
    }
  }
}

export const geo = {
  box,
  hollowBox,
  outline,
  cylinder,
  union,
  subtract,
  intersect,
  face,
  edges,
  cells,
};
export type Geo = typeof geo;
