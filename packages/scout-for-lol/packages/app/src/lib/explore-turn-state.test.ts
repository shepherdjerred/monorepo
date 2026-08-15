import { describe, expect, test } from "bun:test";
import { ExploreMessageSchema, type ExploreMessage } from "@scout-for-lol/data";
import {
  applyStreamEvent,
  createPendingTurn,
  markStopping,
  salvageRefreshDelays,
  turnHasLanded,
  visiblePending,
} from "#src/lib/explore-turn-state.ts";

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const OTHER_CONVERSATION = "22222222-2222-4222-8222-222222222222";
const QUESTION_ID = "33333333-3333-4333-8333-333333333333";
const ANSWER_ID = "44444444-4444-4444-8444-444444444444";
const OLD_ANSWER_ID = "55555555-5555-4555-8555-555555555555";
const RUN_ID = "66666666-6666-4666-8666-666666666666";

function message(input: {
  id: string;
  role: "user" | "assistant";
  parentId?: string | null;
}): ExploreMessage {
  return ExploreMessageSchema.parse({
    id: input.id,
    role: input.role,
    parentId: input.parentId ?? null,
    content: input.role === "user" ? "Who wins?" : "Jinx.",
    createdAt: "2026-08-14T12:00:00.000Z",
  });
}

function startedTurn(question: string | null = "Who wins?") {
  return applyStreamEvent(
    createPendingTurn({
      conversationId: CONVERSATION,
      question,
      leafIdAtStart: null,
    }),
    {
      type: "started",
      runId: RUN_ID,
      conversationId: CONVERSATION,
      questionMessageId: QUESTION_ID,
    },
  );
}

describe("applyStreamEvent", () => {
  test("started fills the conversation and question ids", () => {
    const turn = createPendingTurn({
      conversationId: null,
      question: "Who wins?",
      leafIdAtStart: null,
    });
    const after = applyStreamEvent(turn, {
      type: "started",
      runId: RUN_ID,
      conversationId: CONVERSATION,
      questionMessageId: QUESTION_ID,
    });
    expect(after.conversationId).toBe(CONVERSATION);
    expect(after.questionMessageId).toBe(QUESTION_ID);
  });

  test("answer deltas accumulate in order", () => {
    let turn = startedTurn();
    turn = applyStreamEvent(turn, { type: "answer_delta", text: "Jinx " });
    turn = applyStreamEvent(turn, { type: "answer_delta", text: "wins." });
    expect(turn.answer).toBe("Jinx wins.");
  });

  test("final pins the persisted message and replaces the streamed text", () => {
    let turn = startedTurn();
    turn = applyStreamEvent(turn, { type: "answer_delta", text: "Jin" });
    turn = applyStreamEvent(turn, {
      type: "final",
      message: message({
        id: ANSWER_ID,
        role: "assistant",
        parentId: QUESTION_ID,
      }),
      title: "Who wins?",
      quota: [],
    });
    expect(turn.finalMessageId).toBe(ANSWER_ID);
    expect(turn.answer).toBe("Jinx.");
    expect(turn.activity).toBeNull();
  });
});

describe("visiblePending", () => {
  test("hides everything for another conversation", () => {
    const turn = startedTurn();
    expect(visiblePending(turn, OTHER_CONVERSATION, [])).toEqual({
      pendingQuestion: null,
      pendingAnswer: null,
      activity: null,
    });
  });

  test("matches a not-yet-created conversation to the new view", () => {
    const turn = createPendingTurn({
      conversationId: null,
      question: "Who wins?",
      leafIdAtStart: null,
    });
    expect(visiblePending(turn, null, []).pendingQuestion).toBe("Who wins?");
  });

  test("drops the question once the transcript contains it", () => {
    const turn = startedTurn();
    const persisted = [message({ id: QUESTION_ID, role: "user" })];
    const visible = visiblePending(turn, CONVERSATION, persisted);
    expect(visible.pendingQuestion).toBeNull();
    // The streamed answer still renders — only the question deduplicates.
    expect(visible.activity).not.toBeNull();
  });

  test("drops the answer once the turn has landed", () => {
    let turn = startedTurn();
    turn = applyStreamEvent(turn, { type: "answer_delta", text: "Jinx." });
    turn = applyStreamEvent(turn, {
      type: "final",
      message: message({
        id: ANSWER_ID,
        role: "assistant",
        parentId: QUESTION_ID,
      }),
      title: "Who wins?",
      quota: [],
    });
    const persisted = [
      message({ id: QUESTION_ID, role: "user" }),
      message({ id: ANSWER_ID, role: "assistant", parentId: QUESTION_ID }),
    ];
    expect(visiblePending(turn, CONVERSATION, persisted)).toEqual({
      pendingQuestion: null,
      pendingAnswer: null,
      activity: null,
    });
  });
});

