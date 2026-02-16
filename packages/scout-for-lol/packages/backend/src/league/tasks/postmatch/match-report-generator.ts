import { z } from "zod";
import * as Sentry from "@sentry/bun";
import type {
  PlayerConfigEntry,
  MatchId,
  CompletedMatch,
  ArenaMatch,
  QueueType,
  RawMatch,
  RawTimeline,
  Rank,
  DiscordGuildId,
} from "@scout-for-lol/data/index.ts";
import {
  parseQueueType,
  MatchIdSchema,
  queueTypeToDisplayString,
  MIN_GAME_DURATION_SECONDS,
} from "@scout-for-lol/data/index.ts";
import { getFlag } from "@scout-for-lol/backend/configuration/flags.ts";
import { getPlayer } from "@scout-for-lol/backend/league/model/player.ts";
import type { MessageCreateOptions } from "discord.js";
import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { matchToSvg, arenaMatchToSvg, svgToPng } from "@scout-for-lol/report";
import { saveMatchToS3, saveImageToS3, saveSvgToS3, saveTimelineToS3 } from "@scout-for-lol/backend/storage/s3.ts";
import { toMatch, toArenaMatch } from "@scout-for-lol/backend/league/model/match.ts";
import { generateMatchReview } from "@scout-for-lol/backend/league/review/generator.ts";
import { match } from "ts-pattern";
import { logErrorDetails } from "./match-report-debug.ts";
import { fetchMatchTimeline } from "./match-data-fetcher.ts";
import { isExceptionalGame } from "./exceptional-game.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import { saveMatchRankHistory, getLatestRankBefore } from "@scout-for-lol/backend/league/model/rank-history.ts";

const logger = createLogger("postmatch-match-report-generator");

function captureError(error: unknown, source: string, matchId?: string, extra?: Record<string, string>): void {
  Sentry.captureException(error, { tags: { source, ...(matchId && { matchId }), ...extra } });
}

/** Format a natural language message about who finished the game */
function formatGameCompletionMessage(playerAliases: string[], queueType: QueueType): string {
  const queueName = queueTypeToDisplayString(queueType);
  const validAliases = z.array(z.string().min(1)).parse(playerAliases.filter((alias) => alias.trim().length > 0));

  if (validAliases.length === 0) {
    return `Game finished: ${queueName}`;
  }

  if (validAliases.length === 1) {
    const soloAlias = z.string().parse(validAliases[0]);
    return `${soloAlias} finished a ${queueName} game`;
  }

  if (validAliases.length === 2) {
    const firstAlias = z.string().parse(validAliases[0]);
    const secondAlias = z.string().parse(validAliases[1]);
    return `${firstAlias} and ${secondAlias} finished a ${queueName} game`;
  }

  const allButLast = validAliases.slice(0, -1).join(", ");
  const lastAlias = z.string().parse(validAliases[validAliases.length - 1]);
  return `${allButLast}, and ${lastAlias} finished a ${queueName} game`;
}

/** Create image attachments for Discord message */
async function createMatchImage(
  matchToRender: CompletedMatch | ArenaMatch,
  matchId: MatchId,
): Promise<[AttachmentBuilder, EmbedBuilder]> {
  const svgData =
    matchToRender.queueType === "arena" ? await arenaMatchToSvg(matchToRender) : await matchToSvg(matchToRender);
  const svg = z.string().parse(svgData);
  const image = z.instanceof(Uint8Array).parse(await svgToPng(svg));

  // Save both PNG and SVG to S3 (fire and forget)
  const queueTypeForStorage = matchToRender.queueType === "arena" ? "arena" : (matchToRender.queueType ?? "unknown");
  const trackedPlayerAliases = matchToRender.players.map((p) => p.playerConfig.alias);
  void (async () => {
    try {
      await Promise.all([
        saveImageToS3(matchId, image, queueTypeForStorage, trackedPlayerAliases),
        saveSvgToS3(matchId, svg, queueTypeForStorage, trackedPlayerAliases),
      ]);
    } catch (error) {
      logger.error(`[createMatchImage] Failed to save images to S3:`, error);
    }
  })();

  const attachmentName = `${matchId}.png`;
  const attachment = new AttachmentBuilder(Buffer.from(image)).setName(attachmentName);
  const embed = new EmbedBuilder({ image: { url: `attachment://${attachmentName}` } });
  return [attachment, embed];
}

