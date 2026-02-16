import type { CompetitionCriteria, CompetitionQueueType, CompetitionWithCriteria, Rank } from "@scout-for-lol/data";
import { getCompetitionStatus, competitionQueueTypeToString, rankToString, RankSchema } from "@scout-for-lol/data";
import { EmbedBuilder, Colors } from "discord.js";
import { match } from "ts-pattern";
import { z } from "zod";
import { getChampionName } from "twisted/dist/constants/champions.js";
import type { RankedLeaderboardEntry } from "@scout-for-lol/backend/league/competition/leaderboard.ts";
import { differenceInCalendarDays, format } from "date-fns";

// ============================================================================
// Types
// ============================================================================

type CompetitionStatus = ReturnType<typeof getCompetitionStatus>;

// ============================================================================
// Constants
// ============================================================================

/**
 * Color codes for different competition statuses
 */
const STATUS_COLORS = {
  ACTIVE: Colors.Green, // 0x57F287
  DRAFT: Colors.Blue, // 0x5865F2
  ENDED: Colors.Red, // 0xED4245
  CANCELLED: Colors.Grey, // 0x99AAB5
} as const;

/**
 * Status emoji indicators
 */
const STATUS_EMOJIS = {
  ACTIVE: "🟢",
  DRAFT: "🔵",
  ENDED: "🔴",
  CANCELLED: "⚫",
} as const;

/**
 * Medal emojis for top 3 positions
 */
const MEDAL_EMOJIS = {
  1: "🥇",
  2: "🥈",
  3: "🥉",
} as const;

// ============================================================================
// Main Embed Generation Functions
// ============================================================================

/**
 * Generate a Discord embed for competition leaderboard
 *
 * Shows:
 * - Competition title and description
 * - Status with time information
 * - Participant count
 * - Top 10 leaderboard entries (or fewer if less participants)
 * - User's position if viewing user is specified and outside top 10
 * - Footer with criteria description and last updated time
 *
 * @param competition Competition data with parsed criteria
 * @param leaderboard Ranked leaderboard entries (already sorted)
 * @param viewingUserId Optional Discord user ID of viewing user (to highlight their position)
 * @returns Formatted Discord embed
 */
export function generateLeaderboardEmbed(
  competition: CompetitionWithCriteria,
  leaderboard: RankedLeaderboardEntry[],
  viewingUserId?: string,
): EmbedBuilder {
  const status = getCompetitionStatus(competition);
  const color = getStatusColor(status);

  const embed = new EmbedBuilder().setTitle(`🏆 ${competition.title}`).setColor(color);

  // Add description if present
  if (competition.description) {
    embed.setDescription(competition.description);
  }

  // Add status field with time information
  const statusText = getStatusText(status, competition);
  embed.addFields({ name: "Status", value: statusText, inline: true });

  // Add participant count
  embed.addFields({
    name: "Participants",
    value: `${leaderboard.length.toString()}/${competition.maxParticipants.toString()}`,
    inline: true,
  });

  // Add owner
  embed.addFields({ name: "Owner", value: `<@${competition.ownerId}>`, inline: true });

  // Add leaderboard standings
  const standingsTitle = match(status)
    .with("ACTIVE", () => "📊 Current Standings")
    .with("ENDED", () => "🎉 Final Standings")
    .with("CANCELLED", () => "📊 Standings (at cancellation)")
    .otherwise(() => "📊 Standings");

  // Show top 10 entries
  const top10 = leaderboard.slice(0, 10);

  if (top10.length === 0) {
    embed.addFields({
      name: standingsTitle,
      value: "No participants have scores yet.",
      inline: false,
    });
  } else {
    const leaderboardText = top10
      .map((entry) => {
        const medal = getMedalEmoji(entry.rank);
        const score = formatScore(entry.score, competition.criteria, entry.metadata);
        const isViewingUser = viewingUserId && entry.discordId === viewingUserId;
        const baseText = `${medal} **${entry.rank.toString()}.** ${entry.playerName} - ${score}`;
        // Highlight viewing user's entry with an indicator
        return isViewingUser ? `${baseText} 👤` : baseText;
      })
      .join("\n");

    embed.addFields({
      name: standingsTitle,
      value: leaderboardText,
      inline: false,
    });

    // If there are more than 10 participants, indicate it
    if (leaderboard.length > 10) {
      embed.addFields({
        name: "\u200B",
        value: `(Showing top 10 of ${leaderboard.length.toString()} participants)`,
        inline: false,
      });
    }
  }

  // Add viewing user's position if they're outside top 10
  if (viewingUserId) {
    const userEntry = leaderboard.find((entry) => entry.discordId === viewingUserId);
    if (userEntry && userEntry.rank > 10) {
      const score = formatScore(userEntry.score, competition.criteria, userEntry.metadata);
      embed.addFields({
        name: "Your Position",
        value: `**${userEntry.rank.toString()}.** ${userEntry.playerName} - ${score} 👤`,
        inline: false,
      });
    }
  }

  // Add footer with criteria description and timestamp
  const criteriaDescription = formatCriteriaDescription(competition.criteria);
  const timestamp = new Date().toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  embed.setFooter({
    text: `${criteriaDescription} • Updated ${timestamp}`,
  });

  return embed;
}

