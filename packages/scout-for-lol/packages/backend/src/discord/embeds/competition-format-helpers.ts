import type {
  CompetitionCriteria,
  CompetitionQueueType,
  CompetitionWithCriteria,
  Rank,
  getCompetitionStatus,
} from "@scout-for-lol/data";
import {
  competitionQueueTypeToString,
  rankToString,
  RankSchema,
} from "@scout-for-lol/data";
import { Colors } from "discord.js";
import { match } from "ts-pattern";
import { z } from "zod";
import { getChampionName } from "twisted/dist/constants/champions.js";
import { differenceInCalendarDays, format } from "date-fns";

type CompetitionStatus = ReturnType<typeof getCompetitionStatus>;

/**
 * Color codes for different competition statuses
 */
const STATUS_COLORS: Record<CompetitionStatus, number> = {
  ACTIVE: Colors.Green,
  DRAFT: Colors.Blue,
  ENDED: Colors.Red,
  CANCELLED: Colors.Grey,
};

/**
 * Status emoji indicators
 */
const STATUS_EMOJIS: Record<CompetitionStatus, string> = {
  ACTIVE: "🟢",
  DRAFT: "🔵",
  ENDED: "🔴",
  CANCELLED: "⚫",
};

/**
 * Medal emojis for top 3 positions
 */
const MEDAL_EMOJIS: Record<number, string> = {
  1: "🥇",
  2: "🥈",
  3: "🥉",
};

/**
 * Convert competition criteria to human-readable description
 */
export function formatCriteriaDescription(
  criteria: CompetitionCriteria,
): string {
  return match(criteria)
    .with(
      { type: "MOST_GAMES_PLAYED" },
      (c) => `Most games played in ${formatQueue(c.queue)}`,
    )
    .with(
      { type: "HIGHEST_RANK" },
      (c) => `Highest rank in ${formatQueue(c.queue)}`,
    )
    .with(
      { type: "MOST_RANK_CLIMB" },
      (c) => `Most rank climb in ${formatQueue(c.queue)}`,
    )
    .with(
      { type: "MOST_WINS_PLAYER" },
      (c) => `Most wins in ${formatQueue(c.queue)}`,
    )
    .with({ type: "MOST_WINS_CHAMPION" }, (c) => {
      const championName = getChampionNameSafe(c.championId);
      const queueSuffix = c.queue ? ` in ${formatQueue(c.queue)}` : "";
      return `Most wins with ${championName}${queueSuffix}`;
    })
    .with(
      { type: "HIGHEST_WIN_RATE" },
      (c) =>
        `Highest win rate in ${formatQueue(c.queue)} (min ${c.minGames.toString()} games)`,
    )
    .exhaustive();
}

/**
 * Format a score value based on the competition criteria type
 */
export function formatScore(
  score: number | Rank,
  criteria: CompetitionCriteria,
  metadata?: Record<string, unknown>,
): string {
  return match(criteria)
    .with({ type: "MOST_GAMES_PLAYED" }, () => {
      const numScore = z.number().parse(score);
      return `${numScore.toString()} game${numScore === 1 ? "" : "s"}`;
    })
    .with({ type: "HIGHEST_RANK" }, () => {
      const rankScore = RankSchema.parse(score);
      return rankToString(rankScore);
    })
    .with({ type: "MOST_RANK_CLIMB" }, () => {
      const numScore = z.number().parse(score);
      return `${numScore.toString()} LP gained`;
    })
    .with({ type: "MOST_WINS_PLAYER" }, () => {
      const numScore = z.number().parse(score);
      return formatWinsScore(numScore, metadata);
    })
    .with({ type: "MOST_WINS_CHAMPION" }, () => {
      const numScore = z.number().parse(score);
      return formatWinsScore(numScore, metadata);
    })
    .with({ type: "HIGHEST_WIN_RATE" }, () => {
      const numScore = z.number().parse(score);
      return formatWinRateScore(numScore, metadata);
    })
    .exhaustive();
}

function formatWinsScore(
  wins: number,
  metadata?: Record<string, unknown>,
): string {
  const baseText = `${wins.toString()} win${wins === 1 ? "" : "s"}`;
  if (!metadata) {
    return baseText;
  }
  const MetadataSchema = z.object({ games: z.number().positive() });
  const result = MetadataSchema.safeParse(metadata);
  if (result.success) {
    const games = result.data.games;
    const losses = games - wins;
    const winRate = (wins / games) * 100;
    return `${baseText} (${wins.toString()}-${losses.toString()}, ${winRate.toFixed(0)}%)`;
  }
  return baseText;
}

function formatWinRateScore(
  winRate: number,
  metadata?: Record<string, unknown>,
): string {
  const rateText = `${winRate.toFixed(1)}%`;
  if (!metadata) {
    return rateText;
  }
  const MetadataSchema = z.object({
    wins: z.number(),
    games: z.number().positive(),
  });
  const result = MetadataSchema.safeParse(metadata);
  if (result.success) {
    const wins = result.data.wins;
    const games = result.data.games;
    const losses = games - wins;
    return `${rateText} (${wins.toString()}-${losses.toString()})`;
  }
  return rateText;
}

/**
 * Get Discord embed color for competition status
 */
export function getStatusColor(status: CompetitionStatus): number {
  return STATUS_COLORS[status];
}

/**
 * Get status text with emoji and time information
 */
export function getStatusText(
  status: CompetitionStatus,
  competition: CompetitionWithCriteria,
): string {
  const emoji = STATUS_EMOJIS[status];
  const now = new Date();

  return match(status)
    .with("DRAFT", () => {
      if (competition.startDate) {
        const daysUntilStart = differenceInCalendarDays(
          competition.startDate,
          now,
        );
        return `${emoji} Draft (starts in ${daysUntilStart.toString()} day${daysUntilStart === 1 ? "" : "s"})`;
      }
      return `${emoji} Draft`;
    })
    .with("ACTIVE", () => {
      if (competition.endDate) {
        const daysRemaining = differenceInCalendarDays(
          competition.endDate,
          now,
        );
        return `${emoji} Active (${daysRemaining.toString()} day${daysRemaining === 1 ? "" : "s"} remaining)`;
      }
      return `${emoji} Active`;
    })
    .with("ENDED", () => {
      if (competition.endDate) {
        const endedDate = format(competition.endDate, "MMM d, yyyy");
        return `${emoji} Ended (Completed ${endedDate})`;
      }
      return `${emoji} Ended`;
    })
    .with("CANCELLED", () => `${emoji} Cancelled`)
    .exhaustive();
}

/**
 * Get medal emoji for rank position
 */
export function getMedalEmoji(rank: number): string {
  return MEDAL_EMOJIS[rank] ?? "  ";
}

/**
 * Format queue type to human-readable string
 */
export function formatQueue(queue: CompetitionQueueType): string {
  return competitionQueueTypeToString(queue);
}

/**
 * Get champion name from ID with error handling
 */
export function getChampionNameSafe(championId: number): string {
  try {
    const name = getChampionName(championId);
    if (name && name !== "") {
      return name;
    }
    return `Champion ${championId.toString()}`;
  } catch {
    return `Champion ${championId.toString()}`;
  }
}
