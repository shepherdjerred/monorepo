import { describe, expect, test } from "bun:test";

import {
  activeUndoEntry,
  undoStackReducer,
  type UndoStackEntry,
} from "./undo-stack";

function entry(id: number): UndoStackEntry {
  return {
    id,
    message: `Undo ${String(id)}`,
    onUndo: async () => id > 0,
  };
}

describe("undoStackReducer", () => {
  test("changes the active identity on push and pop to reset the LIFO timer", () => {
    const first = undoStackReducer([], { type: "push", entry: entry(1) });
    const second = undoStackReducer(first, { type: "push", entry: entry(2) });

    expect(activeUndoEntry(second)?.id).toBe(2);
    const popped = undoStackReducer(second, { type: "remove", id: 2 });
    expect(activeUndoEntry(popped)?.id).toBe(1);
  });

  test("removes a stable request without dropping newer entries", () => {
    const stack = [entry(1), entry(2), entry(3)];

    expect(
      undoStackReducer(stack, { type: "remove", id: 2 }).map(({ id }) => id),
    ).toEqual([1, 3]);
  });

  test("clears every completion when the inactivity timer expires", () => {
    expect(undoStackReducer([entry(1), entry(2)], { type: "clear" })).toEqual(
      [],
    );
  });
});