/**
 * Check if queue type is ranked
 */
function isRankedQueue(queueType: QueueType | undefined): boolean {
  return queueType === "solo" || queueType === "flex" || queueType === "clash" || queueType === "aram clash";
}

/**
 * Check if Jerred is in the match
 */
function hasJerred(playersInMatch: PlayerConfigEntry[]): boolean {
  return playersInMatch.some((p) => p.alias.toLowerCase() === "jerred");
}

/**
 * Process arena match and generate Discord message
 */
async function processArenaMatch(
  players: Awaited<ReturnType<typeof getPlayer>>[],
  matchData: RawMatch,
  matchId: MatchId,
  playersInMatch: PlayerConfigEntry[],
): Promise<MessageCreateOptions> {
  logger.info(`[generateMatchReport] 🎯 Processing as arena match`);
  const arenaMatch = toArenaMatch(players, matchData);

  // Create Discord message for arena
  const [attachment, embed] = await createMatchImage(arenaMatch, matchId);

  // Generate completion message
  const playerAliases = playersInMatch.map((p) => p.alias);
  const completionMessage = formatGameCompletionMessage(playerAliases, arenaMatch.queueType);

  return {
    content: completionMessage,
    files: [attachment],
    embeds: [embed],
  };
}

type StandardMatchContext = {
  players: Awaited<ReturnType<typeof getPlayer>>[];
  matchData: RawMatch;
  matchId: MatchId;
  playersInMatch: PlayerConfigEntry[];
  timelineData: RawTimeline | undefined;
  /** Guild IDs that will receive this match report - used for feature flag checks */
  targetGuildIds: DiscordGuildId[];
};

/**
 * Check if AI reviews are enabled for any of the target guilds
 */
function isAiReviewEnabledForAnyGuild(guildIds: DiscordGuildId[]): boolean {
  return guildIds.some((guildId) => getFlag("ai_reviews_enabled", { server: guildId }));
}

type AiReviewResult = { text: string | undefined; image: Uint8Array | undefined };

type AiReviewContext = {
  completedMatch: CompletedMatch;
  matchId: MatchId;
  matchData: RawMatch;
  timelineData: RawTimeline | undefined;
  playersInMatch: PlayerConfigEntry[];
  targetGuildIds: DiscordGuildId[];
};

/**
 * Generate AI review for a match if conditions are met
 */
async function generateAiReviewIfEnabled(ctx: AiReviewContext): Promise<AiReviewResult> {
  const { completedMatch, matchId, matchData, timelineData, playersInMatch, targetGuildIds } = ctx;
  const aiReviewsEnabled = isAiReviewEnabledForAnyGuild(targetGuildIds);
  if (!aiReviewsEnabled) {
    logger.info(
      `[generateMatchReport] Skipping AI review - feature not enabled for target guilds: ${targetGuildIds.join(", ")}`,
    );
    return { text: undefined, image: undefined };
  }

  // Jerred override for testing - always generate reviews for his games
  const jerredOverride = hasJerred(playersInMatch);

  // Check if game is exceptional (good or bad performance)
  const exceptionalResult = isExceptionalGame(matchData, playersInMatch, completedMatch.durationInSeconds);

  // Only generate reviews for ranked games with exceptional performance, or Jerred override
  const isRanked = isRankedQueue(completedMatch.queueType);
  const shouldGenerateReview = jerredOverride || (isRanked && exceptionalResult.isExceptional);

  if (!shouldGenerateReview) {
    const reason = !isRanked
      ? `not a ranked queue (queueType: ${completedMatch.queueType ?? "unknown"})`
      : "not an exceptional game";
    logger.info(`[generateMatchReport] Skipping AI review - ${reason}`);
    return { text: undefined, image: undefined };
  }

  // Log why we're generating the review
  if (jerredOverride) {
    logger.info(`[generateMatchReport] Generating AI review - Jerred override enabled`);
  }
  if (exceptionalResult.isExceptional) {
    logger.info(`[generateMatchReport] Exceptional game detected: ${exceptionalResult.reason}`);
  }

  if (completedMatch.durationInSeconds < MIN_GAME_DURATION_SECONDS) {
    const durationMinutes = (completedMatch.durationInSeconds / 60).toFixed(1);
    logger.info(`[generateMatchReport] Skipping AI review - game too short (${durationMinutes} min < 15 min)`);
    return { text: undefined, image: undefined };
  }

  if (!timelineData) {
    logger.warn(
      `[generateMatchReport] Skipping AI review - timeline data required but not available for match ${matchId}`,
    );
    return { text: undefined, image: undefined };
  }

  try {
    const review = await generateMatchReview(completedMatch, matchId, matchData, timelineData);
    return { text: review?.text, image: review?.image };
  } catch (error) {
    logger.error(`[generateMatchReport] Error generating AI review:`, error);
    captureError(error, "ai-review-generation", matchId, { queueType: completedMatch.queueType ?? "unknown" });
    return { text: undefined, image: undefined };
  }
}

