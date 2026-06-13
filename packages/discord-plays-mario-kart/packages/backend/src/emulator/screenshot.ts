import { encodePngToSize } from "./png.ts";

export const SCREENSHOT_WIDTH = 640;
export const SCREENSHOT_HEIGHT = 480;

export function encodeScreenshotPng(frame: {
  rgba: Buffer;
  width: number;
  height: number;
}): Buffer {
  return encodePngToSize(frame, {
    width: SCREENSHOT_WIDTH,
    height: SCREENSHOT_HEIGHT,
  });
}
