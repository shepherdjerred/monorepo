/**
 * The ops of the arrangement commands, built from the board as it is now.
 * Frames move with `moveFrames` (and resize with its `w` and `h`); an
 * annotation is replaced whole with `putNote`.
 */
import type { BoardIndex, BoardOp } from "@shepherdjerred/artifacts/contract";
import type { WorldRect } from "#client/canvas/camera.ts";
import { noteBounds, withRect } from "#client/canvas/notes/shapes.ts";

/** A finished drag or resize: every frame and note in `rects` goes to its rectangle. */
export function opsForRects(
  index: BoardIndex,
  rects: ReadonlyMap<string, WorldRect>,
): BoardOp[] {
  const moves = [...rects].flatMap(([id, rect]) => {
    const frame = index.frames[id];
    if (frame === undefined) return [];
    const resized = frame.w !== rect.w || frame.h !== rect.h;
    return [
      {
        artifactId: id,
        x: rect.x,
        y: rect.y,
        ...(resized ? { w: rect.w, h: rect.h } : {}),
      },
    ];
  });
  const puts = [...rects].flatMap(([id, rect]): BoardOp[] => {
    const note = index.notes[id];
    return note === undefined
      ? []
      : [{ op: "putNote", id, note: withRect(note, rect) }];
  });
  return [
    ...(moves.length === 0 ? [] : [{ op: "moveFrames" as const, moves }]),
    ...puts,
  ];
}

/** The selection moved by `(dx, dy)` world pixels. */
export function opsForNudge(
  index: BoardIndex,
  selection: ReadonlySet<string>,
  dx: number,
  dy: number,
): BoardOp[] {
  const rects = new Map<string, WorldRect>();
  for (const id of selection) {
    const frame = index.frames[id];
    const note = index.notes[id];
    if (frame !== undefined)
      rects.set(id, {
        x: frame.x + dx,
        y: frame.y + dy,
        w: frame.w,
        h: frame.h,
      });
    else if (note !== undefined) {
      const bounds = noteBounds(note);
      rects.set(id, { ...bounds, x: bounds.x + dx, y: bounds.y + dy });
    }
  }
  return opsForRects(index, rects);
}

/** Removing the selection from the board: frames leave it, annotations are deleted. */
export function opsForRemove(
  index: BoardIndex,
  ids: Iterable<string>,
): BoardOp[] {
  const ops: BoardOp[] = [];
  for (const id of ids) {
    if (id in index.frames) ops.push({ op: "removeFrame", artifactId: id });
    else if (id in index.notes) ops.push({ op: "deleteNote", id });
  }
  return ops;
}
