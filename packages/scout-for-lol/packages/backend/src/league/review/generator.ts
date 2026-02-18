/**
 * Backend wrapper for AI match review generation
 *
 * This is a thin wrapper around the unified pipeline from @scout-for-lol/data.
 * It handles backend-specific concerns:
 * - Loading prompts/personality from filesystem
 * - Initializing AI clients from environment
 * - Saving traces to S3
 * - Error handling with Sentry
 */

import {
  type RawMatch,
  type RawTimeline,
  type ArenaMatch,
  type CompletedMatch,
  type MatchId,
  generateFullMatchReview,
  getDefaultStageConfigs,
  type ReviewPipelineOutput,
} from "@scout-for-lol/data/index";
import * as Sentry from "@sentry/bun";
import { selectRandomPersonality, getLaneContext } from "./prompts.ts";
import { getOpenAIClient, getGeminiClient } from "./ai-clients.ts";
import {
  savePipelineTracesToS3,
  savePipelineDebugToS3,
} from "@scout-for-lol/backend/storage/pipeline-s3.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("generator");

/**
 * Metadata about the generated review
 */
export type ReviewMetadata = {
  reviewerName: string;
  playerName: string;
};

/**
 * Select the player to review
 *
 * Prefers "Jerred" if they're in the match, otherwise selects randomly.
 */
function selectPlayerIndex(match: CompletedMatch | ArenaMatch): number {
  const jerredIndex = match.players.findIndex(
    (p) => p.playerConfig.alias.toLowerCase() === "jerred",
  );
  return jerredIndex === -1
    ? Math.floor(Math.random() * match.players.length)
    : jerredIndex;
}

/**
 * Generates a post-game review for a player's performance with optional AI-generated image.
 *
 * This function:
 * 1. Loads prompts and personality from filesystem
 * 2. Initializes AI clients from environment
 * 3. Calls the unified pipeline
 * 4. Saves traces to S3
 * 5. Returns the review text and optional image
 *
 * @param match - The completed match data (regular or arena)
 * @param matchId - The match ID for S3 storage
 * @param rawMatchData - Raw match data from Riot API (required for match summary generation)
 * @param timelineData - Timeline data from Riot API (required for timeline summary)
 * @returns A promise that resolves to an object with review text, optional image, and metadata, or undefined if API keys are not configured
 */
export async function generateMatchReview(
  match: CompletedMatch | ArenaMatch,
  matchId: MatchId,
  rawMatchData: RawMatch,
  timelineData: RawTimeline,
): Promise<
  { text: string; image?: Uint8Array; metadata?: ReviewMetadata } | undefined
> {
  // Initialize clients
  const openaiClient = getOpenAIClient();
  if (!openaiClient) {
    logger.info("OpenAI API key not configured, skipping review generation");
    return undefined;
  }

  const geminiClient = getGeminiClient();

  // Select player
  const playerIndex = selectPlayerIndex(match);
  const selectedPlayer = match.players[playerIndex];
  if (!selectedPlayer) {
    logger.info(
      "No player found at selected index, skipping review generation",
    );
    return undefined;
  }

  const playerName = selectedPlayer.playerConfig.alias;
  if (!playerName) {
    logger.info("No player name found, skipping review generation");
    return undefined;
  }

  // Determine lane context
  let laneForContext: string | undefined;
  if (
    match.queueType !== "arena" &&
    "lane" in selectedPlayer &&
    typeof selectedPlayer.lane === "string"
  ) {
    laneForContext = selectedPlayer.lane;
  }

  // Get lane context (sync) and load personality (async)
  const laneContextInfo = getLaneContext(laneForContext);
  const personality = await selectRandomPersonality();

  logger.info(
    `Selected player ${(playerIndex + 1).toString()}/${match.players.length.toString()}: ${playerName}`,
  );
  logger.info(
    `Selected personality: ${personality.filename ?? personality.metadata.name}`,
  );
  logger.info(`Selected lane context: ${laneContextInfo.filename}`);

  const queueType =
    match.queueType === "arena" ? "arena" : (match.queueType ?? "unknown");
  const trackedPlayerAliases = match.players.map((p) => p.playerConfig.alias);

  // Call unified pipeline
  let pipelineOutput: ReviewPipelineOutput;

  // Build match input - raw and rawTimeline are required for summaries
  const matchInput: Parameters<typeof generateFullMatchReview>[0]["match"] = {
    processed: match,
    raw: rawMatchData,
    rawTimeline: timelineData,
  };

  // Build clients input
  const clientsInput: Parameters<typeof generateFullMatchReview>[0]["clients"] =
    {
      openai: openaiClient,
    };
  if (geminiClient !== undefined) {
    clientsInput.gemini = geminiClient;
  }

  // Get default stage configs and conditionally disable image generation
  // Generate images only 33% of the time to reduce costs
  const stages = getDefaultStageConfigs();
  const shouldGenerateImage = Math.random() < 0.33;
  if (shouldGenerateImage) {
    logger.info("Image generation enabled for this review (33% probability)");
  } else {
    stages.imageDescription.enabled = false;
    stages.imageGeneration.enabled = false;
    logger.info("Image generation disabled for this review (67% probability)");
  }

  try {
    pipelineOutput = await generateFullMatchReview({
      match: matchInput,
      player: {
        index: playerIndex,
      },
      prompts: {
        personality,
        laneContext: laneContextInfo.content,
      },
      clients: clientsInput,
      stages,
    });
  } catch (error) {
    logger.error("Pipeline failed:", error);
    Sentry.captureException(error, {
      tags: {
        source: "review-pipeline",
        queueType,
      },
    });
    return undefined;
  }

  // Save traces to S3 (fire and forget, don't block return)
  void (async () => {
    try {
      await savePipelineTracesToS3({
        matchId,
        queueType,
        trackedPlayerAliases,
        output: pipelineOutput,
      });
    } catch (error) {
      logger.error("Failed to save pipeline traces to S3:", error);
    }
  })();

  // Also save debug data
  void (async () => {
    try {
      await savePipelineDebugToS3({
        matchId,
        queueType,
        trackedPlayerAliases,
        output: pipelineOutput,
      });
    } catch (error) {
      logger.error("Failed to save pipeline debug to S3:", error);
    }
  })();

  // Convert base64 image to Uint8Array if present
  let reviewImage: Uint8Array | undefined;
  if (pipelineOutput.review.imageBase64) {
    try {
      const binaryString = atob(pipelineOutput.review.imageBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.codePointAt(i) ?? 0;
      }
      reviewImage = bytes;
    } catch (error) {
      logger.error("Failed to decode image:", error);
    }
  }

  return {
    text: pipelineOutput.review.text,
    ...(reviewImage && { image: reviewImage }),
    metadata: {
      reviewerName: pipelineOutput.context.reviewerName,
      playerName: pipelineOutput.context.playerName,
    },
  };
}
