import { describe, expect, test } from "bun:test";
import { computeLetterbox } from "../src/media/letterbox.ts";

describe("computeLetterbox", () => {
  test("4:3 pillarboxes into a 16:9 720p canvas", () => {
    const { content, canvas } = computeLetterbox(4 / 3, 720);
    expect(canvas).toEqual({ width: 1280, height: 720 });
    expect(content).toEqual({ width: 960, height: 720 });
  });

  test("3:2 pillarboxes into a 16:9 720p canvas", () => {
    const { content, canvas } = computeLetterbox(3 / 2, 720);
    expect(canvas).toEqual({ width: 1280, height: 720 });
    expect(content).toEqual({ width: 1080, height: 720 });
  });

  test("content wider than 16:9 is letterboxed (width-limited)", () => {
    const { content, canvas } = computeLetterbox(2 / 1, 720);
    expect(canvas).toEqual({ width: 1280, height: 720 });
    expect(content).toEqual({ width: 1280, height: 640 });
  });

  test("ultrawide 21:9 letterboxes to full width with even height", () => {
    // 21/9 ≈ 2.333 > 16:9 → width-limited. At a 1080 canvas: w=1920, h=even(1920/(21/9)).
    const { content, canvas } = computeLetterbox(21 / 9, 1080);
    expect(canvas).toEqual({ width: 1920, height: 1080 });
    expect(content.width).toBe(1920);
    expect(content.height % 2).toBe(0);
    expect(content.height).toBeLessThan(1080);
  });

  test("all dimensions are even and never exceed the canvas", () => {
    for (const ar of [4 / 3, 3 / 2, 16 / 10, 2.21, 1.85]) {
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
