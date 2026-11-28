import { describe, expect, test } from "vitest";
import { applyBoardOps } from "#domain/board-ops.ts";
import {
  type BoardIndex,
  type BoardOp,
} from "@shepherdjerred/artifacts/contract";
import { applyDraft } from "#client/canvas/model.ts";
import { A, B, C, board } from "./fixtures.ts";

/** What the canvas draws: the server's index with the outbox applied on top. */
function drawn(base: BoardIndex, outbox: readonly BoardOp[]): BoardIndex {
  return applyBoardOps(base, [...outbox]);
}

const MOVE_A: BoardOp = {
  op: "moveFrames",
  moves: [{ artifactId: A, x: 48, y: 64 }],
};

describe("merging an agent's change with ours", () => {
  test("a frame an agent placed arrives next to an edit that is still queued", () => {
    const agentPlaced = applyBoardOps(board(), [
      { op: "placeFrame", artifactId: C, w: 400, h: 300 },
    ]);
    const index = drawn(agentPlaced, [MOVE_A]);
    expect(index.frames[A]).toMatchObject({ x: 48, y: 64 });
    expect(index.frames[C]).toBeDefined();
    expect(index.order).toEqual([A, B, C]);
  });

  test("replaying ops the server already applied changes nothing", () => {
    const saved = applyBoardOps(board(), [MOVE_A]);
    expect(drawn(saved, [MOVE_A])).toEqual(saved);
    expect(drawn(drawn(saved, [MOVE_A]), [MOVE_A])).toEqual(saved);
  });

  test("our move wins over a stale server position, theirs wins elsewhere", () => {
    // The agent moved B while we moved A; neither is lost.
    const theirs = applyBoardOps(board(), [
      { op: "moveFrames", moves: [{ artifactId: B, x: 900, y: 10 }] },
    ]);
    const index = drawn(theirs, [MOVE_A]);
    expect(index.frames[A]).toMatchObject({ x: 48, y: 64 });
    expect(index.frames[B]).toMatchObject({ x: 900, y: 10 });
  });

  test("a move of a frame that was removed meanwhile is skipped, not refused", () => {
    const removed = applyBoardOps(board(), [
      { op: "removeFrame", artifactId: A },
    ]);
    const index = drawn(removed, [MOVE_A]);
    expect(index.frames[A]).toBeUndefined();
    expect(index.frames[B]).toBeDefined();
  });

  test("a queued reorder keeps frames placed since out of its way", () => {
    const withC = applyBoardOps(board(), [
      { op: "placeFrame", artifactId: C, w: 400, h: 300 },
    ]);
    const index = drawn(withC, [{ op: "reorder", order: [B, A] }]);
    expect(index.order).toEqual([B, A, C]);
  });
});

function model(id: string, x: number) {
  return { id, rect: { x, y: 0, w: 640, h: 420 } };
}

describe("a drag in progress", () => {
  test("is drawn over the document and survives it changing underneath", () => {
    const draft = new Map([[A, { x: 333, y: 222, w: 640, h: 420 }]]);
    const before = applyDraft([model(A, 0), model(B, 700)], draft);
    expect(before[0]?.rect).toMatchObject({ x: 333, y: 222 });
    // An agent publishes: the document grows, the dragged frame stays under the pointer.
    const after = applyDraft(
      [model(A, 0), model(B, 700), model(C, 1400)],
      draft,
    );
    expect(after).toHaveLength(3);
    expect(after[0]?.rect).toMatchObject({ x: 333, y: 222 });
    expect(after[2]?.rect.x).toBe(1400);
  });

  test("no draft leaves the frames alone", () => {
    const frames = [model(A, 0)];
    expect(applyDraft(frames, null)).toBe(frames);
  });
});