/**
 * Process standard match and generate Discord message
 */
async function processStandardMatch(ctx: StandardMatchContext): Promise<MessageCreateOptions> {
  const { players, matchData, matchId, playersInMatch, timelineData, targetGuildIds } = ctx;
  logger.info(`[generateMatchReport] ⚔️  Processing as standard match`);
  // Process match for all tracked players
  if (players.length === 0) {
    throw new Error("No player data available");
  }

  const queueType = parseQueueType(matchData.info.queueId);
  const queue = queueType === "solo" || queueType === "flex" ? queueType : undefined;

  // Build rank map for each player by looking up previous rank and using current as "after"
  const playerRanksMap = new Map<string, { before: Rank | undefined; after: Rank | undefined }>();

  if (queue) {
    await Promise.all(
      players.map(async (player) => {
        const puuid = player.config.league.leagueAccount.puuid;
        const currentRank = player.ranks[queue]; // This is POST-match rank (already fetched by getPlayer)

        // Look up the most recent rank before this match
        const previousRank = await getLatestRankBefore(puuid, queue, matchData.info.gameEndTimestamp);

        // Store this match's rank history
        await saveMatchRankHistory({
          matchId,
          puuid,
          queueType: queue,
          rankBefore: previousRank,
          rankAfter: currentRank,
        });

        playerRanksMap.set(puuid, {
          before: previousRank,
          after: currentRank,
        });
      }),
    );
  }

  // Build CompletedMatch with per-player rank data
  const completedMatch = toMatch(players, matchData, playerRanksMap);

  // Generate AI review (text and optional image) - gated by feature flag and queue type
  const { text: reviewText, image: reviewImage } = await generateAiReviewIfEnabled({
    completedMatch,
    matchId,
    matchData,
    timelineData,
    playersInMatch,
    targetGuildIds,
  });

  // Create Discord message
  const [matchReportAttachment, matchReportEmbed] = await createMatchImage(completedMatch, matchId);

  // Build files array - start with match report image
  const files = [matchReportAttachment];

  // Add AI-generated image if available
  if (reviewImage) {
    const aiBuffer = Buffer.from(reviewImage);
    const aiImageAttachment = new AttachmentBuilder(aiBuffer).setName("ai-review.png");
    files.push(aiImageAttachment);
    logger.info(`[generateMatchReport] ✨ Added AI-generated image to message`);
  }

  // Generate completion message
  const playerAliases = playersInMatch.map((p) => p.alias);
  const queueTypeForMessage = completedMatch.queueType ?? "custom";
  const completionMessage = formatGameCompletionMessage(playerAliases, queueTypeForMessage);

  // Combine completion message with review text if available (always include text, even with image)
  let messageContent = completionMessage;
  if (reviewText) {
    messageContent = `${completionMessage}\n\n${reviewText}`;
  }

  return {
    files: files,
    embeds: [matchReportEmbed],
    content: messageContent,
  };
}

/**
 * Fetch timeline data for standard (non-arena) matches
 * Returns undefined for arena matches or if timeline fetch fails
 * Also saves the timeline to S3 for later use (e.g., frontend AI review generation)
 */
