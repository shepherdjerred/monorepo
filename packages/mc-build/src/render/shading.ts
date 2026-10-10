/**
 * Shading passes that need the grid, not just the quads: `relief` (a low sun
 * that casts long shadows plus corner occlusion, so flat walls and missing
 * depth show) and `light` (faces coloured by the light outside them, so dark
 * corners and unlit doors show).
 */
import type { BlockGrid, Vec3 } from "#src/core/grid.ts";
import { blockId, isAir } from "#src/core/block-state.ts";
import type { Quad, V3 } from "./mesh.ts";

/** The relief sun: low in the north-west (yaw 300°), 25° above the horizon. */
export const RELIEF_SUN = { yaw: 300, pitch: 25 } as const;
const SHADOW = 0.45;
const MARCH_STEPS = 64;
const ZERO_ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
/** Above this many quads the sun march is skipped unless asked for explicitly. */
export const RELIEF_MAX_QUADS = 2_000_000;

const NEIGHBOURS: readonly V3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function sunDirection(sun: { yaw: number; pitch: number }): V3 {
  const yaw = (sun.yaw * Math.PI) / 180;
  const pitch = (sun.pitch * Math.PI) / 180;
  return [
    Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    Math.cos(pitch) * Math.cos(yaw),
  ];
}

function centreOf(quad: Quad): V3 {
  const [a, b, c, d] = quad.corners;
  return [
    (a[0] + b[0] + c[0] + d[0]) / 4,
    (a[1] + b[1] + c[1] + d[1]) / 4,
    (a[2] + b[2] + c[2] + d[2]) / 4,
  ];
}

function solid(grid: BlockGrid, x: number, y: number, z: number): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cz = Math.floor(z);
  return grid.inBounds(cx, cy, cz) && !grid.isAirAt(cx, cy, cz);
}

/** True when a ray from `from` toward the sun hits a block within the march. */
function inShadow(grid: BlockGrid, from: V3, sun: V3): boolean {
  const step = 0.5;
  for (let i = 1; i <= MARCH_STEPS; i += 1) {
    const t = i * step;
    const x = from[0] + sun[0] * t;
    const y = from[1] + sun[1] * t;
    const z = from[2] + sun[2] * t;
    if (y >= grid.size.y) return false;
    if (solid(grid, x, y, z)) return true;
  }
  return false;
}

/** The two unit axes tangent to a face normal. */
function tangents(normal: V3): [V3, V3] {
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  if (ay >= ax && ay >= az) {
    return [
      [1, 0, 0],
      [0, 0, 1],
    ];
  }
  if (ax >= az) {
    return [
      [0, 1, 0],
      [0, 0, 1],
    ];
  }
  return [
    [1, 0, 0],
    [0, 1, 0],
  ];
}

/** `base + sa·a + sb·b` for two scaled tangent steps. */
function offset(base: V3, along: [V3, number], across: [V3, number]): V3 {
  const [a, sa] = along;
  const [b, sb] = across;
  return [
    base[0] + sa * a[0] + sb * b[0],
    base[1] + sa * a[1] + sb * b[1],
    base[2] + sa * a[2] + sb * b[2],
  ];
}

/** 1 for an open face, down to 0.5 when neighbours crowd its outside cell. */
function occlusion(grid: BlockGrid, outside: V3, normal: V3): number {
  const [u, v] = tangents(normal);
  let edges = 0;
  let corners = 0;
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      const corner = offset(outside, [u, su], [v, sv]);
      if (solid(grid, corner[0], corner[1], corner[2])) corners += 1;
    }
    const alongU = offset(outside, [u, su], [v, 0]);
    const alongV = offset(outside, [u, 0], [v, su]);
    if (solid(grid, alongU[0], alongU[1], alongU[2])) edges += 1;
    if (solid(grid, alongV[0], alongV[1], alongV[2])) edges += 1;
  }
  return Math.max(0.5, 1 - 0.1 * edges - 0.04 * corners);
}

/** The cell just outside a quad, at its centre, pushed half a block along its normal. */
function outsidePoint(quad: Quad, normal: V3): V3 {
  const centre = centreOf(quad);
  return [
    centre[0] + normal[0] * 0.5,
    centre[1] + normal[1] * 0.5,
    centre[2] + normal[2] * 0.5,
  ];
}

function scaled(quad: Quad, factor: V3): Quad {
  return {
    ...quad,
    color: [
      quad.color[0] * factor[0],
      quad.color[1] * factor[1],
      quad.color[2] * factor[2],
    ],
  };
}

