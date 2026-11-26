import { describe, expect, test } from "vitest";
import type { LiveMessage } from "@shepherdjerred/artifacts/contract";
import { stalenessOf, widen } from "./live-scope.ts";

const BOARD = "7b0b7d52-37f6-4f0a-9a5f-0d3a52f2c3a1";

function change(kind: string, seq: number | null): LiveMessage {
  return { type: "change", boardId: BOARD, kind, entityId: "e1", seq };
}

describe("live message staleness", () => {
  test("a waiter change refetches only the waiting header", () => {
    expect(stalenessOf(change("waiter", null))).toBe("waiters");
  });

  test("every other message refetches everything", () => {
    expect(stalenessOf(change("thread.created", 7))).toBe("all");
    expect(stalenessOf({ type: "resync" })).toBe("all");
    expect(stalenessOf({ type: "board", boardId: BOARD, revision: 2 })).toBe(
      "all",
    );
  });

  test("a burst containing anything else widens to everything", () => {
    expect(widen(null, "waiters")).toBe("waiters");
    expect(widen("waiters", "waiters")).toBe("waiters");
    expect(widen("waiters", "all")).toBe("all");
    expect(widen("all", "waiters")).toBe("all");
  });
});
