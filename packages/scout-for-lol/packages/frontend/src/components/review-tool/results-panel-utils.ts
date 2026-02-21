/**
 * Utility functions for the results panel
 */
import type {
  ReviewConfig,
  GenerationResult,
} from "@scout-for-lol/frontend/lib/review-tool/config/schema";
import type {
  CompletedMatch,
  ArenaMatch,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
import type { CostTracker } from "@scout-for-lol/frontend/lib/review-tool/costs";
import { calculateCost } from "@scout-for-lol/frontend/lib/review-tool/costs";
import {
  generateMatchReview,
  type GenerationProgress as GenerationProgressType,
} from "@scout-for-lol/frontend/lib/review-tool/generator";
import {
  saveCompletedEntry,
  type HistoryEntry,
} from "@scout-for-lol/frontend/lib/review-tool/history-manager";
import { ErrorSchema } from "./results-panel-timer.ts";

export function handleCancelPending(id: string) {
  // Pending entries are not persisted, so nothing to cancel
  console.log("[History] Cancel requested for pending entry:", id);
}

/**
 * Build config snapshot from generation result metadata
 */
export function buildConfigSnapshot(
  metadata: GenerationResult["metadata"],
): HistoryEntry["configSnapshot"] {
  const snapshot: HistoryEntry["configSnapshot"] = {};
  if (
    metadata.selectedPersonality !== undefined &&
    metadata.selectedPersonality.length > 0
  ) {
    snapshot.personality = metadata.selectedPersonality;
  }
  if (
    metadata.imageDescription !== undefined &&
    metadata.imageDescription.length > 0
  ) {
    snapshot.imageDescription = metadata.imageDescription;
  }
  return snapshot;
}

/**
 * Track cost from a successful generation
 */
export function trackGenerationCost(
  result: GenerationResult,
  config: ReviewConfig,
  costTracker: CostTracker,
): void {
  if (result.error !== undefined) {
    return;
  }
  const cost = calculateCost(
    result.metadata,
    config.textGeneration.model,
    config.imageGeneration.model,
  );
  void (async () => {
    try {
      await costTracker.add(cost);
    } catch {
      // Error handling is done in the cost tracker
    }
  })();
}

/**
 * Parse an error into a user-friendly message string
 */
export function parseErrorMessage(error: unknown): string {
  return ErrorSchema.safeParse(error).success
    ? ErrorSchema.parse(error).message
    : String(error);
}

/**
 * Execute the review generation workflow
 */
export async function executeGeneration({
  match,
  rawMatch,
  rawTimeline,
  config,
  historyId,
  selectedHistoryId,
  costTracker,
  onResultGenerated,
  onProgressUpdate,
}: {
  match: CompletedMatch | ArenaMatch;
  rawMatch: RawMatch;
  rawTimeline: RawTimeline;
  config: ReviewConfig;
  historyId: string;
  selectedHistoryId: string | undefined;
  costTracker: CostTracker;
  onResultGenerated: (result: GenerationResult) => void;
  onProgressUpdate: (historyId: string, p: GenerationProgressType) => void;
}): Promise<void> {
  try {
    const generatedResult = await generateMatchReview({
      match,
      rawMatch,
      rawTimeline,
      config,
      onProgress: (p) => {
        onProgressUpdate(historyId, p);
      },
    });

    if (selectedHistoryId === historyId) {
      onResultGenerated(generatedResult);
    }

    const configSnapshot = buildConfigSnapshot(generatedResult.metadata);
    await saveCompletedEntry(historyId, generatedResult, configSnapshot);
    trackGenerationCost(generatedResult, config, costTracker);
  } catch (error) {
    const errorResult = {
      text: "",
      metadata: { textDurationMs: 0, imageGenerated: false },
      error: parseErrorMessage(error),
    };

    if (selectedHistoryId === historyId) {
      onResultGenerated(errorResult);
    }

    await saveCompletedEntry(historyId, errorResult, {});
  }
}
