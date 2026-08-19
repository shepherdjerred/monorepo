import { describe, expect, test } from "bun:test";
import {
  moveExploreClientRun,
  removeExploreClientRun,
  setExploreClientRun,
  type ExploreClientRun,
} from "#src/lib/explore-client-runs.ts";
import { createPendingTurn } from "#src/lib/explore-turn-state.ts";

function run(conversationId: string): ExploreClientRun {
  return {
    summary: null,
    turn: createPendingTurn({
      conversationId,
      question: `Question for ${conversationId}`,
      leafIdAtStart: null,
    }),
  };
}

describe("Explore provider run map", () => {
  test("keeps independent pending state for simultaneous conversations", () => {
    const first = run("conversation-a");
    const second = run("conversation-b");
    let state = setExploreClientRun(new Map(), "conversation-a", first);
    state = setExploreClientRun(state, "conversation-b", second);

    expect(state.get("conversation-a")).toBe(first);
    expect(state.get("conversation-b")).toBe(second);
    expect(state).toHaveLength(2);
  });

  test("placing a new conversation preserves every other active run", () => {
    const existing = run("conversation-a");
    const placed = run("conversation-b");
    let state = setExploreClientRun(new Map(), "conversation-a", existing);
    state = setExploreClientRun(state, "new", placed);
    state = moveExploreClientRun(state, "new", "conversation-b", placed);

    expect(state.get("conversation-a")).toBe(existing);
    expect(state.get("conversation-b")).toBe(placed);
    expect(
      removeExploreClientRun(state, "conversation-b").has("conversation-a"),
    ).toBe(true);
  });
});
