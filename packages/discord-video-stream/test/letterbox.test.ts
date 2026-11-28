import { describe, expect, test } from "vitest";
import { computeLetterbox, fitWithin } from "../src/media/letterbox.ts";

describe("fitWithin", () => {
  const box = { width: 1920, height: 1080 };

  test.each([
    ["scope 2.39:1 is width-limited", 2.39, { width: 1920, height: 804 }],
    ["IMAX 1.90:1 is width-limited", 1.9, { width: 1920, height: 1010 }],
    ["16:9 fills the box", 16 / 9, { width: 1920, height: 1080 }],
    ["4:3 is height-limited", 4 / 3, { width: 1440, height: 1080 }],
    ["9:16 portrait is height-limited", 9 / 16, { width: 608, height: 1080 }],
  ])("%s", (_name, aspect, expected) => {
    expect(fitWithin(aspect, box)).toEqual(expected);
  });

  test("odd bounds round down so the result never exceeds them", () => {
    const fitted = fitWithin(16 / 9, { width: 1281, height: 721 });
    expect(fitted).toEqual({ width: 1280, height: 720 });
  });

  test("an extreme aspect still yields an encodable picture", () => {
    expect(fitWithin(1000, box).height).toBe(2);
    expect(fitWithin(1 / 1000, box).width).toBe(2);
  });

  test("rejects a non-positive aspect instead of guessing", () => {
    expect(() => fitWithin(0, box)).toThrow(RangeError);
    expect(() => fitWithin(Number.NaN, box)).toThrow(RangeError);
  });
});

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
