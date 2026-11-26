import { describe, expect, test } from "vitest";
import { drawNote, newNoteId, snapAngle } from "./create.ts";

const colour = { color: "blue", constrain: false };

describe("drawing", () => {
  test("a sticky click gets the default size, a drag its rectangle", () => {
    expect(
      drawNote("sticky", { x: 10, y: 20 }, { x: 10, y: 20 }, colour),
    ).toMatchObject({ type: "sticky", x: 10, y: 20, w: 200, h: 160 });
    expect(
      drawNote("sticky", { x: 300, y: 200 }, { x: 100, y: 100 }, colour),
    ).toMatchObject({ x: 100, y: 100, w: 200, h: 100 });
  });

  test("a click makes a title at the point", () => {
    expect(
      drawNote("text", { x: 5, y: 6 }, { x: 5, y: 6 }, colour),
    ).toMatchObject({ type: "title", x: 5, y: 6, text: "" });
  });

  test("a box, line or arrow too small to see is not made", () => {
    for (const tool of ["box", "line", "arrow"] as const)
      expect(drawNote(tool, { x: 0, y: 0 }, { x: 2, y: 2 }, colour)).toBeNull();
  });

  test("a box takes the rectangle whichever way it was dragged", () => {
    expect(
      drawNote("box", { x: 90, y: 80 }, { x: 10, y: 20 }, colour),
    ).toMatchObject({ type: "box", x: 10, y: 20, w: 80, h: 60 });
  });

  test("an arrow keeps its direction and Shift snaps it to 45 degrees", () => {
    const free = drawNote("arrow", { x: 0, y: 0 }, { x: 100, y: 10 }, colour);
    expect(free).toMatchObject({ type: "arrow", x2: 100, y2: 10 });
    const snapped = drawNote(
      "arrow",
      { x: 0, y: 0 },
      { x: 100, y: 10 },
      { color: "red", constrain: true },
    );
    expect(snapped).toMatchObject({ type: "arrow" });
    if (snapped?.type !== "arrow") throw new Error("expected an arrow");
    expect(snapped.y2).toBeCloseTo(0, 9);
    expect(snapped.x2).toBeCloseTo(Math.hypot(100, 10), 9);
  });

  test("snapAngle goes to the nearest 45 degrees", () => {
    const diagonal = snapAngle({ x: 0, y: 0 }, { x: 50, y: 40 });
    expect(diagonal.x).toBeCloseTo(diagonal.y, 9);
  });

  test("note ids are valid for the contract and unique", () => {
    const ids = new Set(Array.from({ length: 50 }, newNoteId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[\w-]{1,64}$/u);
  });
});