/**
 * Generate a Discord embed with detailed competition information
 *
 * Shows all metadata about a competition including:
 * - Title and description
 * - Status with dates
 * - Owner and channel
 * - Visibility and max participants
 * - Criteria in human-readable form
 *
 * @param competition Competition data with parsed criteria
 * @returns Formatted Discord embed
 */
export function generateCompetitionDetailsEmbed(competition: CompetitionWithCriteria): EmbedBuilder {
  const status = getCompetitionStatus(competition);
  const color = getStatusColor(status);

  const embed = new EmbedBuilder().setTitle(`🏆 ${competition.title}`).setColor(color);

  // Add description if present
  if (competition.description) {
    embed.setDescription(competition.description);
  }

  // Status
  const statusText = getStatusText(status, competition);
  embed.addFields({ name: "Status", value: statusText, inline: true });

  // Owner
  embed.addFields({ name: "Owner", value: `<@${competition.ownerId}>`, inline: true });

  // Channel
  embed.addFields({ name: "Channel", value: `<#${competition.channelId}>`, inline: true });

  // Visibility
  const visibilityText = match(competition.visibility)
    .with("OPEN", () => "Open to All")
    .with("INVITE_ONLY", () => "Invite Only")
    .with("SERVER_WIDE", () => "Server-Wide")
    .otherwise(() => competition.visibility);
  embed.addFields({ name: "Visibility", value: visibilityText, inline: true });

  // Max participants
  embed.addFields({ name: "Max Participants", value: competition.maxParticipants.toString(), inline: true });

  // Created date
  const createdDate = competition.createdTime.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  embed.addFields({ name: "Created", value: createdDate, inline: true });

  // Add blank field for spacing
  embed.addFields({ name: "\u200B", value: "\u200B", inline: false });

  // Criteria description
  const criteriaDescription = formatCriteriaDescription(competition.criteria);
  embed.addFields({ name: "📊 Ranking Criteria", value: criteriaDescription, inline: false });

  // Date range (if applicable)
  if (competition.startDate && competition.endDate) {
    const startStr = competition.startDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const endStr = competition.endDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    embed.addFields({
      name: "📅 Duration",
      value: `**Start:** ${startStr}\n**End:** ${endStr}`,
      inline: false,
    });
  } else if (competition.seasonId) {
    embed.addFields({
      name: "📅 Duration",
      value: `Season-based: ${competition.seasonId}`,
      inline: false,
    });
  }

  // Footer
  embed.setFooter({ text: `Competition ID: ${competition.id.toString()}` });
  embed.setTimestamp(new Date());

  return embed;
}

/**
 * Convert competition criteria to human-readable description
 *
 * Examples:
 * - "Most games played in Solo Queue"
 * - "Highest rank in Flex Queue"
 * - "Most wins with Yasuo"
 *
 * @param criteria Competition criteria object
 * @returns Human-readable string description
 */
