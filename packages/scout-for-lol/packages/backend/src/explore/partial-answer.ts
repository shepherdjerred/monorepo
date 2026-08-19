import {
  EXPLORE_ANSWER_MAX_LENGTH,
  EXPLORE_INTERRUPTED_CAVEAT,
  EXPLORE_STOPPED_CAVEAT,
  type ExploreMessage,
  type ExploreTraceEntry,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { appendExploreAnswer } from "#src/explore/store.ts";
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
  },
): Promise<ExploreMessage | null> {
  const trimmed = input.text.trim();
  if (trimmed.length === 0 && !input.stopped) return null;
  return await appendExploreAnswer(client, {
    conversationId: input.conversationId,
    parentMessageId: input.parentMessageId,
    answer: {
      answer:
        trimmed.length === 0
          ? "No answer was produced before this question was stopped."
          : clampAnswer(trimmed),
      title: null,
      queryText: null,
      caveats: [
        input.stopped ? EXPLORE_STOPPED_CAVEAT : EXPLORE_INTERRUPTED_CAVEAT,
      ],
      followUps: [],
    },
    preview: null,
    visualization: null,
    trace: finalizeExploreTrace(input.trace),
    expectedCurrentLeafId: input.expectedCurrentLeafId,
  });
}

export function clampAnswer(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= EXPLORE_ANSWER_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, EXPLORE_ANSWER_MAX_LENGTH - 1)}…`;
}
