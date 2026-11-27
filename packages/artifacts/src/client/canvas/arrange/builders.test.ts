import { describe, expect, test } from "vitest";
import { applyBoardOps } from "#domain/board-ops.ts";
import {
  EMPTY_BOARD_INDEX,
  type BoardIndex,
} from "@shepherdjerred/artifacts/contract";
import { opsForNudge, opsForRects, opsForRemove } from "./builders.ts";

const A = "11111111-1111-4111-8111-111111111111";

function board(): BoardIndex {
  return applyBoardOps(
    {
      ...EMPTY_BOARD_INDEX,
      frames: { [A]: { page: 0, x: 0, y: 0, w: 640, h: 420 } },
      order: [A],
    },
    [
      {
        op: "putNote",
        id: "box",
        note: {
          type: "box",
          page: 0,
          x: 700,
          y: 0,
          w: 100,
          h: 80,
          color: "blue",
        },
      },
      {
        op: "putNote",
        id: "arrow",
        note: {
          type: "arrow",
          page: 0,
          x: 0,
          y: 500,
          x2: 100,
          y2: 540,
          color: "red",
        },
      },
    ],
  );
}

describe("ops of the arrangement commands", () => {
  test("a drag moves frames with moveFrames and notes with putNote, in one batch", () => {
    const ops = opsForRects(
      board(),
      new Map([
        [A, { x: 8, y: 8, w: 640, h: 420 }],
        ["box", { x: 720, y: 16, w: 100, h: 80 }],
      ]),
    );
    expect(ops.map((op) => op.op)).toEqual(["moveFrames", "putNote"]);
    const next = applyBoardOps(board(), ops);
    expect(next.frames[A]).toMatchObject({ x: 8, y: 8, w: 640 });
    expect(next.notes["box"]).toMatchObject({ x: 720, y: 16, w: 100, h: 80 });
  });

  test("a resize sends the size only for a frame that changed size", () => {
    const [op] = opsForRects(
      board(),
      new Map([[A, { x: 0, y: 0, w: 800, h: 500 }]]),
    );
    expect(op).toMatchObject({ op: "moveFrames", moves: [{ w: 800, h: 500 }] });
    const [same] = opsForRects(
      board(),
      new Map([[A, { x: 4, y: 4, w: 640, h: 420 }]]),
    );
    expect(JSON.stringify(same)).not.toContain('"w"');
  });

  test("ids the board does not hold are ignored", () => {
    expect(
      opsForRects(board(), new Map([["gone", { x: 0, y: 0, w: 1, h: 1 }]])),
    ).toEqual([]);
  });

  test("a nudge moves frames and notes by the same step", () => {
    const next = applyBoardOps(
      board(),
      opsForNudge(board(), new Set([A, "arrow"]), 3, -2),
    );
    expect(next.frames[A]).toMatchObject({ x: 3, y: -2 });
    expect(next.notes["arrow"]).toMatchObject({
      x: 3,
      y: 498,
      x2: 103,
      y2: 538,
    });
  });

  test("removing takes frames off the board and deletes notes", () => {
    const ops = opsForRemove(board(), [A, "box", "nothing"]);
    expect(ops).toEqual([
      { op: "removeFrame", artifactId: A },
      { op: "deleteNote", id: "box" },
    ]);
    const next = applyBoardOps(board(), ops);
    expect(next.frames).toEqual({});
    expect(Object.keys(next.notes)).toEqual(["arrow"]);
  });
});