function formatCriteriaDescription(criteria: CompetitionCriteria): string {
  return match(criteria)
    .with({ type: "MOST_GAMES_PLAYED" }, (c) => `Most games played in ${formatQueue(c.queue)}`)
    .with({ type: "HIGHEST_RANK" }, (c) => `Highest rank in ${formatQueue(c.queue)}`)
    .with({ type: "MOST_RANK_CLIMB" }, (c) => `Most rank climb in ${formatQueue(c.queue)}`)
    .with({ type: "MOST_WINS_PLAYER" }, (c) => `Most wins in ${formatQueue(c.queue)}`)
    .with({ type: "MOST_WINS_CHAMPION" }, (c) => {
      const championName = getChampionNameSafe(c.championId);
      const queueSuffix = c.queue ? ` in ${formatQueue(c.queue)}` : "";
      return `Most wins with ${championName}${queueSuffix}`;
    })
    .with(
      { type: "HIGHEST_WIN_RATE" },
      (c) => `Highest win rate in ${formatQueue(c.queue)} (min ${c.minGames.toString()} games)`,
    )
    .exhaustive();
}

/**
 * Format a score value based on the competition criteria type
 *
 * Handles different score types:
 * - Number: "15 games", "42 wins"
 * - Rank: "Diamond II (67 LP)"
 *
 * Also uses metadata to provide additional context like win/loss records
 *
 * @param score Score value (number or Rank object)
 * @param criteria Competition criteria (determines formatting style)
 * @param metadata Optional metadata for additional context
 * @returns Formatted score string
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
      return formatRankScore(rankScore);
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

/**
 * Format a rank score (used for HIGHEST_RANK)
 * Example: "Diamond II (67 LP)"
 */
function formatRankScore(rank: Rank): string {
  return rankToString(rank);
}

/**
 * Format a wins score with optional win/loss record
 * Example: "12 wins (12-3, 80%)"
 */
function formatWinsScore(wins: number, metadata?: Record<string, unknown>): string {
  const baseText = `${wins.toString()} win${wins === 1 ? "" : "s"}`;

  // If we have games in metadata, show win/loss record
  if (!metadata) {
    return baseText;
  }

  const MetadataSchema = z.object({
    games: z.number().positive(),
  });

  const result = MetadataSchema.safeParse(metadata);
  if (result.success) {
    const games = result.data.games;
    const losses = games - wins;
    const winRate = (wins / games) * 100;
    return `${baseText} (${wins.toString()}-${losses.toString()}, ${winRate.toFixed(0)}%)`;
  }

  return baseText;
}

/**
 * Format a win rate score
 * Example: "75.0% (15-5)"
 */
function formatWinRateScore(winRate: number, metadata?: Record<string, unknown>): string {
  const rateText = `${winRate.toFixed(1)}%`;

  // If we have wins and games in metadata, show record
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

// ============================================================================
// Helper Functions - Status and Color
// ============================================================================

/**
 * Get Discord embed color for competition status
 */
function getStatusColor(status: CompetitionStatus): number {
  return STATUS_COLORS[status];
}

/**
 * Get status text with emoji and time information
 *
 * Examples:
 * - "🔵 Draft (starts in 7 days)"
 * - "🟢 Active (15 days remaining)"
 * - "🔴 Ended (Completed Dec 31, 2024)"
 */
function getStatusText(status: CompetitionStatus, competition: CompetitionWithCriteria): string {
  const emoji = STATUS_EMOJIS[status];
  const now = new Date();

  return match(status)
    .with("DRAFT", () => {
      if (competition.startDate) {
        const daysUntilStart = differenceInCalendarDays(competition.startDate, now);
        return `${emoji} Draft (starts in ${daysUntilStart.toString()} day${daysUntilStart === 1 ? "" : "s"})`;
      }
      return `${emoji} Draft`;
    })
    .with("ACTIVE", () => {
      if (competition.endDate) {
        const daysRemaining = differenceInCalendarDays(competition.endDate, now);
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
 * Returns medal emoji for top 3, empty string with spacing for others
 */
function getMedalEmoji(rank: number): string {
  if (rank === 1) {
    return MEDAL_EMOJIS[1];
  }
  if (rank === 2) {
    return MEDAL_EMOJIS[2];
  }
  if (rank === 3) {
    return MEDAL_EMOJIS[3];
  }
  return "  "; // Two spaces for alignment
}

// ============================================================================
// Helper Functions - Queue and Champion Formatting
// ============================================================================

/**
 * Format queue type to human-readable string
 */
function formatQueue(queue: CompetitionQueueType): string {
  return competitionQueueTypeToString(queue);
}

/**
 * Get champion name from ID with error handling
 * Falls back to "Champion {id}" if name not found
 */
function getChampionNameSafe(championId: number): string {
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
