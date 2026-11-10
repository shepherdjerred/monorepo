import { describe, expect, test } from "vitest";
import { createUndoStack } from "./undo.ts";

describe("undo stack", () => {
  test("the newest offer is undone first, and each only once", () => {
    const stack = createUndoStack();
    const ran: string[] = [];
    stack.offer(() => ran.push("first"));
    stack.offer(() => ran.push("second"));
    expect(stack.runNewest()).toBe(true);
    expect(stack.runNewest()).toBe(true);
    expect(stack.runNewest()).toBe(false);
    expect(ran).toEqual(["second", "first"]);
  });

  test("a withdrawn offer can no longer be undone", () => {
    const stack = createUndoStack();
    const ran: string[] = [];
    const first = stack.offer(() => ran.push("first"));
    const second = stack.offer(() => ran.push("second"));
    stack.withdraw(second);
    expect(stack.run(second)).toBe(false);
    expect(stack.runNewest()).toBe(true);
    expect(stack.run(first)).toBe(false);
    expect(ran).toEqual(["first"]);
    expect(stack.size).toBe(0);
  });
});
