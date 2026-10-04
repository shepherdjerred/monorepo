import type { Quad, V3 } from "./mesh.ts";

export type Rgba = readonly [number, number, number, number];

/** RGBA image buffer with simple 2D drawing helpers. */
export class Image {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgba = [0, 0, 0, 0],
  ) {
    this.pixels = new Uint8Array(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      this.pixels.set(background, index * 4);
    }
  }

  fillRect(
    rect: { x: number; y: number; w: number; h: number },
    rgba: Rgba,
  ): void {
    const x0 = Math.max(0, Math.floor(rect.x));
    const y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(this.width, Math.floor(rect.x + rect.w));
    const y1 = Math.min(this.height, Math.floor(rect.y + rect.h));
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        this.blend(px, py, rgba);
      }
    }
  }

  blend(px: number, py: number, rgba: Rgba): void {
    const index = (py * this.width + px) * 4;
    const alpha = rgba[3] / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      const base = this.pixels[index + channel] ?? 0;
      this.pixels[index + channel] = Math.round(
        base + ((rgba[channel] ?? 0) - base) * alpha,
      );
    }
    this.pixels[index + 3] = Math.max(this.pixels[index + 3] ?? 0, rgba[3]);
  }

  /** Copies another image in at (x, y). */
  blit(source: Image, x: number, y: number): void {
    for (let sy = 0; sy < source.height; sy += 1) {
      const ty = y + sy;
      const start = Math.max(0, -x);
      const end = Math.min(source.width, this.width - x);
      if (ty >= 0 && ty < this.height && end > start) {
        const row = source.pixels.subarray(
          (sy * source.width + start) * 4,
          (sy * source.width + end) * 4,
        );
        this.pixels.set(row, (ty * this.width + x + start) * 4);
      }
    }
  }
}

export type Projected = { x: number; y: number; depth: number };
export type Projector = (point: V3) => Projected;

type Triangle = {
  points: readonly [Projected, Projected, Projected];
  uvs: readonly [Quad["uv"][number], Quad["uv"][number], Quad["uv"][number]];
  area: number;
};

function edge(a: Projected, b: Projected, px: number, py: number): number {
  return (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
}

/** Splits a projected quad into its two front-facing triangles. */
function triangles(quad: Quad, corners: readonly Projected[]): Triangle[] {
  const out: Triangle[] = [];
  for (const [i0, i1, i2] of [
    [0, 1, 2],
    [0, 2, 3],
  ] as const) {
    const a = corners[i0];
    const b = corners[i1];
    const c = corners[i2];
    if (a === undefined || b === undefined || c === undefined) {
      continue;
    }
    const area = edge(a, b, c.x, c.y);
    // Faces are wound clockwise on screen when seen from outside (y down);
    // anything else is a back face or edge-on.
    if (area > 0) {
      out.push({
        points: [a, b, c],
        uvs: [quad.uv[i0], quad.uv[i1], quad.uv[i2]],
        area,
      });
    }
  }
  return out;
}

class Rasterizer {
  readonly depth: Float32Array;

  constructor(readonly image: Image) {
    this.depth = new Float32Array(image.width * image.height).fill(Infinity);
  }

  /** Writes one textured pixel; returns false when depth or alpha rejects it. */
  private shade(
    quad: Quad,
    pixel: number,
    uv: readonly [number, number],
  ): boolean {
    const { texture } = quad;
    const tx = Math.min(
      texture.width - 1,
      Math.max(0, Math.floor((uv[0] / 16) * texture.width)),
    );
    const ty = Math.min(
      texture.height - 1,
      Math.max(0, Math.floor((uv[1] / 16) * texture.height)),
    );
    const t = (ty * texture.width + tx) * 4;
    const alpha = ((texture.pixels[t + 3] ?? 255) / 255) * quad.alpha;
    if (quad.layer !== "translucent" && alpha < 0.5) {
      return false;
    }
    const rgb = [0, 1, 2].map(
      (channel) =>
        (texture.pixels[t + channel] ?? 0) * (quad.color[channel] ?? 1),
    );
    const [r = 0, g = 0, b = 0] = rgb;
    if (quad.layer === "translucent") {
      this.image.blend(
        pixel % this.image.width,
        Math.floor(pixel / this.image.width),
        [r, g, b, Math.round(alpha * 255)],
      );
    } else {
      this.image.pixels.set(
        [Math.round(r), Math.round(g), Math.round(b), 255],
        pixel * 4,
      );
    }
    return true;
  }

  draw(quad: Quad, triangle: Triangle, writeDepth: boolean): void {
    const [a, b, c] = triangle.points;
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const maxX = Math.min(
      this.image.width - 1,
      Math.ceil(Math.max(a.x, b.x, c.x)),
    );
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const maxY = Math.min(
      this.image.height - 1,
      Math.ceil(Math.max(a.y, b.y, c.y)),
    );
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        this.pixel(quad, triangle, { px, py }, writeDepth);
      }
    }
  }

  private pixel(
    quad: Quad,
    triangle: Triangle,
    at: { px: number; py: number },
    writeDepth: boolean,
  ): void {
    const { px, py } = at;
    const [a, b, c] = triangle.points;
    const sx = px + 0.5;
    const sy = py + 0.5;
    const l0 = edge(b, c, sx, sy) / triangle.area;
    const l1 = edge(c, a, sx, sy) / triangle.area;
    const l2 = edge(a, b, sx, sy) / triangle.area;
    if (l0 < 0 || l1 < 0 || l2 < 0) {
      return;
    }
    const z = l0 * a.depth + l1 * b.depth + l2 * c.depth;
    const pixel = py * this.image.width + px;
    if (z >= (this.depth[pixel] ?? Infinity) - 1e-6) {
      return;
    }
    const [uvA, uvB, uvC] = triangle.uvs;
    const uv: [number, number] = [
      l0 * uvA[0] + l1 * uvB[0] + l2 * uvC[0],
      l0 * uvA[1] + l1 * uvB[1] + l2 * uvC[1],
    ];
    const drawn = this.shade(quad, pixel, uv);
    if (writeDepth && drawn) {
      this.depth[pixel] = z;
    }
  }
}

/**
 * Z-buffered triangle rasterizer for orthographic views. Solid and cutout
 * quads write depth; translucent quads are drawn afterwards back to front,
 * depth-tested but not depth-writing.
 */
export function rasterize(
  image: Image,
  quads: readonly Quad[],
  project: Projector,
): void {
  const rasterizer = new Rasterizer(image);
  const prepared = quads.map((quad) => {
    const corners = quad.corners.map((corner) => project(corner));
    return {
      quad,
      triangles: triangles(quad, corners),
      depth:
        corners.reduce((sum, point) => sum + point.depth, 0) / corners.length,
    };
  });
  for (const entry of prepared.filter(
    (item) => item.quad.layer !== "translucent",
  )) {
    for (const triangle of entry.triangles) {
      rasterizer.draw(entry.quad, triangle, true);
    }
  }
  const translucent = prepared
    .filter((item) => item.quad.layer === "translucent")
    .toSorted((a, b) => b.depth - a.depth);
  for (const entry of translucent) {
    for (const triangle of entry.triangles) {
      rasterizer.draw(entry.quad, triangle, false);
    }
  }
}
