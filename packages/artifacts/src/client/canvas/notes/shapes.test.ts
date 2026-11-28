import { describe, expect, test } from "vitest";
import { EMPTY_BOARD_INDEX } from "@shepherdjerred/artifacts/contract";
import {
  distanceToSegment,
  hitNote,
  noteBounds,
  noteModels,
  STICKY_SIZE,
  topNoteAt,
  withRect,
  type Note,
} from "./shapes.ts";

const sticky: Note = {
  type: "sticky",
  page: 0,
  x: 100,
  y: 100,
  w: 200,
  h: 160,
  text: "Hi",
  color: "yellow",
};
const box: Note = {
  type: "box",
  page: 0,
  x: 0,
  y: 0,
  w: 300,
  h: 200,
  color: "blue",
};
const line: Note = {
  type: "line",
  page: 0,
  x: 0,
  y: 0,
  x2: 100,
  y2: 0,
  color: "red",
};
const arrow: Note = {
  type: "arrow",
  page: 0,
  x: 100,
  y: 100,
  x2: 0,
  y2: 0,
  color: "red",
};
const pen: Note = {
  type: "pen",
  page: 0,
  x: 50,
  y: 50,
  points: [
    [0, 0],
    [30, 0],
    [30, 40],
  ],
  color: "green",
};
const title: Note = {
  type: "title",
  page: 0,
  x: 10,
  y: 10,
  text: "Hello",
  size: "m",
};

describe("bounds", () => {
  test("of each kind", () => {
    expect(noteBounds(sticky)).toEqual({ x: 100, y: 100, w: 200, h: 160 });
    expect(noteBounds(line)).toEqual({ x: 0, y: 0, w: 100, h: 0 });
    expect(noteBounds(arrow)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(noteBounds(pen)).toEqual({ x: 50, y: 50, w: 30, h: 40 });
    const text = noteBounds(title);
    expect(text.x).toBe(10);
    expect(text.w).toBeGreaterThan(0);
    expect(text.h).toBeGreaterThan(30);
  });

  test("a taller title is taller", () => {
    expect(noteBounds({ ...title, text: "a\nb\nc" }).h).toBeCloseTo(
      noteBounds(title).h * 3,
      9,
    );
  });
});

describe("moving and resizing by rectangle", () => {
  test("a sticky and a box take the rectangle", () => {
    expect(withRect(sticky, { x: 1, y: 2, w: 3, h: 4 })).toMatchObject({
      x: 1,
      y: 2,
      w: 3,
      h: 4,
    });
    expect(withRect(box, { x: 5, y: 6, w: 70, h: 80 })).toMatchObject({
      x: 5,
      y: 6,
      w: 70,
      h: 80,
    });
  });

  test("moving a line translates both ends", () => {
    const moved = withRect(arrow, { x: 10, y: 20, w: 100, h: 100 });
    expect(moved).toMatchObject({ x: 110, y: 120, x2: 10, y2: 20 });
  });

  test("scaling a line keeps the ends where they were inside the bounds", () => {
    const scaled = withRect(arrow, { x: 0, y: 0, w: 200, h: 50 });
    expect(scaled).toMatchObject({ x: 200, y: 50, x2: 0, y2: 0 });
  });

  test("a horizontal line has no height to scale and stays flat", () => {
    expect(withRect(line, { x: 0, y: 30, w: 50, h: 10 })).toMatchObject({
      x: 0,
      y: 30,
      x2: 50,
      y2: 30,
    });
  });

  test("a stroke and a title only move", () => {
    const moved = withRect(pen, { x: 0, y: 0, w: 999, h: 999 });
    expect(moved).toMatchObject({ type: "pen", x: 0, y: 0 });
    expect(noteBounds(moved)).toEqual({ x: 0, y: 0, w: 30, h: 40 });
    expect(withRect(title, { x: 7, y: 8, w: 1, h: 1 })).toMatchObject({
      x: 7,
      y: 8,
      size: "m",
    });
  });
});

describe("hit testing", () => {
  test("a sticky is hit anywhere inside, not outside", () => {
    expect(hitNote(sticky, { x: 200, y: 180 }, 1)).toBe(true);
    expect(hitNote(sticky, { x: 301, y: 180 }, 1)).toBe(false);
  });

  test("a box is hit on its border, not in its empty middle", () => {
    expect(hitNote(box, { x: 150, y: 2 }, 1)).toBe(true);
    expect(hitNote(box, { x: 150, y: 100 }, 1)).toBe(false);
    expect(hitNote(box, { x: 150, y: -5 }, 1)).toBe(true);
  });

  test("a line is hit within 6 screen pixels either side (a 12 px stroke)", () => {
    // At 100 % a point 5 px off the line hits; 9 px does not.
    expect(hitNote(line, { x: 50, y: 5 }, 1)).toBe(true);
    expect(hitNote(line, { x: 50, y: 9 }, 1)).toBe(false);
  });

  test("the reach is in screen pixels, so zooming out widens it in world pixels", () => {
    expect(hitNote(line, { x: 50, y: 20 }, 0.25)).toBe(true);
    expect(hitNote(line, { x: 50, y: 20 }, 2)).toBe(false);
  });

  test("beyond the ends of a line is not a hit", () => {
    expect(hitNote(line, { x: 120, y: 0 }, 1)).toBe(false);
  });

  test("a stroke is hit along its segments", () => {
    expect(hitNote(pen, { x: 65, y: 52 }, 1)).toBe(true);
    expect(hitNote(pen, { x: 80, y: 70 }, 1)).toBe(true);
    expect(hitNote(pen, { x: 55, y: 85 }, 1)).toBe(false);
  });

  test("the topmost hit wins by z", () => {
    const models = [
      { id: "low", note: sticky, z: 1, rect: noteBounds(sticky) },
      {
        id: "high",
        note: { ...sticky, x: 150 },
        z: 5,
        rect: noteBounds(sticky),
      },
    ];
    expect(topNoteAt(models, { x: 200, y: 150 }, 1)?.id).toBe("high");
    expect(topNoteAt(models, { x: 5000, y: 5000 }, 1)).toBeNull();
  });

  test("distance to a degenerate segment is distance to the point", () => {
    expect(
      distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }),
    ).toBe(5);
  });
});

describe("models from the index", () => {
  test("page filter, stable id order, z from order", () => {
    const index = {
      ...EMPTY_BOARD_INDEX,
      notes: { b: box, a: sticky, c: { ...title, page: 3 } },
      order: ["a", "x", "b"],
    };
    const models = noteModels(index);
    expect(models.map((model) => model.id)).toEqual(["a", "b"]);
    expect(models.map((model) => model.z)).toEqual([0, 2]);
    expect(STICKY_SIZE.w).toBe(200);
  });
});
