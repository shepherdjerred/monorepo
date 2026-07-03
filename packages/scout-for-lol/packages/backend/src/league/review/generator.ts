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
  type Lane,
  type DiscordGuildId,
  generateFullMatchReview,
  getDefaultStageConfigs,
  getPatchChangeset,
  selectRelevantPatchChanges,
  formatPatchNotes,
  type ReviewPipelineOutput,
} from "@scout-for-lol/data/index.ts";
import * as Sentry from "@sentry/bun";
import { selectRandomPersonality, getLaneContext } from "./prompts.ts";
import { getOpenAIClient, getGeminiClient } from "./ai-clients.ts";
import { buildPlayerHistoryContext } from "./player-history.ts";
import {
  savePipelineTracesToS3,
  savePipelineDebugToS3,
} from "#src/storage/pipeline-s3.ts";
import { createLogger } from "#src/logger.ts";
import {
  classifyOpenAIProviderIssue,
  recordProviderIssue,
  resolveProviderIssue,
} from "#src/alerts/provider-metrics.ts";
import { PROVIDER_ISSUE_KINDS } from "#src/alerts/provider-issue-kinds.ts";

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
 * Build the current-patch context, cross-referenced against the reviewed
 * player's champions (this-game + recent pool), role, and this-game build. Falls
 * back to the generic patch overview when nothing specific matches; "" when
 * there's no changeset at all.
 */
function buildPatchNotesContext(
  champions: string[],
  lanes: (Lane | undefined)[],
  items: number[],
): string {
  const changeset = getPatchChangeset();
  if (changeset === undefined) {
    return "";
  }
  const subset = selectRelevantPatchChanges(changeset, {
    champions,
    lanes,
    items,
  });
  return formatPatchNotes(changeset, subset);
}

/** Decode the pipeline's base64 review image into bytes; undefined on absence/error. */
function decodeReviewImage(
  imageBase64: string | undefined,
): Uint8Array | undefined {
  if (imageBase64 === undefined || imageBase64.length === 0) {
    return undefined;
  }
  try {
    const binaryString = atob(imageBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.codePointAt(i) ?? 0;
    }
    return bytes;
  } catch (error) {
    logger.error("Failed to decode image:", error);
    return undefined;
  }
}

type SelectedReviewPlayer = (CompletedMatch | ArenaMatch)["players"][number];

/**
 * Build the DB-backed player-history block and the cross-referenced patch block
 * for the selected player. A player with no tracked account or no prior games
 * yields an empty history block (not an error). A genuine DB/parse failure
 * propagates (fail-fast) to the review's outer error handler rather than being
 * silently swallowed.
 */
async function buildDynamicReviewContext(params: {
  match: CompletedMatch | ArenaMatch;
  selectedPlayer: SelectedReviewPlayer;
  matchId: MatchId;
  targetServerIds?: DiscordGuildId[];
}): Promise<{ playerHistory: string; patchNotes: string }> {
  const { match, selectedPlayer, matchId, targetServerIds } = params;

  const selectedLane: Lane | undefined =
    match.queueType !== "arena" &&
    "lane" in selectedPlayer &&
    selectedPlayer.lane !== undefined
      ? selectedPlayer.lane
      : undefined;
  const selectedItems = selectedPlayer.champion.items;
  const durationInSeconds =
    "durationInSeconds" in match ? match.durationInSeconds : 0;

  const history = await buildPlayerHistoryContext({
    puuid: selectedPlayer.playerConfig.league.leagueAccount.puuid,
    currentMatchId: matchId,
    currentGame: {
      championName: selectedPlayer.champion.championName,
      lane: selectedLane,
      kills: selectedPlayer.champion.kills,
      deaths: selectedPlayer.champion.deaths,
      assists: selectedPlayer.champion.assists,
      creepScore:
        "creepScore" in selectedPlayer.champion
          ? selectedPlayer.champion.creepScore
          : 0,
      durationSeconds: durationInSeconds,
    },
    ...(targetServerIds !== undefined && { targetServerIds }),
  });

  const championsForPatch =
    history.poolChampions.length > 0
      ? history.poolChampions
      : [selectedPlayer.champion.championName];
  const patchNotes = buildPatchNotesContext(
    championsForPatch,
    [selectedLane],
    selectedItems,
  );
  return { playerHistory: history.text, patchNotes };
}

function reportOpenAIProviderIssue(
  error: unknown,
  context: {
    matchId: MatchId;
  },
): boolean {
  const providerIssueKind = classifyOpenAIProviderIssue(error);
  if (providerIssueKind === null) return false;

  recordProviderIssue({
    app: "scout-for-lol",
    provider: "openai",
    kind: providerIssueKind,
    source: "match_review",
  });
  logger.warn(
    `OpenAI provider issue while generating AI review for ${context.matchId}: ${providerIssueKind}`,
  );
  return true;
}

function resolveOpenAIProviderIssues(): void {
  for (const kind of PROVIDER_ISSUE_KINDS) {
    resolveProviderIssue({
      app: "scout-for-lol",
      provider: "openai",
      kind,
      source: "match_review",
    });
  }
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
 * @param options.match - The completed match data (regular or arena)
 * @param options.matchId - The match ID for S3 storage
 * @param options.rawMatchData - Raw match data from Riot API (required for match summary generation)
 * @param options.timelineData - Timeline data from Riot API (required for timeline summary)
 * @param options.targetServerIds - Discord guild ids the report targets, used to scope player history
 * @returns A promise that resolves to an object with review text, optional image, and metadata, or undefined if API keys are not configured
 */
export type GenerateMatchReviewOptions = {
  match: CompletedMatch | ArenaMatch;
  matchId: MatchId;
  rawMatchData: RawMatch;
  timelineData: RawTimeline;
  targetServerIds?: DiscordGuildId[];
};

export async function generateMatchReview(
  options: GenerateMatchReviewOptions,
): Promise<
  { text: string; image?: Uint8Array; metadata?: ReviewMetadata } | undefined
> {
  const { match, matchId, rawMatchData, timelineData, targetServerIds } =
    options;
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

  // Build player-history + patch context for the selected player (best-effort).
  const { playerHistory, patchNotes } = await buildDynamicReviewContext({
    match,
    selectedPlayer,
    matchId,
    ...(targetServerIds !== undefined && { targetServerIds }),
  });

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

  const promptsInput: Parameters<typeof generateFullMatchReview>[0]["prompts"] =
    {
      personality,
      laneContext: laneContextInfo.content,
    };
  if (playerHistory.length > 0) {
    promptsInput.playerHistory = playerHistory;
  }
  if (patchNotes.length > 0) {
    promptsInput.patchNotes = patchNotes;
  }

  try {
    pipelineOutput = await generateFullMatchReview({
      match: matchInput,
      player: {
        index: playerIndex,
      },
      prompts: promptsInput,
      clients: clientsInput,
      stages,
    });
  } catch (error) {
    if (
      reportOpenAIProviderIssue(error, {
        matchId,
      })
    ) {
      return undefined;
    }

    logger.error("Pipeline failed:", error);
    Sentry.captureException(error, {
      tags: {
        source: "review-pipeline",
        queueType,
      },
    });
    return undefined;
  }

  resolveOpenAIProviderIssues();

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
  const reviewImage = decodeReviewImage(pipelineOutput.review.imageBase64);

  return {
    text: pipelineOutput.review.text,
    ...(reviewImage && { image: reviewImage }),
    metadata: {
      reviewerName: pipelineOutput.context.reviewerName,
      playerName: pipelineOutput.context.playerName,
    },
  };
}
