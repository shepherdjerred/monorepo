import { describe, expect, test } from "vitest";
import type { Quad, V3 } from "#src/render/mesh.ts";
import { surfaceNormal, surfaceTangents } from "#src/render/surface.ts";
import { shadeRelief } from "#src/render/shading.ts";

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("geometric relief normals", () => {
  test.each([-45, -22.5, 22.5, 45])(
    "uses the actual %i degree face plane",
    (degrees) => {
      const angle = (degrees / 180) * Math.PI;
      const s = Math.sin(angle),
        c = Math.cos(angle);
      const turn = ([x, y, z]: V3): V3 => [x, y * c - z * s, y * s + z * c];
      const corners: Quad["corners"] = [
        turn([0, 1, 0]),
        turn([1, 1, 0]),
        turn([1, 1, 1]),
        turn([0, 1, 1]),
      ];
      const normal = surfaceNormal(corners);
      if (normal === null) throw new Error("missing surface normal");
      expect(normal[0]).toBeCloseTo(0);
      expect(normal[1]).toBeCloseTo(c);
      expect(normal[2]).toBeCloseTo(s);
      const [u, v] = surfaceTangents(normal);
      expect(dot(u, normal)).toBeCloseTo(0);
      expect(dot(v, normal)).toBeCloseTo(0);
      expect(dot(u, v)).toBeCloseTo(0);
      expect(Math.hypot(...u)).toBeCloseTo(1);
      expect(Math.hypot(...v)).toBeCloseTo(1);
      const quad: Quad = {
        corners,
        normal: [0, 1, 0],
        color: [1, 1, 1],
        uv: [
          [0, 0],
          [16, 0],
          [16, 16],
          [0, 16],
        ],
        alpha: 1,
        layer: "solid",
        texture: {
          width: 1,
          height: 1,
          pixels: new Uint8Array([255, 255, 255, 255]),
          cutout: false,
          translucent: false,
        },
      };
      const shaded = shadeRelief([quad], { sun: { yaw: 0, pitch: 90 } })[0];
      expect(shaded?.color[0]).toBeCloseTo(0.55 + 0.45 * c);
    },
  );
});