async function fetchTimelineIfStandardMatch(
  matchData: RawMatch,
  matchId: MatchId,
  playersInMatch: PlayerConfigEntry[],
): Promise<RawTimeline | undefined> {
  // Don't fetch timeline for arena matches
  if (matchData.info.queueId === 1700) {
    return undefined;
  }

  const firstPlayer = playersInMatch[0];
  if (!firstPlayer) {
    return undefined;
  }

  const playerRegion = firstPlayer.league.leagueAccount.region;
  try {
    logger.info(`[generateMatchReport] 📊 Fetching timeline data for match ${matchId}`);
    const timelineData = await fetchMatchTimeline(matchId, playerRegion);
    if (timelineData) {
      logger.info(
        `[generateMatchReport] ✅ Timeline fetched with ${timelineData.info.frames.length.toString()} frames`,
      );

      // Save timeline to S3 for later use (e.g., frontend AI review generation)
      try {
        const trackedPlayerAliases = playersInMatch.map((p) => p.alias);
        await saveTimelineToS3(timelineData, trackedPlayerAliases);
      } catch (error) {
        logger.error(`[generateMatchReport] Error saving timeline ${matchId} to S3:`, error);
        // Continue processing even if S3 storage fails
      }
    }
    return timelineData;
  } catch (error) {
    logger.error(`[generateMatchReport] ⚠️  Failed to fetch timeline, continuing without it:`, error);
    captureError(error, "timeline-fetch-wrapper", matchId);
    return undefined;
  }
}

/**
 * Options for generating a match report
 */
export type GenerateMatchReportOptions = {
  /** Guild IDs that will receive this report - used for feature flag checks (e.g., AI reviews) */
  targetGuildIds: DiscordGuildId[];
};

/**
 * Generate a match report message for Discord
 *
 * @param matchData - The match data from Riot API
 * @param trackedPlayers - List of player configs to include in the match (should be in the match)
 * @param options - Options including target guild IDs for feature flag checks
 * @returns MessageCreateOptions ready to send to Discord, or undefined if no tracked players found
 */
export async function generateMatchReport(
  matchData: RawMatch,
  trackedPlayers: PlayerConfigEntry[],
  options: GenerateMatchReportOptions,
): Promise<MessageCreateOptions | undefined> {
  const matchId = MatchIdSchema.parse(matchData.metadata.matchId);
  logger.info(`[generateMatchReport] 🎮 Generating report for match ${matchId}`);

  try {
    // Determine which tracked players are in this match
    const playersInMatch = trackedPlayers.filter((player) =>
      matchData.metadata.participants.includes(player.league.leagueAccount.puuid),
    );

    // Save match data to S3 (with tracked player aliases if any)
    try {
      const trackedPlayerAliases = playersInMatch.map((p) => p.alias);
      await saveMatchToS3(matchData, trackedPlayerAliases);
    } catch (error) {
      logger.error(`[generateMatchReport] Error saving match ${matchId} to S3:`, error);
      // Continue processing even if S3 storage fails
    }

    if (playersInMatch.length === 0) {
      logger.info(`[generateMatchReport] ⚠️  No tracked players found in match ${matchId}`);
      return undefined;
    }

    logger.info(
      `[generateMatchReport] 👥 Found ${playersInMatch.length.toString()} tracked player(s) in match: ${playersInMatch.map((p) => p.alias).join(", ")}`,
    );

    // Get full player data with ranks
    const players = await Promise.all(playersInMatch.map((playerConfig) => getPlayer(playerConfig)));

    // Fetch timeline data for standard matches (to provide game progression context for AI reviews)
    const timelineData = await fetchTimelineIfStandardMatch(matchData, matchId, playersInMatch);

    // Process match based on queue type
    return await match<number, Promise<MessageCreateOptions>>(matchData.info.queueId)
      .with(1700, () => processArenaMatch(players, matchData, matchId, playersInMatch))
      .otherwise(() =>
        processStandardMatch({
          players,
          matchData,
          matchId,
          playersInMatch,
          timelineData,
          targetGuildIds: options.targetGuildIds,
        }),
      );
  } catch (error) {
    logErrorDetails(error, matchId, matchData, trackedPlayers);
    throw error;
  }
}
