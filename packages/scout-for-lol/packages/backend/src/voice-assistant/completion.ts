import type { VoiceQuestionOutcome } from "#src/analytics/product-analytics.ts";
import type { VoiceExploreCompletion } from "#src/voice-assistant/explore-adapter.ts";

export function voiceCompletionObservation(
  completion: VoiceExploreCompletion,
): VoiceQuestionOutcome {
  if (completion.outcome === "succeeded") return "answered";
  return completion.outcome === "failed" ? "error" : "interrupted";
}

export function voiceCompletionText(
  completion: VoiceExploreCompletion,
): string {
  if (completion.outcome === "succeeded") return completion.spokenContent;
  if (completion.outcome === "failed") {
    return "I couldn't finish that question. Please try again.";
  }
  return completion.outcome === "stopped"
    ? "That question was stopped."
    : "That question was interrupted.";
}
