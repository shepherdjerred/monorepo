import { describe, expect, test } from "bun:test";
import {
  EXPLORE_INTERRUPTED_CAVEAT,
  ExploreMessageSchema,
  type ExploreMessage,
} from "@scout-for-lol/data";
import {
  resolveExploreRunCompletion,
  shouldClearExploreRunMarker,
} from "#src/lib/explore-run-completion.ts";

const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const OLD_ANSWER_ID = "22222222-2222-4222-8222-222222222222";
const NEW_ANSWER_ID = "33333333-3333-4333-8333-333333333333";

function answer(id: string, caveats: string[] = []): ExploreMessage {
  return ExploreMessageSchema.parse({
    id,
    role: "assistant",
    parentId: QUESTION_ID,
    content: "Answer",
    caveats,
    createdAt: "2026-08-20T00:00:00.000Z",
  });
}

describe("resolveExploreRunCompletion", () => {
  test("does not mistake the old answer for a failed regeneration", () => {
    expect(
      resolveExploreRunCompletion({
        run: {
          questionMessageId: QUESTION_ID,
          leafIdAtStart: OLD_ANSWER_ID,
        },
        outcome: "failed",
        finalMessageId: null,
        messages: [answer(OLD_ANSWER_ID)],
      }),
    ).toEqual({ markerState: "failed", answerVisible: false });
  });

  test("recognizes a persisted answer when completion raced reconnection", () => {
    expect(
      resolveExploreRunCompletion({
        run: {
          questionMessageId: QUESTION_ID,
          leafIdAtStart: OLD_ANSWER_ID,
        },
        outcome: "interrupted",
        finalMessageId: null,
        messages: [answer(NEW_ANSWER_ID)],
      }),
    ).toEqual({ markerState: "completed", answerVisible: true });
  });

  test("an interrupted caveat remains a failure even after persistence", () => {
    expect(
      resolveExploreRunCompletion({
        run: { questionMessageId: QUESTION_ID, leafIdAtStart: null },
        outcome: "interrupted",
        finalMessageId: NEW_ANSWER_ID,
        messages: [answer(NEW_ANSWER_ID, [EXPLORE_INTERRUPTED_CAVEAT])],
      }),
    ).toEqual({ markerState: "failed", answerVisible: true });
  });

  test("keeps a completion marker when another branch is visible", () => {
    const completion = resolveExploreRunCompletion({
      run: {
        questionMessageId: QUESTION_ID,
        leafIdAtStart: OLD_ANSWER_ID,
      },
      outcome: "succeeded",
      finalMessageId: NEW_ANSWER_ID,
      messages: [answer(OLD_ANSWER_ID)],
    });

    expect(completion).toEqual({
      markerState: "completed",
      answerVisible: false,
    });
    expect(
      shouldClearExploreRunMarker({
        ...completion,
        displayedConversationId: "conversation-a",
        runConversationId: "conversation-a",
      }),
    ).toBe(false);
  });
});