export function shadeRelief(
  quads: readonly Quad[],
  grid: BlockGrid,
  options: { sun?: { yaw: number; pitch: number }; force?: boolean } = {},
): Quad[] {
  const sun = sunDirection(options.sun ?? RELIEF_SUN);
  const march = options.force === true || quads.length <= RELIEF_MAX_QUADS;
  return quads.map((quad) => {
    if (quad.normal === null) return quad;
    const normal = quad.normal;
    const facing = Math.max(
      0,
      normal[0] * sun[0] + normal[1] * sun[1] + normal[2] * sun[2],
    );
    const outside = outsidePoint(quad, normal);
    let factor = (0.55 + 0.45 * facing) * occlusion(grid, outside, normal);
    if (march && facing > 0 && inShadow(grid, outside, sun)) {
      factor *= SHADOW;
    }
    return scaled(quad, [factor, factor, factor]);
  });
}

/** Skylight crosses invisible light, ordinary/stained glass and panes. */
function transmitsSky(state: string): boolean {
  const id = blockId(state).replace(/^minecraft:/u, "");
  return (
    isAir(state) ||
    id === "light" ||
    id === "glass" ||
    id === "glass_pane" ||
    id.endsWith("_stained_glass") ||
    id.endsWith("_stained_glass_pane")
  );
}

/** Per column, the highest skylight-blocking cell (-1 for an open column). */
function skyline(grid: BlockGrid): Int32Array {
  const top = new Int32Array(grid.size.x * grid.size.z).fill(-1);
  grid.forEach((x, y, z) => {
    if (transmitsSky(grid.get(x, y, z))) return;
    const column = z * grid.size.x + x;
    if (y > (top[column] ?? -1)) top[column] = y;
  });
  return top;
}

/** Breadth-first spread of a light field through air, one level less per step. */
function propagate(grid: BlockGrid, levels: Int8Array, queue: number[]): void {
  const { x: sx, z: sz } = grid.size;
  // Iterating while pushing visits newly queued cells too (array for-of is live).
  for (const index of queue) {
    const level = levels[index] ?? 0;
    if (level <= 1) continue;
    const x = index % sx;
    const z = Math.floor(index / sx) % sz;
    const y = Math.floor(index / (sx * sz));
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!grid.inBounds(nx, ny, nz) || !transmitsSky(grid.get(nx, ny, nz)))
        continue;
      const next = grid.index(nx, ny, nz);
      if ((levels[next] ?? 0) < level - 1) {
        levels[next] = level - 1;
        queue.push(next);
      }
    }
  }
}

/**
 * Sky light per cell, as the game spreads it: 15 wherever nothing is above,
 * then one less per step through air, so cells under an eave or just inside
 * a doorway are lit and deep interiors are not.
 */
export function skyLightLevels(grid: BlockGrid): Int8Array {
  const top = skyline(grid);
  const levels = new Int8Array(grid.volume);
  const queue: number[] = [];
  const { x: sx, y: sy, z: sz } = grid.size;
  for (let z = 0; z < sz; z += 1) {
    for (let x = 0; x < sx; x += 1) {
      const highest = top[z * sx + x] ?? -1;
      for (let y = highest + 1; y < sy; y += 1) {
        const index = grid.index(x, y, z);
        levels[index] = 15;
        queue.push(index);
      }
    }
  }
  propagate(grid, levels, queue);
  return levels;
}

/**
 * Faces coloured by the light of the cell outside them: the brighter of the
 * grid's block light and its sky light. Unlit faces go red.
 */
export function shadeLight(
  quads: readonly Quad[],
  grid: BlockGrid,
  light: Int8Array,
  origin: Vec3 = ZERO_ORIGIN,
): Quad[] {
  const sky = skyLightLevels(grid);
  return quads.map((quad) => {
    if (quad.normal === null) return quad;
    const outside = outsidePoint(quad, quad.normal);
    const x = Math.floor(outside[0] + origin.x);
    const y = Math.floor(outside[1] + origin.y);
    const z = Math.floor(outside[2] + origin.z);
    const level = grid.inBounds(x, y, z)
      ? Math.max(
          light[grid.index(x, y, z)] ?? 0,
          sky[grid.index(x, y, z)] ?? 0,
          0,
        )
      : 15;
    if (level === 0) {
      return scaled(quad, [0.9, 0.25, 0.25]);
    }
    const factor = 0.25 + 0.75 * (level / 15);
    return scaled(quad, [factor, factor, factor]);
  });
}
