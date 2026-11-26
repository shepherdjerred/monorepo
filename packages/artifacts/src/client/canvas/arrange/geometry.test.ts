import { describe, expect, test } from "vitest";
import {
  clickSelection,
  framesInMarquee,
  marqueeSelection,
  MIN_HEIGHT,
  MIN_WIDTH,
  rectBetween,
  resizeRect,
  snap,
  snapDelta,
  stepOrder,
} from "./geometry.ts";

const start = { x: 100, y: 100, w: 400, h: 300 };

describe("snapping", () => {
  test("rounds to the 8 px grid", () => {
    expect(snap(0)).toBe(0);
    expect(snap(3)).toBe(0);
    expect(snap(4)).toBe(8);
    expect(snap(-5)).toBe(-8);
    expect(snap(13)).toBe(16);
  });

  test("the lead frame lands on the grid and the others keep their offsets", () => {
    const lead = { x: 101, y: 203, w: 100, h: 100 };
    const delta = snapDelta(lead, { x: 22, y: -9 }, true);
    expect(lead.x + delta.x).toBe(120);
    expect(lead.y + delta.y).toBe(192);
    // Another frame 7 px right of the lead stays 7 px right of it.
    expect(108 + delta.x - (lead.x + delta.x)).toBe(7);
  });

  test("Alt moves freely", () => {
    expect(snapDelta(start, { x: 3, y: 5 }, false)).toEqual({ x: 3, y: 5 });
  });
});

describe("marquee", () => {
  const frames = [
    { id: "a", rect: { x: 0, y: 0, w: 100, h: 100 } },
    { id: "b", rect: { x: 200, y: 0, w: 100, h: 100 } },
    { id: "c", rect: { x: 0, y: 300, w: 100, h: 100 } },
  ];

  test("builds the rectangle whichever way the drag went", () => {
    expect(rectBetween({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      w: 40,
      h: 60,
    });
  });

  test("hits every frame it touches, even by a corner", () => {
    expect(framesInMarquee(frames, { x: 90, y: 90, w: 120, h: 5 })).toEqual([
      "a",
      "b",
    ]);
    expect(framesInMarquee(frames, { x: 500, y: 500, w: 5, h: 5 })).toEqual([]);
  });

  test("a frame it only borders is not hit", () => {
    expect(framesInMarquee(frames, { x: 100, y: 0, w: 50, h: 50 })).toEqual([]);
  });

  test("Shift adds to the selection, otherwise the marquee replaces it", () => {
    expect([...marqueeSelection(new Set(["c"]), ["a"], true)]).toEqual([
      "c",
      "a",
    ]);
    expect([...marqueeSelection(new Set(["c"]), ["a"], false)]).toEqual(["a"]);
  });

  test("click selects one, Shift-click toggles", () => {
    expect([...clickSelection(new Set(["a"]), "b", false)]).toEqual(["b"]);
    expect([...clickSelection(new Set(["a"]), "b", true)]).toEqual(["a", "b"]);
    expect([...clickSelection(new Set(["a", "b"]), "b", true)]).toEqual(["a"]);
  });
});

describe("resizing", () => {
  const free = { aspect: null, snap: false } as const;

  test("the east handle moves only the right edge", () => {
    expect(resizeRect(start, "e", { x: 50, y: 99 }, free)).toEqual({
      x: 100,
      y: 100,
      w: 450,
      h: 300,
    });
  });

  test("the north-west handle keeps the south-east corner fixed", () => {
    const next = resizeRect(start, "nw", { x: 40, y: 30 }, free);
    expect(next.x + next.w).toBe(500);
    expect(next.y + next.h).toBe(400);
    expect(next).toEqual({ x: 140, y: 130, w: 360, h: 270 });
  });

  test("never shrinks below the minimum", () => {
    const next = resizeRect(start, "se", { x: -1000, y: -1000 }, free);
    expect(next.w).toBe(MIN_WIDTH);
    expect(next.h).toBe(MIN_HEIGHT);
    const west = resizeRect(start, "w", { x: 1000, y: 0 }, free);
    expect(west.x + west.w).toBe(500);
    expect(west.w).toBe(MIN_WIDTH);
  });

  test("a fixed-viewport frame keeps its aspect from a corner", () => {
    const aspect = 1440 / 900;
    const next = resizeRect(
      { x: 0, y: 0, w: 320, h: 200 },
      "se",
      { x: 160, y: 10 },
      { aspect, snap: false },
    );
    expect(next.w / next.h).toBeCloseTo(aspect, 10);
    expect(next.w).toBeCloseTo(480, 10);
  });

  test("and from an edge, the other dimension follows", () => {
    const aspect = 2;
    const east = resizeRect(
      { x: 0, y: 0, w: 200, h: 100 },
      "e",
      { x: 100, y: 0 },
      { aspect, snap: false },
    );
    expect(east).toEqual({ x: 0, y: 0, w: 300, h: 150 });
    const north = resizeRect(
      { x: 0, y: 0, w: 200, h: 100 },
      "n",
      { x: 0, y: -50 },
      { aspect, snap: false },
    );
    expect(north.h).toBe(150);
    expect(north.w).toBe(300);
    // The south edge is the anchor.
    expect(north.y + north.h).toBe(100);
  });

  test("with an aspect and the minimum the ratio still holds", () => {
    const next = resizeRect(
      { x: 0, y: 0, w: 320, h: 200 },
      "se",
      { x: -900, y: -900 },
      { aspect: 1.6, snap: false },
    );
    expect(next.w / next.h).toBeCloseTo(1.6, 10);
    expect(next.w).toBeGreaterThanOrEqual(MIN_WIDTH);
    expect(next.h).toBeGreaterThanOrEqual(MIN_HEIGHT);
  });

  test("snaps the dragged edges to the grid", () => {
    const next = resizeRect(
      start,
      "se",
      { x: 13, y: 21 },
      { aspect: null, snap: true },
    );
    expect((next.x + next.w) % 8).toBe(0);
    expect((next.y + next.h) % 8).toBe(0);
  });
});

describe("z-order", () => {
  const order = ["a", "b", "c", "d"];

  test("forward moves past the next unselected neighbour", () => {
    expect(stepOrder(order, new Set(["b"]), "forward")).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
    expect(stepOrder(order, new Set(["d"]), "forward")).toEqual(order);
  });

  test("backward mirrors it", () => {
    expect(stepOrder(order, new Set(["c"]), "backward")).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
    expect(stepOrder(order, new Set(["a"]), "backward")).toEqual(order);
  });

  test("a selection keeps its internal order and never swaps within itself", () => {
    expect(stepOrder(order, new Set(["a", "b"]), "forward")).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
    expect(stepOrder(order, new Set(["c", "d"]), "backward")).toEqual([
      "a",
      "c",
      "d",
      "b",
    ]);
  });

  test("front and back go to the ends", () => {
    expect(stepOrder(order, new Set(["b"]), "front")).toEqual([
      "a",
      "c",
      "d",
      "b",
    ]);
    expect(stepOrder(order, new Set(["c", "b"]), "back")).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });
});
