import { describe, expect, test } from "bun:test";
import { labelPosition, seatsForMode, viewportRects } from "./layout.ts";

describe("viewportRects", () => {
  test("1p is a single fullscreen viewport", () => {
    expect(viewportRects("1p", 1, 640, 240)).toEqual([
      { x: 0, y: 0, w: 640, h: 240 },
    ]);
  });

  test("2p horizontal splits into stacked halves", () => {
    expect(viewportRects("2p-horizontal", 2, 640, 240)).toEqual([
      { x: 0, y: 0, w: 640, h: 120 },
      { x: 0, y: 120, w: 640, h: 120 },
    ]);
  });

  test("2p vertical splits into side-by-side halves", () => {
    expect(viewportRects("2p-vertical", 2, 640, 240)).toEqual([
      { x: 0, y: 0, w: 320, h: 240 },
      { x: 320, y: 0, w: 320, h: 240 },
    ]);
  });

  test("4p quad yields four quadrants", () => {
    const rects = viewportRects("quad", 4, 640, 240);
    expect(rects).toHaveLength(4);
    expect(rects[3]).toEqual({ x: 320, y: 120, w: 320, h: 120 });
  });

  test("3p quad omits the bottom-right map quadrant", () => {
    const rects = viewportRects("quad", 3, 640, 240);
    expect(rects).toHaveLength(3);
    expect(rects.map((r) => [r.x, r.y])).toEqual([
      [0, 0],
      [320, 0],
      [0, 120],
    ]);
  });
});

describe("labelPosition", () => {
  test("anchors to the bottom-right with a margin", () => {
    const vp = { x: 320, y: 120, w: 320, h: 120 };
    const pos = labelPosition(vp, { width: 100, height: 16 }, 4);
    expect(pos).toEqual({ x: 320 + 320 - 100 - 4, y: 120 + 120 - 16 - 4 });
  });

  test("clamps to the viewport origin when the label is wider than the viewport", () => {
    const vp = { x: 0, y: 0, w: 50, h: 20 };
    const pos = labelPosition(vp, { width: 200, height: 40 }, 4);
    expect(pos).toEqual({ x: 0, y: 0 });
  });
});

describe("seatsForMode", () => {
  test("maps each mode to its viewport count", () => {
    expect(seatsForMode("1p")).toBe(1);
    expect(seatsForMode("2p-horizontal")).toBe(2);
    expect(seatsForMode("2p-vertical")).toBe(2);
    expect(seatsForMode("quad")).toBe(4);
  });
});
