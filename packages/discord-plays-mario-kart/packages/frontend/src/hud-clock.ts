// Canvas bridge for the HUD clock decoder. The decoding itself lives in
// `@discord-plays-mario-kart/common` so the backend can round-trip it against
// the real renderer in tests; only the ImageData plumbing is browser-specific.

import {
  HUD_CLOCK_BOX,
  HUD_SOURCE_WIDTH,
  HUD_SOURCE_HEIGHT,
  type HudSampler,
} from "@discord-plays-mario-kart/common";

/**
 * Build a sampler over pixels captured from the painted canvas.
 *
 * `region` is the canvas-space rectangle the pixels came from; source
 * coordinates are mapped through the encoder's scale factor, so this works for
 * any configured output height rather than only the 640x480 default.
 */
export function samplerForImageData(
  pixels: ImageData,
  region: { x: number; y: number; width: number; height: number },
  outputWidth: number,
  outputHeight: number,
): HudSampler {
  const scaleX = outputWidth / HUD_SOURCE_WIDTH;
  const scaleY = outputHeight / HUD_SOURCE_HEIGHT;
  return {
    lumaAt: (sourceX, sourceY) => {
      const x = Math.floor(sourceX * scaleX) - region.x;
      const y = Math.floor(sourceY * scaleY) - region.y;
      if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) return 0;
      // The overlay writes pure greyscale, so any colour channel is the luma.
      return pixels.data[(y * pixels.width + x) * 4] ?? 0;
    },
  };
}

/** The canvas-space rectangle to capture for a given output size. */
export function hudClockRegion(
  outputWidth: number,
  outputHeight: number,
): { x: number; y: number; width: number; height: number } {
  const scaleX = outputWidth / HUD_SOURCE_WIDTH;
  const scaleY = outputHeight / HUD_SOURCE_HEIGHT;
  return {
    x: Math.floor(HUD_CLOCK_BOX.x * scaleX),
    y: Math.floor(HUD_CLOCK_BOX.y * scaleY),
    width: Math.ceil(HUD_CLOCK_BOX.width * scaleX) + 1,
    height: Math.ceil(HUD_CLOCK_BOX.height * scaleY) + 1,
  };
}
