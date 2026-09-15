import type { VoiceQuestionOutcome } from "#src/analytics/product-analytics.ts";
import type { VoiceExploreCompletion } from "#src/voice-assistant/explore-adapter.ts";

export function voiceCompletionObservation(
  completion: VoiceExploreCompletion,
): VoiceQuestionOutcome {
  if (completion.outcome === "succeeded") return "answered";
  if (completion.outcome === "failed") return "error";
  return "interrupted";
}

export function voiceCompletionText(
  completion: VoiceExploreCompletion,
): string {
  if (completion.outcome === "succeeded") return completion.spokenContent;
  if (completion.outcome === "failed") {
    return "I couldn't finish that question. Please try again.";
  }
  if (completion.outcome === "stopped") return "That question was stopped.";
  return "That question was interrupted.";
}
