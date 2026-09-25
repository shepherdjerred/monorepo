import {
  EXPLORE_ANSWER_MAX_LENGTH,
  EXPLORE_INTERRUPTED_CAVEAT,
  EXPLORE_STOPPED_CAVEAT,
  type ExploreMessage,
  type ExploreTraceEntry,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { appendExploreAnswer } from "#src/explore/store.ts";
import {
  discardExploreAnswer,
  replaceExploreAnswer,
} from "#src/explore/replace-answer.ts";
import { finalizeExploreTrace } from "#src/explore/trace.ts";

/** Save the useful prefix of an interrupted run, if it produced one. */
export async function persistPartialAnswer(
  client: ExtendedPrismaClient,
  input: {
    stopped: boolean;
    conversationId: string;
    parentMessageId: string;
    expectedCurrentLeafId: string | null;
    text: string;
    trace: ExploreTraceEntry[];
    /** Same per-turn guild context the full answer records. */
    guildIds: readonly string[];
    existingMessageId: string | null;
  },
): Promise<ExploreMessage | null> {
  const trimmed = input.text.trim();
  if (trimmed.length === 0) {
    if (input.existingMessageId !== null) {
      await discardExploreAnswer(client, {
        conversationId: input.conversationId,
        messageId: input.existingMessageId,
        expectedCurrentLeafId: input.expectedCurrentLeafId,
      });
    }
    return null;
  }
  const answer = {
    answer: clampAnswer(trimmed),
    spokenAnswer: null,
    title: null,
    queryText: null,
    includeVisualization: false,
    matchCards: [],
    caveats: [
      input.stopped ? EXPLORE_STOPPED_CAVEAT : EXPLORE_INTERRUPTED_CAVEAT,
    ],
    followUps: [],
  };
  if (input.existingMessageId !== null) {
    return await replaceExploreAnswer(client, {
      conversationId: input.conversationId,
      messageId: input.existingMessageId,
      answer,
      trace: finalizeExploreTrace(input.trace),
    });
  }
  return await appendExploreAnswer(client, {
    guildIds: input.guildIds,
    conversationId: input.conversationId,
    parentMessageId: input.parentMessageId,
    answer,
    preview: null,
    visualization: null,
    trace: finalizeExploreTrace(input.trace),
    expectedCurrentLeafId: input.expectedCurrentLeafId,
  });
}

export function clampAnswer(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= EXPLORE_ANSWER_MAX_LENGTH
    ? trimmed
    : `${trimmed.slice(0, EXPLORE_ANSWER_MAX_LENGTH - 1)}…`;
}
