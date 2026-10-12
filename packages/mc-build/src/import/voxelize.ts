import { FACE_NEIGHBORS, type Vec3 } from "#src/core/grid.ts";
import {
  sampleMaterial,
  type Mesh,
  type Rgb,
  type Triangle,
  type Vec2f,
  type Vec3f,
} from "./obj.ts";

/**
 * Surface voxelization: every unit voxel a triangle touches (exact
 * triangle/box overlap, Akenine-Möller's separating-axis test) gets the
 * average color the overlapping triangles show at their closest point to the
 * voxel center. `solid` also fills enclosed voxels: everything a flood fill
 * from the grid boundary cannot reach, colored like the nearest surface.
 */

export type VoxelizeOptions = {
  /** Model height in blocks; x and z keep the model's proportions. */
  height: number;
  solid: boolean;
};

export type Voxels = {
  size: Vec3;
  /** Voxel index ((y * sizeZ + z) * sizeX + x) → color. */
  colors: Map<number, Rgb>;
  surface: number;
  interior: number;
};

type V = { x: number; y: number; z: number };
type Tri = readonly [V, V, V];
export type Box = { center: V; half: number };

const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V, b: V): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V, b: V): V => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

function separatingAxes(v0: V, v1: V, v2: V): V[] {
  const edges = [sub(v1, v0), sub(v2, v1), sub(v0, v2)];
  const axes = edges.flatMap((edge) => [
    { x: 0, y: -edge.z, z: edge.y },
    { x: edge.z, y: 0, z: -edge.x },
    { x: -edge.y, y: edge.x, z: 0 },
  ]);
  axes.push({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
  axes.push(cross(sub(v1, v0), sub(v2, v1)));
  return axes;
}

/** True when the triangle overlaps the axis-aligned box. */
export function triangleBoxOverlap(box: Box, triangle: Tri): boolean {
  const [a, b, c] = triangle;
  const v0 = sub(a, box.center);
  const v1 = sub(b, box.center);
  const v2 = sub(c, box.center);
  return separatingAxes(v0, v1, v2).every((axis) => {
    const extent = Math.abs(axis.x) + Math.abs(axis.y) + Math.abs(axis.z);
    if (extent === 0) {
      return true;
    }
    const p0 = dot(v0, axis);
    const p1 = dot(v1, axis);
    const p2 = dot(v2, axis);
    const radius = box.half * extent;
    return Math.min(p0, p1, p2) <= radius && Math.max(p0, p1, p2) >= -radius;
  });
}

/** Barycentric weights of the point on the triangle closest to p (Ericson, RTCD 5.1.5). */
export function closestBarycentric(
  p: V,
  triangle: Tri,
): [number, number, number] {
  const [a, b, c] = triangle;
  const ab = sub(b, a);
  const ac = sub(c, a);
  const d1 = dot(ab, sub(p, a));
  const d2 = dot(ac, sub(p, a));
  if (d1 <= 0 && d2 <= 0) {
    return [1, 0, 0];
  }
  const d3 = dot(ab, sub(p, b));
  const d4 = dot(ac, sub(p, b));
  if (d3 >= 0 && d4 <= d3) {
    return [0, 1, 0];
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [1 - v, v, 0];
  }
  const d5 = dot(ab, sub(p, c));
  const d6 = dot(ac, sub(p, c));
  if (d6 >= 0 && d5 <= d6) {
    return [0, 0, 1];
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [1 - w, 0, w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [0, 1 - w, w];
  }
  const denom = 1 / (va + vb + vc);
  return [1 - (vb + vc) * denom, vb * denom, vc * denom];
}

function bounds(mesh: Mesh): { min: Vec3f; max: Vec3f } {
  // Loops, not Math.min(...points): large meshes would overflow the call stack.
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const triangle of mesh.triangles) {
    for (const point of triangle.positions) {
      min.x = Math.min(min.x, point.x);
      min.y = Math.min(min.y, point.y);
      min.z = Math.min(min.z, point.z);
      max.x = Math.max(max.x, point.x);
      max.y = Math.max(max.y, point.y);
      max.z = Math.max(max.z, point.z);
    }
  }
  return { min, max };
}

/** Calls `visit` for every integer cell in the inclusive box lo..hi (YZX order). */
function forEachCell(
  lo: V,
  hi: V,
  visit: (x: number, y: number, z: number) => void,
): void {
  for (let y = lo.y; y <= hi.y; y += 1) {
    for (let z = lo.z; z <= hi.z; z += 1) {
      for (let x = lo.x; x <= hi.x; x += 1) {
        visit(x, y, z);
      }
    }
  }
}

type Sum = { r: number; g: number; b: number; n: number };

function clamp(value: number, limit: number): number {
  return Math.max(0, Math.min(limit - 1, Math.floor(value)));
}

class Grid {
  readonly sums = new Map<number, Sum>();
  constructor(readonly size: Vec3) {}

  index(x: number, y: number, z: number): number {
    return (y * this.size.z + z) * this.size.x + x;
  }

  coords(key: number): V {
    const x = key % this.size.x;
    const rest = (key - x) / this.size.x;
    const z = rest % this.size.z;
    return { x, y: (rest - z) / this.size.z, z };
  }

  contains(p: V): boolean {
    return (
      p.x >= 0 &&
      p.y >= 0 &&
      p.z >= 0 &&
      p.x < this.size.x &&
      p.y < this.size.y &&
      p.z < this.size.z
    );
  }

  cellRange(lo: V, hi: V): { lo: V; hi: V } {
    return {
      lo: {
        x: clamp(lo.x, this.size.x),
        y: clamp(lo.y, this.size.y),
        z: clamp(lo.z, this.size.z),
      },
      hi: {
        x: clamp(hi.x, this.size.x),
        y: clamp(hi.y, this.size.y),
        z: clamp(hi.z, this.size.z),
      },
    };
  }

  add(key: number, color: Rgb): void {
    const sum = this.sums.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    sum.r += color.r;
    sum.g += color.g;
    sum.b += color.b;
    sum.n += 1;
    this.sums.set(key, sum);
  }
}

function colorAt(triangle: Triangle, weights: [number, number, number]): Rgb {
  let uv: Vec2f | null = null;
  if (triangle.uvs !== null) {
    const [ua, ub, uc] = triangle.uvs;
    const [wa, wb, wc] = weights;
    uv = {
      u: ua.u * wa + ub.u * wb + uc.u * wc,
      v: ua.v * wa + ub.v * wb + uc.v * wc,
    };
  }
  return sampleMaterial(triangle.material, uv);
}

function rasterize(
  grid: Grid,
  triangle: Triangle,
  toGrid: (p: Vec3f) => V,
): void {
  const [pa, pb, pc] = triangle.positions;
  const tri: Tri = [toGrid(pa), toGrid(pb), toGrid(pc)];
  const [a, b, c] = tri;
  const range = grid.cellRange(
    {
      x: Math.min(a.x, b.x, c.x),
      y: Math.min(a.y, b.y, c.y),
      z: Math.min(a.z, b.z, c.z),
    },
    {
      x: Math.max(a.x, b.x, c.x),
      y: Math.max(a.y, b.y, c.y),
      z: Math.max(a.z, b.z, c.z),
    },
  );
  forEachCell(range.lo, range.hi, (x, y, z) => {
    const center = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
    if (triangleBoxOverlap({ center, half: 0.5 }, tri)) {
      grid.add(
        grid.index(x, y, z),
        colorAt(triangle, closestBarycentric(center, tri)),
      );
    }
  });
}

export function voxelize(mesh: Mesh, options: VoxelizeOptions): Voxels {
  if (
    !Number.isInteger(options.height) ||
    options.height < 1 ||
    options.height > 384
  ) {
    throw new Error(
      `Mesh height must be an integer from 1 to 384 blocks, got ${String(options.height)}`,
    );
  }
  const { min, max } = bounds(mesh);
  const extentY = max.y - min.y;
  if (!(extentY > 0)) {
    throw new Error("Mesh is flat along Y; it has no height to scale");
  }
  const scale = options.height / extentY;
  const size = {
    x: Math.max(1, Math.ceil((max.x - min.x) * scale)),
    y: options.height,
    z: Math.max(1, Math.ceil((max.z - min.z) * scale)),
  };
  if (size.x * size.y * size.z > 16_000_000) {
    throw new Error(
      `Voxel grid ${size.x.toString()}×${size.y.toString()}×${size.z.toString()} is too large; lower --height`,
    );
  }
  const grid = new Grid(size);
  const toGrid = (p: Vec3f): V => ({
    x: (p.x - min.x) * scale,
    y: (p.y - min.y) * scale,
    z: (p.z - min.z) * scale,
  });
  for (const triangle of mesh.triangles) {
    rasterize(grid, triangle, toGrid);
  }
  const colors = new Map<number, Rgb>();
  for (const [key, sum] of grid.sums) {
    colors.set(key, { r: sum.r / sum.n, g: sum.g / sum.n, b: sum.b / sum.n });
  }
  const surface = colors.size;
  const interior = options.solid ? fillInterior(grid, colors) : 0;
  return { size, colors, surface, interior };
}

function neighborKeys(grid: Grid, key: number): number[] {
  const p = grid.coords(key);
  return FACE_NEIGHBORS.map((step) => ({
    x: p.x + step.x,
    y: p.y + step.y,
    z: p.z + step.z,
  }))
    .filter((next) => grid.contains(next))
    .map((next) => grid.index(next.x, next.y, next.z));
}

/** Marks every empty voxel reachable from the grid boundary. */
function floodOutside(grid: Grid, colors: Map<number, Rgb>): Uint8Array {
  const { x: sx, y: sy, z: sz } = grid.size;
  const outside = new Uint8Array(sx * sy * sz);
  const queue: number[] = [];
  const seed = (x: number, y: number, z: number): void => {
    const key = grid.index(x, y, z);
    if (outside[key] === 0 && !colors.has(key)) {
      outside[key] = 1;
      queue.push(key);
    }
  };
  forEachCell(
    { x: 0, y: 0, z: 0 },
    { x: sx - 1, y: sy - 1, z: sz - 1 },
    (x, y, z) => {
      if (
        x === 0 ||
        y === 0 ||
        z === 0 ||
        x === sx - 1 ||
        y === sy - 1 ||
        z === sz - 1
      ) {
        seed(x, y, z);
      }
    },
  );
  for (const key of queue) {
    for (const next of neighborKeys(grid, key)) {
      const p = grid.coords(next);
      seed(p.x, p.y, p.z);
    }
  }
  return outside;
}

/** Fills voxels not reachable from outside with the nearest surface color; returns how many. */
function fillInterior(grid: Grid, colors: Map<number, Rgb>): number {
  const outside = floodOutside(grid, colors);
  const frontier = [...colors.keys()];
  let filled = 0;
  for (const key of frontier) {
    const color = colors.get(key);
    if (color === undefined) {
      continue;
    }
    for (const next of neighborKeys(grid, key)) {
      if (outside[next] === 0 && !colors.has(next)) {
        colors.set(next, color);
        frontier.push(next);
        filled += 1;
      }
    }
  }
  return filled;
}
