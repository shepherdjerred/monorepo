import {
  EXPLORE_INTERRUPTED_CAVEAT,
  EXPLORE_STOPPED_CAVEAT,
  type ExploreActiveRun,
  type ExploreMessage,
} from "@scout-for-lol/data";

export type ExploreRunOutcome =
  | "succeeded"
  | "failed"
  | "stopped"
  | "interrupted";

export function findVisibleExploreRunAnswer(input: {
  run: Pick<ExploreActiveRun, "questionMessageId" | "versionCountAtStart">;
  finalMessageId: string | null;
  messages: ExploreMessage[] | undefined;
}): ExploreMessage | undefined {
  return input.finalMessageId === null
    ? input.messages?.find(
        (message) =>
          message.role === "assistant" &&
          message.parentId === input.run.questionMessageId &&
          message.siblingIds.length > input.run.versionCountAtStart &&
          message.siblingIds.at(-1) === message.id,
      )
    : input.messages?.find((message) => message.id === input.finalMessageId);
}

export function resolveExploreRunCompletion(input: {
  run: Pick<ExploreActiveRun, "questionMessageId" | "versionCountAtStart">;
  outcome: ExploreRunOutcome;
  finalMessageId: string | null;
  messages: ExploreMessage[] | undefined;
}): {
  markerState: "completed" | "failed" | null;
  answerVisible: boolean;
} {
  const answer = findVisibleExploreRunAnswer(input);
  if (answer?.caveats.includes(EXPLORE_INTERRUPTED_CAVEAT) === true) {
    return { markerState: "failed", answerVisible: true };
  }
  if (
    input.outcome === "stopped" ||
    answer?.caveats.includes(EXPLORE_STOPPED_CAVEAT) === true
  ) {
    return { markerState: null, answerVisible: answer !== undefined };
  }
  return {
    markerState:
      answer !== undefined || input.outcome === "succeeded"
        ? "completed"
        : "failed",
    answerVisible: answer !== undefined,
  };
}

export function shouldClearExploreRunMarker(input: {
  markerState: "completed" | "failed" | null;
  answerVisible: boolean;
  displayedConversationId: string | null;
  runConversationId: string;
}): boolean {
  return (
    input.markerState === null ||
    (input.displayedConversationId === input.runConversationId &&
      (input.markerState === "failed" || input.answerVisible))
  );
}
