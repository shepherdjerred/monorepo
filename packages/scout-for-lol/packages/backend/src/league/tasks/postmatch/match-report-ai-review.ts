import type {
  PlayerConfigEntry,
  MatchId,
  CompletedMatch,
  QueueType,
  RawMatch,
  RawTimeline,
  DiscordGuildId,
} from "@scout-for-lol/data/index.ts";
import { MIN_GAME_DURATION_SECONDS } from "@scout-for-lol/data/index.ts";
import { getFlag } from "@scout-for-lol/backend/configuration/flags.ts";
import { generateMatchReview } from "@scout-for-lol/backend/league/review/generator.ts";
import { isExceptionalGame } from "./exceptional-game.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import * as Sentry from "@sentry/bun";

const logger = createLogger("postmatch-match-report-ai-review");

/**
 * Check if queue type is ranked
 */
export function isRankedQueue(queueType: QueueType | undefined): boolean {
  return (
    queueType === "solo" ||
    queueType === "flex" ||
    queueType === "clash" ||
    queueType === "aram clash"
  );
}

/**
 * Check if Jerred is in the match
 */
function hasJerred(playersInMatch: PlayerConfigEntry[]): boolean {
  return playersInMatch.some((p) => p.alias.toLowerCase() === "jerred");
}

/**
 * Check if AI reviews are enabled for any of the target guilds
 */
function isAiReviewEnabledForAnyGuild(guildIds: DiscordGuildId[]): boolean {
  return guildIds.some((guildId) =>
    getFlag("ai_reviews_enabled", { server: guildId }),
  );
}

export type AiReviewResult = {
  text: string | undefined;
  image: Uint8Array | undefined;
};

export type AiReviewContext = {
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
export async function generateAiReviewIfEnabled(
  ctx: AiReviewContext,
): Promise<AiReviewResult> {
  const {
    completedMatch,
    matchId,
    matchData,
    timelineData,
    playersInMatch,
    targetGuildIds,
  } = ctx;
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
  const exceptionalResult = isExceptionalGame(
    matchData,
    playersInMatch,
    completedMatch.durationInSeconds,
  );

  // Only generate reviews for ranked games with exceptional performance, or Jerred override
  const isRanked = isRankedQueue(completedMatch.queueType);
  const shouldGenerateReview =
    jerredOverride || (isRanked && exceptionalResult.isExceptional);

  if (!shouldGenerateReview) {
    const reason = !isRanked
      ? `not a ranked queue (queueType: ${completedMatch.queueType ?? "unknown"})`
      : "not an exceptional game";
    logger.info(`[generateMatchReport] Skipping AI review - ${reason}`);
    return { text: undefined, image: undefined };
  }

  // Log why we're generating the review
  if (jerredOverride) {
    logger.info(
      `[generateMatchReport] Generating AI review - Jerred override enabled`,
    );
  }
  if (exceptionalResult.isExceptional) {
    logger.info(
      `[generateMatchReport] Exceptional game detected: ${exceptionalResult.reason}`,
    );
  }

  if (completedMatch.durationInSeconds < MIN_GAME_DURATION_SECONDS) {
    const durationMinutes = (completedMatch.durationInSeconds / 60).toFixed(1);
    logger.info(
      `[generateMatchReport] Skipping AI review - game too short (${durationMinutes} min < 15 min)`,
    );
    return { text: undefined, image: undefined };
  }

  if (!timelineData) {
    logger.warn(
      `[generateMatchReport] Skipping AI review - timeline data required but not available for match ${matchId}`,
    );
    return { text: undefined, image: undefined };
  }

  try {
    const review = await generateMatchReview(
      completedMatch,
      matchId,
      matchData,
      timelineData,
    );
    return { text: review?.text, image: review?.image };
  } catch (error) {
    logger.error(`[generateMatchReport] Error generating AI review:`, error);
    Sentry.captureException(error, {
      tags: {
        source: "ai-review-generation",
        matchId,
        queueType: completedMatch.queueType ?? "unknown",
      },
    });
    return { text: undefined, image: undefined };
  }
}
