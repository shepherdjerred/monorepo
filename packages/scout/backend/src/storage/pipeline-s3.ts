/**
 * S3 storage for AI pipeline traces
 *
 * Saves all pipeline stage traces to a structured folder under each match:
 * {matchId}/ai-pipeline/
 *   ├── 1a-timeline-summary.json
 *   ├── 1b-match-summary.json
 *   ├── 2-review-text.json
 *   ├── 3-image-description.json
 *   ├── 4-image-generation.json
 *   ├── final-review.txt
 *   └── final-image.png
 */

import type {
  MatchId,
  ReviewPipelineOutput,
  PipelineContext,
  StageTrace,
  ImageGenerationTrace,
} from "@shepherdjerred/scout-data/index";
import { saveToS3 } from "@shepherdjerred/scout-backend/storage/s3-helpers.ts";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";

const logger = createLogger("pipeline-s3");

type SavePipelineTracesParams = {
  matchId: MatchId;
  queueType: string;
  trackedPlayerAliases: string[];
  output: ReviewPipelineOutput;
};

/**
 * Save a single stage trace to S3
 */
async function saveStageTrace(params: {
  matchId: MatchId;
  queueType: string;
  trackedPlayerAliases: string[];
  stageName: string;
  stageNumber: string;
  trace: StageTrace;
}): Promise<void> {
  const { matchId, queueType, trackedPlayerAliases, stageName, stageNumber, trace } = params;

  const body = JSON.stringify(
    {
      stageName,
      generatedAt: new Date().toISOString(),
      ...trace,
    },
    null,
    2,
  );

  await saveToS3({
    matchId,
    assetType: `ai-pipeline/${stageNumber}-${stageName}`,
    extension: "json",
    body,
    contentType: "application/json",
    metadata: {
      matchId,
      type: `pipeline-${stageName}`,
      queueType,
      trackedPlayers: trackedPlayerAliases.join(", "),
      model: trace.model.model,
      durationMs: trace.durationMs.toString(),
    },
    logEmoji: "🔬",
    logMessage: `Saving pipeline trace ${stageNumber}-${stageName}`,
    errorContext: `pipeline trace ${stageName}`,
    returnUrl: false,
    additionalLogDetails: {
      queueType,
      model: trace.model.model,
      durationMs: trace.durationMs,
    },
  });
}

/**
 * Save image generation trace to S3
 */
async function saveImageGenerationTrace(params: {
  matchId: MatchId;
  queueType: string;
  trackedPlayerAliases: string[];
  trace: ImageGenerationTrace;
}): Promise<void> {
  const { matchId, queueType, trackedPlayerAliases, trace } = params;

  const body = JSON.stringify(
    {
      stageName: "image-generation",
      generatedAt: new Date().toISOString(),
      ...trace,
    },
    null,
    2,
  );

  await saveToS3({
    matchId,
    assetType: "ai-pipeline/4-image-generation",
    extension: "json",
    body,
    contentType: "application/json",
    metadata: {
      matchId,
      type: "pipeline-image-generation",
      queueType,
      trackedPlayers: trackedPlayerAliases.join(", "),
      model: trace.model,
      durationMs: trace.durationMs.toString(),
      imageGenerated: trace.response.imageGenerated.toString(),
    },
    logEmoji: "🖼️",
    logMessage: "Saving pipeline image generation trace",
    errorContext: "pipeline image generation trace",
    returnUrl: false,
    additionalLogDetails: {
      queueType,
      model: trace.model,
      durationMs: trace.durationMs,
      imageGenerated: trace.response.imageGenerated,
    },
  });
}

/**
 * Save final review text to S3
 */
