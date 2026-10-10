/**
 * Grids cut for looking inside and close: crops, floor plans (everything
 * above a floor removed), sections (the near half removed), and the fixed
 * close-up windows the critique loop names.
 */
import { BlockGrid, type Vec3 } from "#src/core/grid.ts";
import type { Quad, V3 } from "./mesh.ts";

export type GridBox = { min: Vec3; max: Vec3 };

/** Height through the highest occupied layer, retaining at least one layer. */
export function occupiedHeight(grid: BlockGrid): number {
  for (let y = grid.size.y - 1; y > 0; y -= 1) {
    for (let x = 0; x < grid.size.x; x += 1) {
      for (let z = 0; z < grid.size.z; z += 1) {
        if (!grid.isAirAt(x, y, z)) return y + 1;
      }
    }
  }
  return 1;
}

function clampBox(grid: BlockGrid, box: GridBox): GridBox {
  return {
    min: {
      x: Math.max(0, Math.floor(box.min.x)),
      y: Math.max(0, Math.floor(box.min.y)),
      z: Math.max(0, Math.floor(box.min.z)),
    },
    max: {
      x: Math.min(grid.size.x - 1, Math.floor(box.max.x)),
      y: Math.min(grid.size.y - 1, Math.floor(box.max.y)),
      z: Math.min(grid.size.z - 1, Math.floor(box.max.z)),
    },
  };
}

/** The cells inside `box` (inclusive) as their own grid. */
export function cropGrid(grid: BlockGrid, box: GridBox): BlockGrid {
  const { min, max } = clampBox(grid, box);
  const out = new BlockGrid({
    x: Math.max(1, max.x - min.x + 1),
    y: Math.max(1, max.y - min.y + 1),
    z: Math.max(1, max.z - min.z + 1),
  });
  for (let x = min.x; x <= max.x; x += 1) {
    for (let y = min.y; y <= max.y; y += 1) {
      for (let z = min.z; z <= max.z; z += 1) {
        const state = grid.get(x, y, z);
        if (!grid.isAirAt(x, y, z)) {
          out.set(x - min.x, y - min.y, z - min.z, state);
        }
      }
    }
  }
  return out;
}

/** Nudges a face's centre back inside its block, so the cell owning the quad is unambiguous. */
const INSIDE = 1e-3;

/** The cell a quad belongs to: its centre, pulled a hair against its normal. */
function quadCell(quad: Quad): V3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const corner of quad.corners) {
    x += corner[0] / 4;
    y += corner[1] / 4;
    z += corner[2] / 4;
  }
  if (quad.normal !== null) {
    x -= quad.normal[0] * INSIDE;
    y -= quad.normal[1] * INSIDE;
    z -= quad.normal[2] * INSIDE;
  }
  return [Math.floor(x), Math.floor(y), Math.floor(z)];
}

function shifted(corner: V3, origin: Vec3): V3 {
  return [corner[0] - origin.x, corner[1] - origin.y, corner[2] - origin.z];
}

/**
 * The quads of the cells inside `box` (inclusive), moved so the box's corner
 * is the origin. Unlike meshing `cropGrid(...)`, the quads keep whatever the
 * whole grid did to them: relief shadows cast from outside the box, light
 * from a lamp beyond its edge, faces culled by neighbours across it.
 */
export function cropQuads(quads: readonly Quad[], box: GridBox): Quad[] {
  const out: Quad[] = [];
  for (const quad of quads) {
    const [x, y, z] = quadCell(quad);
    if (x < box.min.x || x > box.max.x) continue;
    if (y < box.min.y || y > box.max.y) continue;
    if (z < box.min.z || z > box.max.z) continue;
    const [a, b, c, d] = quad.corners;
    out.push({
      ...quad,
      corners: [
        shifted(a, box.min),
        shifted(b, box.min),
        shifted(c, box.min),
        shifted(d, box.min),
      ],
    });
  }
  return out;
}

export type Cut = {
  /** Keep cells at or below this local y (a floor plan: floor + two courses of wall). */
  belowY?: number;
  /** Keep cells at or behind this local z (a section: drop the front, +z, half so the front views look in). */
  behindZ?: number;
  /** Keep cells at or beyond this local x. */
  fromX?: number;
};

/** The same grid with everything outside the cut turned to air (size unchanged). */
export function cutGrid(grid: BlockGrid, cut: Cut): BlockGrid {
  const out = new BlockGrid(grid.size);
  grid.forEach((x, y, z, state) => {
    if (cut.belowY !== undefined && y > cut.belowY) return;
    if (cut.behindZ !== undefined && z > cut.behindZ) return;
    if (cut.fromX !== undefined && x < cut.fromX) return;
    if (!grid.isAirAt(x, y, z)) out.set(x, y, z, state);
  });
  return out;
}

export const CROP_NAMES = [
  "front-door",
  "centre",
  "nw",
  "ne",
  "sw",
  "se",
] as const;
export type CropName = (typeof CROP_NAMES)[number];

/**
 * Fixed close-up windows: the front-centre (where the door usually is), the
 * centre, and the four quarters. Each is about a third of the build wide,
 * never under 12 blocks, full height.
 */
export function namedCrop(grid: BlockGrid, name: CropName): GridBox {
  const { x: sx, y: sy, z: sz } = grid.size;
  const w = Math.max(12, Math.round(sx / 3));
  const d = Math.max(12, Math.round(sz / 3));
  const full = { y: 0 };
  const top = { y: sy - 1 };
  const at = (x0: number, z0: number): GridBox => ({
    min: { x: x0, ...full, z: z0 },
    max: { x: x0 + w - 1, ...top, z: z0 + d - 1 },
  });
  switch (name) {
    case "front-door":
      return at(Math.round((sx - w) / 2), sz - d);
    case "centre":
      return at(Math.round((sx - w) / 2), Math.round((sz - d) / 2));
    case "nw":
      return at(0, 0);
    case "ne":
      return at(sx - w, 0);
    case "sw":
      return at(0, sz - d);
    case "se":
      return at(sx - w, sz - d);
  }
}
