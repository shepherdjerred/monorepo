import { expect, it } from "vitest";
import { perspectiveProjector } from "#src/render/camera.ts";
import { Image, rasterize } from "#src/render/raster.ts";
import type { Quad } from "#src/render/mesh.ts";
import type { Texture } from "#src/render/textures.ts";

const project = perspectiveProjector({
  eye: [0, 0, 0],
  target: [0, 0, -1],
  fovDegrees: 90,
  frame: { width: 32, height: 32 },
});

function texture(color: (x: number, y: number) => number[]): Texture {
  const pixels = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y += 1)
    for (let x = 0; x < 16; x += 1)
      pixels.set([...color(x, y), 255], (y * 16 + x) * 4);
  return { width: 16, height: 16, pixels, cutout: false, translucent: false };
}

/** A plane at depth = 0.8*x + 1.6, projecting to the square (4,4)..(28,28). */
function slanted(map: Texture): Quad {
  return {
    corners: [
      [-0.75, 0.75, -1],
      [3, 3, -4],
      [3, -3, -4],
      [-0.75, -0.75, -1],
    ],
    // UV is affine in world space: u=(x+0.75)*16/3.75, v=(3-y)*16/6.
    uv: [
      [0, 6],
      [16, 0],
      [16, 16],
      [0, 10],
    ],
    texture: map,
    color: [1, 1, 1],
    layer: "solid",
    alpha: 1,
    normal: null,
  };
}

function pixel(image: Image, x: number, y: number) {
  return [
    ...image.pixels.subarray(
      (y * image.width + x) * 4,
      (y * image.width + x) * 4 + 4,
    ),
  ];
}

it.each([
  [10, 7],
  [7, 20],
])(
  "samples UV at the ray/plane intersection in both triangles (%s,%s)",
  (px, py) => {
    const image = new Image(32, 32);
    rasterize(
      image,
      [slanted(texture((x, y) => [x * 16, y * 16, 0]))],
      project,
    );
    const rayX = (px + 0.5 - 16) / 16;
    const rayY = (16 - py - 0.5) / 16;
    const depth = 1.6 / (1 - 0.8 * rayX);
    const u = ((rayX * depth + 0.75) * 16) / 3.75;
    const v = ((3 - rayY * depth) * 16) / 6;
    expect(pixel(image, px, py)).toEqual([
      Math.floor(u) * 16,
      Math.floor(v) * 16,
      0,
      255,
    ]);
  },
);

it.each([false, true])(
  "depth-tests intersecting planes independently of draw order (reverse: %s)",
  (reverse) => {
    const image = new Image(32, 32);
    const tilted = slanted(texture(() => [0, 0, 255]));
    const flat: Quad = {
      ...slanted(texture(() => [255, 0, 0])),
      corners: [
        [-1.5, 1.5, -2],
        [1.5, 1.5, -2],
        [1.5, -1.5, -2],
        [-1.5, -1.5, -2],
      ],
    };
    rasterize(image, reverse ? [flat, tilted] : [tilted, flat], project);
    expect(pixel(image, 12, 12)).toEqual([0, 0, 255, 255]);
    expect(pixel(image, 24, 12)).toEqual([255, 0, 0, 255]);
  },
);
