import { describe, expect, test } from "vitest";
import type { Quad, V3 } from "#src/render/mesh.ts";
import { ShadowIndex } from "#src/render/shadow.ts";

const turn = ([x, y, z]: V3): V3 => [x + z, y, z];

function plane(alpha = 255): Quad {
  return {
    corners: [
      [0.49, 0, 0],
      [0.49, 1, 0],
      [0.49, 1, 1],
      [0.49, 0, 1],
    ],
    uv: [
      [0, 0],
      [16, 0],
      [16, 16],
      [0, 16],
    ],
    texture: {
      width: 2,
      height: 1,
      pixels: new Uint8Array([255, 255, 255, alpha, 255, 255, 255, 255]),
      cutout: alpha === 0,
      translucent: alpha > 0 && alpha < 255,
    },
    color: [1, 1, 1],
    layer: "cutout",
    alpha: 1,
    normal: [1, 0, 0],
  };
}

describe("resolved relief surfaces", () => {
  test("finds a thin plane between the former half-block march samples", () => {
    const shadows = new ShadowIndex([plane()]);
    expect(shadows.hit([0, 0.25, 0.25], [1, 0, 0], 2)).toBe(true);
    expect(shadows.hit([0, 1.1, 0.25], [1, 0, 0], 2)).toBe(false);
    expect(shadows.hit([0, 0.25, 0.25], [1, 0, 0], 0.48)).toBe(false);
    expect(shadows.hit([1, 0.25, 0.25], [-1, 0, 0], 2)).toBe(true);
  });

  test.each([0, 128])("respects alpha %i at the intersected UV", (alpha) => {
    const shadows = new ShadowIndex([plane(alpha)]);
    expect(shadows.hit([0, 0.25, 0.25], [1, 0, 0], 2)).toBe(false);
    expect(shadows.hit([0, 0.75, 0.25], [1, 0, 0], 2)).toBe(true);
  });

  test("intersects rotated geometry and applies the same test to corner occlusion", () => {
    const quad = plane();
    quad.corners = [
      turn(quad.corners[0]),
      turn(quad.corners[1]),
      turn(quad.corners[2]),
      turn(quad.corners[3]),
    ];
    const shadows = new ShadowIndex([quad]);
    expect(shadows.between([0, 0.25, 0.5], [2, 0.25, 0.5])).toBe(true);
    expect(shadows.between([0, 0.25, 1.1], [2, 0.25, 1.1])).toBe(false);
  });
});
