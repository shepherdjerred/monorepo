import { describe, expect, test } from "vitest";
import { applyBoardOps } from "#domain/board-ops.ts";
import {
  EMPTY_BOARD_INDEX,
  type BoardIndex,
} from "@shepherdjerred/artifacts/contract";
import { createHistory } from "./history.ts";
import { coalesceOps, entryBetween, entryOps, mergeEntries } from "./ops.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function board(): BoardIndex {
  return {
    ...EMPTY_BOARD_INDEX,
    frames: {
      [A]: { page: 0, x: 0, y: 0, w: 640, h: 420 },
      [B]: { page: 0, x: 700, y: 0, w: 640, h: 420 },
    },
    order: [A, B],
  };
}

function moved(
  index: BoardIndex,
  id: string,
  x: number,
  y: number,
): BoardIndex {
  const frame = index.frames[id];
  if (frame === undefined) throw new Error("no frame");
  return { ...index, frames: { ...index.frames, [id]: { ...frame, x, y } } };
}

describe("history entries", () => {
  test("a move undoes and redoes to the exact frames", () => {
    const before = board();
    const after = moved(before, A, 120, 80);
    const entry = entryBetween({
      label: "Move",
      before,
      after,
      touched: [A],
      at: 0,
    });
    if (entry === null) throw new Error("expected an entry");
    expect(applyBoardOps(after, entryOps(entry, "undo", after))).toEqual(
      before,
    );
    expect(applyBoardOps(before, entryOps(entry, "redo", before))).toEqual(
      after,
    );
  });

  test("no change is no entry", () => {
    expect(
      entryBetween({
        label: "Move",
        before: board(),
        after: board(),
        touched: [A, B],
        at: 0,
      }),
    ).toBeNull();
  });

  test("a resize carries the size", () => {
    const before = board();
    const grown = {
      ...before,
      frames: {
        ...before.frames,
        [A]: { page: 0, x: 0, y: 0, w: 800, h: 525 },
      },
    };
    const entry = entryBetween({
      label: "Resize",
      before: before,
      after: grown,
      touched: [A],
      at: 0,
    });
    if (entry === null) throw new Error("expected an entry");
    expect(
      applyBoardOps(before, entryOps(entry, "redo", before)).frames[A],
    ).toEqual({ page: 0, x: 0, y: 0, w: 800, h: 525 });
  });

  test("a reorder undoes to the old order", () => {
    const before = board();
    const after = { ...before, order: [B, A] };
    const entry = entryBetween({
      label: "Order",
      before,
      after,
      touched: [],
      at: 0,
    });
    if (entry === null) throw new Error("expected an entry");
    expect(applyBoardOps(after, entryOps(entry, "undo", after)).order).toEqual([
      A,
      B,
    ]);
  });

  test("undoing a removal puts the frame back where and in front of what it was", () => {
    const before = board();
    const after = applyBoardOps(before, [{ op: "removeFrame", artifactId: A }]);
    const entry = entryBetween({
      label: "Delete",
      before,
      after,
      touched: [A],
      at: 0,
    });
    if (entry === null) throw new Error("expected an entry");
    // The entry also records the order change of the removal.
    const restored = applyBoardOps(after, entryOps(entry, "undo", after));
    expect(restored.frames[A]).toEqual(before.frames[A]);
    expect(restored.order).toEqual(before.order);
  });

  test("another actor's frame placed meanwhile is left alone by undo", () => {
    const before = board();
    const after = moved(before, A, 50, 50);
    const entry = entryBetween({
      label: "Move",
      before,
      after,
      touched: [A],
      at: 0,
    });
    if (entry === null) throw new Error("expected an entry");
    const withAgent = applyBoardOps(after, [
      { op: "placeFrame", artifactId: C, w: 400, h: 300 },
    ]);
    const undone = applyBoardOps(withAgent, entryOps(entry, "undo", withAgent));
    expect(undone.frames[A]).toEqual(before.frames[A]);
    expect(undone.frames[C]).toEqual(withAgent.frames[C]);
    expect(undone.order).toContain(C);
  });

  test("a run of nudges merges into one entry from the first before to the last after", () => {
    const start = board();
    const one = entryBetween({
      label: "Nudge",
      before: start,
      after: moved(start, A, 1, 0),
      touched: [A],
      key: "nudge",
      at: 0,
    });
    const two = entryBetween({
      label: "Nudge",
      before: moved(start, A, 1, 0),
      after: moved(start, A, 2, 0),
      touched: [A],
      key: "nudge",
      at: 100,
    });
    if (one === null || two === null) throw new Error("expected entries");
    const merged = mergeEntries(one, two);
    expect(merged.frames.get(A)?.before?.x).toBe(0);
    expect(merged.frames.get(A)?.after?.x).toBe(2);
  });
});

function entryAt(label: string, key: string | null, at: number) {
  const before = board();
  const after = moved(before, A, at + 1, 0);
  const made = entryBetween({
    label,
    before,
    after,
    touched: [A],
    at,
    ...(key === null ? {} : { key }),
  });
  if (made === null) throw new Error("expected an entry");
  return made;
}

describe("history stack", () => {
  test("undo and redo walk the stack and a new edit clears redo", () => {
    const history = createHistory();
    history.push(entryAt("one", null, 0));
    history.push(entryAt("two", null, 5000));
    expect(history.undo()?.label).toBe("two");
    expect(history.undo()?.label).toBe("one");
    expect(history.undo()).toBeNull();
    expect(history.redo()?.label).toBe("one");
    history.push(entryAt("three", null, 9000));
    expect(history.canRedo()).toBe(false);
    expect(history.undo()?.label).toBe("three");
  });

  test("same-key edits close together are one step, far apart are two", () => {
    const history = createHistory();
    history.push(entryAt("nudge", "nudge", 0));
    history.push(entryAt("nudge", "nudge", 300));
    history.push(entryAt("nudge", "nudge", 5000));
    expect(history.undo()).not.toBeNull();
    expect(history.undo()).not.toBeNull();
    expect(history.undo()).toBeNull();
  });
});

describe("coalescing ops", () => {
  test("adjacent moves merge by frame, the later wins", () => {
    const ops = coalesceOps([
      { op: "moveFrames", moves: [{ artifactId: A, x: 1, y: 1 }] },
      {
        op: "moveFrames",
        moves: [
          { artifactId: A, x: 2, y: 2 },
          { artifactId: B, x: 3, y: 3 },
        ],
      },
    ]);
    expect(ops).toEqual([
      {
        op: "moveFrames",
        moves: [
          { artifactId: A, x: 2, y: 2 },
          { artifactId: B, x: 3, y: 3 },
        ],
      },
    ]);
  });

  test("ops of different kinds keep their order and are not merged across", () => {
    const ops = coalesceOps([
      { op: "moveFrames", moves: [{ artifactId: A, x: 1, y: 1 }] },
      { op: "removeFrame", artifactId: A },
      { op: "moveFrames", moves: [{ artifactId: A, x: 9, y: 9 }] },
      { op: "reorder", order: [A] },
      { op: "reorder", order: [B, A] },
    ]);
    expect(ops.map((op) => op.op)).toEqual([
      "moveFrames",
      "removeFrame",
      "moveFrames",
      "reorder",
    ]);
    expect(ops.at(-1)).toEqual({ op: "reorder", order: [B, A] });
  });
});