describe("turnHasLanded", () => {
  test("sees a salvage row under the question", () => {
    // A stop never gets `final`, so landing is recognised structurally.
    const turn = markStopping(
      applyStreamEvent(startedTurn(), { type: "answer_delta", text: "Jin" }),
    );
    const persisted = [
      message({ id: QUESTION_ID, role: "user" }),
      message({ id: ANSWER_ID, role: "assistant", parentId: QUESTION_ID }),
    ];
    expect(turnHasLanded(turn, persisted)).toBe(true);
  });

  test("ignores the pre-existing answer during a regenerate", () => {
    // Regenerating starts with the old answer already on the path; that row
    // must not read as the new turn having landed.
    const started = applyStreamEvent(
      createPendingTurn({
        conversationId: CONVERSATION,
        question: null,
        leafIdAtStart: OLD_ANSWER_ID,
      }),
      {
        type: "started",
        runId: RUN_ID,
        conversationId: CONVERSATION,
        questionMessageId: QUESTION_ID,
      },
    );
    const persisted = [
      message({ id: QUESTION_ID, role: "user" }),
      message({ id: OLD_ANSWER_ID, role: "assistant", parentId: QUESTION_ID }),
    ];
    expect(turnHasLanded(started, persisted)).toBe(false);
  });

  test("is false while only the question is persisted", () => {
    const turn = startedTurn();
    expect(
      turnHasLanded(turn, [message({ id: QUESTION_ID, role: "user" })]),
    ).toBe(false);
  });
});

describe("salvageRefreshDelays", () => {
  test("still reads once when the stop beat the started event", () => {
    // The regression. The server persists the question before it opens the
    // stream, so a stop this early leaves that row on disk while the only copy
    // on screen is the pending turn's, which is cleared as the turn ends.
    // Skipping the read drops the question the user just asked.
    const turn = createPendingTurn({
      conversationId: CONVERSATION,
      question: "Who wins?",
      leafIdAtStart: null,
    });

    expect(turn.questionMessageId).toBeNull();
    expect(salvageRefreshDelays(turn)).toEqual({
      conversationId: CONVERSATION,
      delays: [0],
    });
  });

  test("polls a bounded few times once the turn has a question id", () => {
    // Only then can a partial answer be mid-write, and only then can
    // `turnHasLanded` judge whether it arrived.
    const turn = applyStreamEvent(
      createPendingTurn({
        conversationId: CONVERSATION,
        question: "Who wins?",
        leafIdAtStart: null,
      }),
      {
        type: "started",
        runId: RUN_ID,
        conversationId: CONVERSATION,
        questionMessageId: QUESTION_ID,
      },
    );

    expect(salvageRefreshDelays(turn)).toEqual({
      conversationId: CONVERSATION,
      delays: [0, 600, 1500],
    });
  });

  test("reads nothing when the conversation was never created", () => {
    // A brand-new conversation stopped before `started`: there is no id to
    // query, so there is nothing to read rather than something being skipped.
    const turn = createPendingTurn({
      conversationId: null,
      question: "Who wins?",
      leafIdAtStart: null,
    });

    expect(salvageRefreshDelays(turn)).toBeNull();
  });
});
