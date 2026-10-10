import type { Quad, V3 } from "./mesh.ts";

const EPSILON = 1e-7;
const subtract = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Two-sided ray/triangle intersection, retaining UVs for the opacity test. */
function opaqueHit(
  quad: Quad,
  ray: { from: V3; direction: V3; distance: number },
  triangle: readonly [number, number, number],
): boolean {
  const [ia, ib, ic] = triangle;
  const a = quad.corners[ia],
    b = quad.corners[ib],
    c = quad.corners[ic];
  const uvA = quad.uv[ia],
    uvB = quad.uv[ib],
    uvC = quad.uv[ic];
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    uvA === undefined ||
    uvB === undefined ||
    uvC === undefined
  )
    throw new Error("missing shadow triangle vertex");
  const ab = subtract(b, a),
    ac = subtract(c, a);
  const p = cross(ray.direction, ac),
    determinant = dot(ab, p);
  if (Math.abs(determinant) < EPSILON) return false;
  const offset = subtract(ray.from, a);
  const u = dot(offset, p) / determinant;
  if (u < -EPSILON || u > 1 + EPSILON) return false;
  const q = cross(offset, ab);
  const v = dot(ray.direction, q) / determinant;
  if (v < -EPSILON || u + v > 1 + EPSILON) return false;
  const distance = dot(ac, q) / determinant;
  if (distance <= EPSILON || distance > ray.distance) return false;
  const uv = [0, 1].map(
    (axis) =>
      (uvA[axis] ?? 0) * (1 - u - v) +
      (uvB[axis] ?? 0) * u +
      (uvC[axis] ?? 0) * v,
  );
  const { texture } = quad;
  const x = Math.min(
    texture.width - 1,
    Math.max(0, Math.floor(((uv[0] ?? 0) / 16) * texture.width)),
  );
  const y = Math.min(
    texture.height - 1,
    Math.max(0, Math.floor(((uv[1] ?? 0) / 16) * texture.height)),
  );
  // Translucent pixels do not cast binary, fully opaque relief shadows.
  return (
    quad.alpha === 1 && texture.pixels[(y * texture.width + x) * 4 + 3] === 255
  );
}

/** Spatial index of resolved, textured surfaces, including partial and rotated models. */
export class ShadowIndex {
  private readonly cells = new Map<string, Quad[]>();

  constructor(quads: readonly Quad[]) {
    for (const quad of quads) {
      const low = [0, 1, 2].map((axis) =>
        Math.floor(Math.min(...quad.corners.map((p) => p[axis] ?? 0))),
      );
      const high = [0, 1, 2].map((axis) =>
        Math.floor(Math.max(...quad.corners.map((p) => p[axis] ?? 0))),
      );
      for (let x = low[0] ?? 0; x <= (high[0] ?? 0); x += 1)
        for (let y = low[1] ?? 0; y <= (high[1] ?? 0); y += 1)
          for (let z = low[2] ?? 0; z <= (high[2] ?? 0); z += 1) {
            const key = [x, y, z].join(",");
            const bucket = this.cells.get(key) ?? [];
            bucket.push(quad);
            this.cells.set(key, bucket);
          }
    }
  }

  /** Exact grid traversal prevents narrow surfaces from falling between march samples. */
  hit(from: V3, direction: V3, distance: number): boolean {
    const cell = from.map((value) => Math.floor(value));
    const steps = direction.map((value) => Math.sign(value));
    const delta = direction.map((value) =>
      value === 0 ? Infinity : Math.abs(1 / value),
    );
    const next = direction.map((value, axis) =>
      value === 0
        ? Infinity
        : ((cell[axis] ?? 0) + (value > 0 ? 1 : 0) - (from[axis] ?? 0)) / value,
    );
    let travelled = 0;
    const seen = new Set<Quad>();
    while (travelled <= distance) {
      for (const quad of this.cells.get(cell.join(",")) ?? []) {
        if (seen.has(quad)) continue;
        seen.add(quad);
        const ray = { from, direction, distance };
        if (opaqueHit(quad, ray, [0, 1, 2]) || opaqueHit(quad, ray, [0, 2, 3]))
          return true;
      }
      const axis = next.indexOf(Math.min(...next));
      travelled = next[axis] ?? Infinity;
      if (!Number.isFinite(travelled)) break;
      cell[axis] = (cell[axis] ?? 0) + (steps[axis] ?? 0);
      next[axis] = travelled + (delta[axis] ?? Infinity);
    }
    return false;
  }

  between(from: V3, to: V3): boolean {
    const vector = subtract(to, from);
    const distance = Math.hypot(...vector);
    return (
      distance > EPSILON &&
      this.hit(
        from,
        [vector[0] / distance, vector[1] / distance, vector[2] / distance],
        distance,
      )
    );
  }
}
