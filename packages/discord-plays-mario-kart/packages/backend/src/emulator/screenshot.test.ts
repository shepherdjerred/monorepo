import { describe, expect, it } from "vitest";
import {
  decodePng,
  pngRow,
  rgbaFromRgb,
} from "@shepherdjerred/discord-plays-core/image/png-decode.ts";
import {
  encodeScreenshotPng,
  SCREENSHOT_HEIGHT,
  SCREENSHOT_WIDTH,
} from "./screenshot.ts";

describe("encodeScreenshotPng", () => {
  it("encodes emulator screenshots at 4:3 display dimensions", () => {
    const png = encodeScreenshotPng({
      rgba: rgbaFromRgb([
        [255, 0, 0],
        [0, 0, 255],
      ]),
      width: 2,
      height: 1,
    });
    const { width, height, rows } = decodePng(png);
    expect(width).toBe(SCREENSHOT_WIDTH);
    expect(height).toBe(SCREENSHOT_HEIGHT);
    expect([...pngRow(rows, 0).subarray(0, 3)]).toEqual([255, 0, 0]);
    expect([...pngRow(rows, 0).subarray(-3)]).toEqual([0, 0, 255]);
  });
});
