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

export function exploreRunMarkerState(input: {
  run: Pick<ExploreActiveRun, "questionMessageId" | "leafIdAtStart">;
  outcome: ExploreRunOutcome;
  finalMessageId: string | null;
  messages: ExploreMessage[] | undefined;
}): "completed" | "failed" | null {
  const answer =
    input.finalMessageId === null
      ? input.messages?.find(
          (message) =>
            message.role === "assistant" &&
            message.parentId === input.run.questionMessageId &&
            message.id !== input.run.leafIdAtStart,
        )
      : input.messages?.find((message) => message.id === input.finalMessageId);
  if (answer?.caveats.includes(EXPLORE_INTERRUPTED_CAVEAT) === true) {
    return "failed";
  }
  if (
    input.outcome === "stopped" ||
    answer?.caveats.includes(EXPLORE_STOPPED_CAVEAT) === true
  ) {
    return null;
  }
  return answer !== undefined || input.outcome === "succeeded"
    ? "completed"
    : "failed";
}
