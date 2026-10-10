/**
 * Shading passes that need the grid, not just the quads: `relief` (a low sun
 * that casts long shadows plus corner occlusion, so flat walls and missing
 * depth show) and `light` (faces coloured by the light outside them, so dark
 * corners and unlit doors show).
 */
import type { BlockGrid, Vec3 } from "#src/core/grid.ts";
import type { Quad, V3 } from "./mesh.ts";
import { ShadowIndex } from "./shadow.ts";
import { surfaceNormal, surfaceTangents } from "./surface.ts";

/** The relief sun: low in the north-west (yaw 300°), 25° above the horizon. */
export const RELIEF_SUN = { yaw: 300, pitch: 25 } as const;
const SHADOW = 0.45;
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
function occlusion(shadows: ShadowIndex, outside: V3, normal: V3): number {
  const [u, v] = surfaceTangents(normal);
  let edges = 0;
  let corners = 0;
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      const corner = offset(outside, [u, su], [v, sv]);
      if (shadows.between(outside, corner)) corners += 1;
    }
    const alongU = offset(outside, [u, su], [v, 0]);
    const alongV = offset(outside, [u, 0], [v, su]);
    if (shadows.between(outside, alongU)) edges += 1;
    if (shadows.between(outside, alongV)) edges += 1;
  }
  return Math.max(0.5, 1 - 0.1 * edges - 0.04 * corners);
}

/** The cell just outside a quad, at its centre, pushed half a block along its normal. */
function outsidePoint(quad: Quad, normal: V3, distance = 0.5): V3 {
  const centre = centreOf(quad);
  return [
    centre[0] + normal[0] * distance,
    centre[1] + normal[1] * distance,
    centre[2] + normal[2] * distance,
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
  options: { sun?: { yaw: number; pitch: number }; force?: boolean } = {},
): Quad[] {
  const sun = sunDirection(options.sun ?? RELIEF_SUN);
  const shadows = new ShadowIndex(quads);
  const march = options.force === true || quads.length <= RELIEF_MAX_QUADS;
  return quads.map((quad) => {
    if (quad.normal === null) return quad;
    const normal = surfaceNormal(quad.corners);
    if (normal === null) return quad;
    const facing = Math.max(
      0,
      normal[0] * sun[0] + normal[1] * sun[1] + normal[2] * sun[2],
    );
    const outside = outsidePoint(quad, normal, 0.001);
    let factor = (0.55 + 0.45 * facing) * occlusion(shadows, outside, normal);
    if (march && facing > 0 && shadows.hit(outside, sun, 32)) {
      factor *= SHADOW;
    }
    return scaled(quad, [factor, factor, factor]);
  });
}

function transmitsSky(
  state: string,
  transmission: ReadonlyMap<string, boolean>,
): boolean {
  const result = transmission.get(state);
  if (result === undefined)
    throw new Error(`Missing light transmission for ${state}`);
  return result;
}

/** Per column, the highest skylight-blocking cell (-1 for an open column). */
function skyline(
  grid: BlockGrid,
  transmission: ReadonlyMap<string, boolean>,
): Int32Array {
  const top = new Int32Array(grid.size.x * grid.size.z).fill(-1);
  grid.forEach((x, y, z) => {
    if (transmitsSky(grid.get(x, y, z), transmission)) return;
    const column = z * grid.size.x + x;
    if (y > (top[column] ?? -1)) top[column] = y;
  });
  return top;
}

/** Breadth-first spread of a light field through air, one level less per step. */
function propagate(
  grid: BlockGrid,
  levels: Int8Array,
  queue: number[],
  transmission: ReadonlyMap<string, boolean>,
): void {
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
      if (
        !grid.inBounds(nx, ny, nz) ||
        !transmitsSky(grid.get(nx, ny, nz), transmission)
      )
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
export function skyLightLevels(
  grid: BlockGrid,
  transmission: ReadonlyMap<string, boolean>,
): Int8Array {
  const top = skyline(grid, transmission);
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
  propagate(grid, levels, queue, transmission);
  return levels;
}

/**
 * Faces coloured by the light of the cell outside them: the brighter of the
 * grid's block light and its sky light. Unlit faces go red.
 */
export function shadeLight(
  quads: readonly Quad[],
  grid: BlockGrid,
  light: { block: Int8Array; sky: Int8Array },
  origin: Vec3 = ZERO_ORIGIN,
): Quad[] {
  return quads.map((quad) => {
    if (quad.normal === null) return quad;
    const outside = outsidePoint(quad, quad.normal);
    const x = Math.floor(outside[0] + origin.x);
    const y = Math.floor(outside[1] + origin.y);
    const z = Math.floor(outside[2] + origin.z);
    const level = grid.inBounds(x, y, z)
      ? Math.max(
          light.block[grid.index(x, y, z)] ?? 0,
          light.sky[grid.index(x, y, z)] ?? 0,
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
