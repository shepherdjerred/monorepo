import { describe, expect, test } from "vitest";
import {
  clearExploreClientError,
  dropNewConversationAlias,
  moveExploreClientRun,
  NEW_CONVERSATION_KEY,
  placeStartedExploreRun,
  removeExploreClientRun,
  setExploreClientRun,
  shouldReconcileMissingExploreRun,
  type ExploreClientRun,
} from "#src/lib/explore/explore-client-runs.ts";
import { createPendingTurn } from "#src/lib/explore/explore-turn-state.ts";

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

  test("keeps the blank-explore alias until that conversation is on screen", () => {
    const placed = run("conversation-b");
    const state = placeStartedExploreRun({
      current: new Map(),
      fromKey: NEW_CONVERSATION_KEY,
      conversationId: "conversation-b",
      run: placed,
      displayedConversationId: null,
    });

    expect(state.get(NEW_CONVERSATION_KEY)).toBe(placed);
    expect(state.get("conversation-b")).toBe(placed);

    const dropped = dropNewConversationAlias({
      current: state,
      displayedConversationId: "conversation-b",
      isExploreRoute: true,
    });
    expect(dropped.has(NEW_CONVERSATION_KEY)).toBe(false);
    expect(dropped.get("conversation-b")).toBe(placed);

    expect(
      dropNewConversationAlias({
        current: state,
        displayedConversationId: "conversation-other",
        isExploreRoute: true,
      }).has(NEW_CONVERSATION_KEY),
    ).toBe(true);
  });

  test("drops the new alias after leaving Explore", () => {
    const placed = run("conversation-b");
    const state = placeStartedExploreRun({
      current: new Map(),
      fromKey: NEW_CONVERSATION_KEY,
      conversationId: "conversation-b",
      run: placed,
      displayedConversationId: null,
    });

    const dropped = dropNewConversationAlias({
      current: state,
      displayedConversationId: null,
      isExploreRoute: false,
    });

    expect(dropped.has(NEW_CONVERSATION_KEY)).toBe(false);
    expect(dropped.get("conversation-b")).toBe(placed);
  });

  test("drops the blank-explore alias when start returns on that conversation", () => {
    const placed = run("conversation-b");
    const state = placeStartedExploreRun({
      current: new Map(),
      fromKey: NEW_CONVERSATION_KEY,
      conversationId: "conversation-b",
      run: placed,
      displayedConversationId: "conversation-b",
    });

    expect(state.has(NEW_CONVERSATION_KEY)).toBe(false);
    expect(state.get("conversation-b")).toBe(placed);
  });

  test("discovering a run clears only that conversation's stale error", () => {
    const errors = new Map([
      ["conversation-a", "Old failure"],
      ["conversation-b", "Different failure"],
    ]);

    const cleared = clearExploreClientError(errors, "conversation-a");

    expect(cleared.has("conversation-a")).toBe(false);
    expect(cleared.get("conversation-b")).toBe("Different failure");
    expect(errors.get("conversation-a")).toBe("Old failure");
  });

  test("a stale discovery response cannot retire a locally observed run", () => {
    expect(
      shouldReconcileMissingExploreRun({
        runId: "new-run",
        discoveredRunIds: new Set(),
        observedRunIds: new Set(["new-run"]),
      }),
    ).toBe(false);
    expect(
      shouldReconcileMissingExploreRun({
        runId: "lost-run",
        discoveredRunIds: new Set(),
        observedRunIds: new Set(),
      }),
    ).toBe(true);
  });
});
