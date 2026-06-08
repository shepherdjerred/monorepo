import { describe, expect, test } from "bun:test";
import { computeLetterbox } from "./letterbox.ts";

describe("computeLetterbox", () => {
  test("GBA 3:2 pillarboxes into a 16:9 720p canvas", () => {
    const { content, canvas } = computeLetterbox(3 / 2, 720);
    expect(canvas).toEqual({ width: 1280, height: 720 });
    expect(content).toEqual({ width: 1080, height: 720 });
  });

  test("4:3 pillarboxes into a 16:9 720p canvas", () => {
    const { content, canvas } = computeLetterbox(4 / 3, 720);
    expect(canvas).toEqual({ width: 1280, height: 720 });
    expect(content).toEqual({ width: 960, height: 720 });
  });

  test("content wider than 16:9 is letterboxed (width-limited)", () => {
    const { content, canvas } = computeLetterbox(2 / 1, 720);
    expect(canvas).toEqual({ width: 1280, height: 720 });
    expect(content).toEqual({ width: 1280, height: 640 });
  });

  test("all dimensions are even (yuv420p requirement)", () => {
    for (const ar of [4 / 3, 3 / 2, 16 / 10, 2.21]) {
      for (const ch of [480, 540, 720, 1080]) {
        const { content, canvas } = computeLetterbox(ar, ch);
        for (const d of [
          content.width,
          content.height,
          canvas.width,
          canvas.height,
        ]) {
          expect(d % 2).toBe(0);
        }
        expect(content.width).toBeLessThanOrEqual(canvas.width);
        expect(content.height).toBeLessThanOrEqual(canvas.height);
      }
    }
  });
});