async function saveFinalReview(params: {
  matchId: MatchId;
  queueType: string;
  trackedPlayerAliases: string[];
  reviewText: string;
  context: PipelineContext;
}): Promise<void> {
  const { matchId, queueType, trackedPlayerAliases, reviewText, context } = params;

  await saveToS3({
    matchId,
    assetType: "ai-pipeline/final-review",
    extension: "txt",
    body: reviewText,
    contentType: "text/plain",
    metadata: {
      matchId,
      type: "pipeline-final-review",
      queueType,
      trackedPlayers: trackedPlayerAliases.join(", "),
      reviewerName: context.reviewerName,
      playerName: context.playerName,
      playerIndex: context.playerIndex.toString(),
      personalityName: context.personality.name,
    },
    logEmoji: "📝",
    logMessage: "Saving final review text",
    errorContext: "final review text",
    returnUrl: false,
    additionalLogDetails: {
      queueType,
      reviewerName: context.reviewerName,
      playerName: context.playerName,
      reviewLength: reviewText.length,
    },
  });
}

/**
 * Save final review image to S3
 */
async function saveFinalImage(params: {
  matchId: MatchId;
  queueType: string;
  trackedPlayerAliases: string[];
  imageBase64: string;
}): Promise<string | undefined> {
  const { matchId, queueType, trackedPlayerAliases, imageBase64 } = params;

  // Convert base64 to Uint8Array
  const binaryString = atob(imageBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return saveToS3({
    matchId,
    assetType: "ai-pipeline/final-image",
    extension: "png",
    body: bytes,
    contentType: "image/png",
    metadata: {
      matchId,
      type: "pipeline-final-image",
      queueType,
      trackedPlayers: trackedPlayerAliases.join(", "),
      imageSizeBytes: bytes.length.toString(),
    },
    logEmoji: "✨",
    logMessage: "Saving final review image",
    errorContext: "final review image",
    returnUrl: true,
    additionalLogDetails: {
      queueType,
      imageSizeBytes: bytes.length,
    },
  });
}

/**
 * Wrapper to safely run a save operation and log errors
 */
async function safeSave(operation: () => Promise<unknown>, errorMessage: string): Promise<void> {
  try {
    await operation();
  } catch (err) {
    logger.error(errorMessage, err);
  }
}

/**
 * Save all pipeline traces and outputs to S3
 *
 * This saves:
 * - Stage traces (1a, 1b, 2, 3, 4) as JSON
 * - Final review text as TXT
 * - Final image (if generated) as PNG
 */
export async function savePipelineTracesToS3(params: SavePipelineTracesParams): Promise<void> {
  const { matchId, queueType, trackedPlayerAliases, output } = params;
  const { traces, review, context } = output;

  const savePromises: Promise<void>[] = [];

  // Save stage traces
  const timelineSummaryTrace = traces.timelineSummary;
  if (timelineSummaryTrace) {
    savePromises.push(
      safeSave(
        () =>
          saveStageTrace({
            matchId,
            queueType,
            trackedPlayerAliases,
            stageName: "timeline-summary",
            stageNumber: "1a",
            trace: timelineSummaryTrace,
          }),
        "Failed to save timeline summary trace",
      ),
    );
  }

  const matchSummaryTrace = traces.matchSummary;
  if (matchSummaryTrace) {
    savePromises.push(
      safeSave(
        () =>
          saveStageTrace({
            matchId,
            queueType,
            trackedPlayerAliases,
            stageName: "match-summary",
            stageNumber: "1b",
            trace: matchSummaryTrace,
          }),
        "Failed to save match summary trace",
      ),
    );
  }

  // Review text trace is always present
  savePromises.push(
    safeSave(
      () =>
        saveStageTrace({
          matchId,
          queueType,
          trackedPlayerAliases,
          stageName: "review-text",
          stageNumber: "2",
          trace: traces.reviewText,
        }),
      "Failed to save review text trace",
    ),
  );

  const imageDescriptionTrace = traces.imageDescription;
  if (imageDescriptionTrace) {
    savePromises.push(
      safeSave(
        () =>
          saveStageTrace({
            matchId,
            queueType,
            trackedPlayerAliases,
            stageName: "image-description",
            stageNumber: "3",
            trace: imageDescriptionTrace,
          }),
        "Failed to save image description trace",
      ),
    );
  }

  const imageGenerationTrace = traces.imageGeneration;
  if (imageGenerationTrace) {
    savePromises.push(
      safeSave(
        () =>
          saveImageGenerationTrace({
            matchId,
            queueType,
            trackedPlayerAliases,
            trace: imageGenerationTrace,
          }),
        "Failed to save image generation trace",
      ),
    );
  }

  // Save final outputs
  savePromises.push(
    safeSave(
      () =>
        saveFinalReview({
          matchId,
          queueType,
          trackedPlayerAliases,
          reviewText: review.text,
          context,
        }),
      "Failed to save final review",
    ),
  );

  const imageBase64 = review.imageBase64;
  if (imageBase64) {
    savePromises.push(
      safeSave(
        () =>
          saveFinalImage({
            matchId,
            queueType,
            trackedPlayerAliases,
            imageBase64,
          }),
        "Failed to save final image",
      ),
    );
  }

  // Wait for all saves to complete
  await Promise.all(savePromises);
}

/**
 * Save comprehensive pipeline debug data as a single JSON file
 *
 * This is similar to the old saveComprehensiveDebugToS3 but structured
 * around the new pipeline output format.
 */
export async function savePipelineDebugToS3(params: {
  matchId: MatchId;
  queueType: string;
  trackedPlayerAliases: string[];
  output: ReviewPipelineOutput;
}): Promise<string | undefined> {
  const { matchId, queueType, trackedPlayerAliases, output } = params;

  const debugData = {
    matchId,
    generatedAt: new Date().toISOString(),
    queueType,
    trackedPlayerAliases,
    context: output.context,
    stages: {
      timelineSummary: output.traces.timelineSummary
        ? {
            model: output.traces.timelineSummary.model,
            durationMs: output.traces.timelineSummary.durationMs,
            tokensPrompt: output.traces.timelineSummary.tokensPrompt,
            tokensCompletion: output.traces.timelineSummary.tokensCompletion,
            responseLength: output.intermediate.timelineSummaryText?.length,
          }
        : null,
      matchSummary: output.traces.matchSummary
        ? {
            model: output.traces.matchSummary.model,
            durationMs: output.traces.matchSummary.durationMs,
            tokensPrompt: output.traces.matchSummary.tokensPrompt,
            tokensCompletion: output.traces.matchSummary.tokensCompletion,
            responseLength: output.intermediate.matchSummaryText?.length,
          }
        : null,
      reviewText: {
        model: output.traces.reviewText.model,
        durationMs: output.traces.reviewText.durationMs,
        tokensPrompt: output.traces.reviewText.tokensPrompt,
        tokensCompletion: output.traces.reviewText.tokensCompletion,
        responseLength: output.review.text.length,
      },
      imageDescription: output.traces.imageDescription
        ? {
            model: output.traces.imageDescription.model,
            durationMs: output.traces.imageDescription.durationMs,
            tokensPrompt: output.traces.imageDescription.tokensPrompt,
            tokensCompletion: output.traces.imageDescription.tokensCompletion,
            responseLength: output.intermediate.imageDescriptionText?.length,
          }
        : null,
      imageGeneration: output.traces.imageGeneration
        ? {
            model: output.traces.imageGeneration.model,
            durationMs: output.traces.imageGeneration.durationMs,
            imageGenerated: output.traces.imageGeneration.response.imageGenerated,
            imageSizeBytes: output.traces.imageGeneration.response.imageSizeBytes,
          }
        : null,
    },
  };

  const body = JSON.stringify(debugData, null, 2);

  return saveToS3({
    matchId,
    assetType: "ai-pipeline/debug",
    extension: "json",
    body,
    contentType: "application/json",
    metadata: {
      matchId,
      type: "pipeline-debug",
      queueType,
      trackedPlayers: trackedPlayerAliases.join(", "),
      reviewerName: output.context.reviewerName,
      playerName: output.context.playerName,
    },
    logEmoji: "🔍",
    logMessage: "Saving pipeline debug data",
    errorContext: "pipeline debug data",
    returnUrl: true,
    additionalLogDetails: {
      queueType,
      reviewerName: output.context.reviewerName,
      playerName: output.context.playerName,
    },
  });
}
