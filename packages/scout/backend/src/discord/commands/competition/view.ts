import { type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { getCompetitionStatus } from "@shepherdjerred/scout-data";
import { match } from "ts-pattern";
import { z } from "zod";
import { prisma } from "@shepherdjerred/scout-backend/database/index.ts";
import { getParticipants } from "@shepherdjerred/scout-backend/database/competition/participants.ts";
import type { getCompetitionById } from "@shepherdjerred/scout-backend/database/competition/queries.ts";
import { formatScore } from "@shepherdjerred/scout-backend/discord/embeds/competition.ts";
import { loadCachedLeaderboard } from "@shepherdjerred/scout-backend/storage/s3-leaderboard.ts";
import { replyWithErrorFromException } from "@shepherdjerred/scout-backend/discord/commands/competition/utils/replies.ts";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";

const logger = createLogger("competition-view");
import {
  extractCompetitionId,
  fetchCompetitionWithErrorHandling,
} from "@shepherdjerred/scout-backend/discord/commands/competition/utils/command-helpers.ts";

// ============================================================================
// Utility functions
// ============================================================================

function daysUntil(date: Date, from: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((date.getTime() - from.getTime()) / msPerDay);
}

function formatHumanDateTime(date: Date): string {
  return `${(date.getMonth() + 1).toString()}/${date.getDate().toString()}/${date.getFullYear().toString()} ${date.getHours().toString()}:${String(date.getMinutes()).padStart(2, "0")} ${date.getHours() >= 12 ? "PM" : "AM"}`;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return `${diffSecs.toString()}s ago`;
  }
  if (diffMins < 60) {
    return `${diffMins.toString()}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours.toString()}h ago`;
  }
  return `${diffDays.toString()}d ago`;
}

// Schema for participant with player relation (when includePlayer=true)
const ParticipantWithPlayerSchema = z.object({
  player: z.object({
    discordId: z.string(),
  }),
});

/**
 * Execute /competition view command
 * Shows detailed competition information and leaderboard
 */
export async function executeCompetitionView(interaction: ChatInputCommandInteraction): Promise<void> {
  // ============================================================================
  // Step 1: Extract and validate input
  // ============================================================================

  const competitionId = extractCompetitionId(interaction);

  // ============================================================================
  // Step 2: Fetch competition
  // ============================================================================

  const competition = await fetchCompetitionWithErrorHandling(interaction, competitionId, "Competition View");
  if (!competition) {
    return;
  }

  // ============================================================================
  // Step 3: Calculate status and fetch participants
  // ============================================================================

  const status = getCompetitionStatus(competition);

  let participants;
  try {
    participants = await getParticipants(prisma, competitionId, "JOINED", true);
  } catch (error) {
    logger.error(`[Competition View] Error fetching participants:`, error);
    await replyWithErrorFromException(interaction, error, "fetching participants");
    return;
  }

  // ============================================================================
  // Step 4: Build embed
  // ============================================================================

  const embed = await buildCompetitionEmbed(competition, status, participants);

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

/**
 * Build Discord embed for competition view
 */
async function buildCompetitionEmbed(
  competition: Awaited<ReturnType<typeof getCompetitionById>>,
  status: ReturnType<typeof getCompetitionStatus>,
  participants: Awaited<ReturnType<typeof getParticipants>>,
): Promise<EmbedBuilder> {
  if (!competition) {
    throw new Error("Competition cannot be null");
  }

  const embed = new EmbedBuilder().setTitle(`🏆 ${competition.title}`).setDescription(competition.description);

  // Set color based on status
  const color = match(status)
    .with("DRAFT", () => 0x5865f2) // Blue
    .with("ACTIVE", () => 0x57f287) // Green
    .with("ENDED", () => 0xeb459e) // Pink
    .with("CANCELLED", () => 0xed4245) // Red
    .exhaustive();

  embed.setColor(color);

  // Add status field with emoji and details
  const statusText = getStatusText(status, competition);
  embed.addFields({ name: "Status", value: statusText, inline: true });

  // Add participants count
  const participantCount = participants.length;
  embed.addFields({
    name: "Participants",
    value: `${participantCount.toString()}/${competition.maxParticipants.toString()}`,
    inline: true,
  });

  // Add owner
  embed.addFields({ name: "Owner", value: `<@${competition.ownerId}>`, inline: true });

  // Add channel
  embed.addFields({ name: "Channel", value: `<#${competition.channelId}>`, inline: true });

  // Add visibility
  const visibilityText = match(competition.visibility)
    .with("OPEN", () => "Open to All")
    .with("INVITE_ONLY", () => "Invite Only")
    .with("SERVER_WIDE", () => "Server-Wide")
    .otherwise(() => competition.visibility);

  embed.addFields({ name: "Visibility", value: visibilityText, inline: true });

  // Add blank field for spacing (creates new row)
  embed.addFields({ name: "\u200B", value: "\u200B", inline: false });

  // Add leaderboard or participant list based on status
  await match(status)
    .with("DRAFT", () => {
      addParticipantList(embed, participants);
    })
    .with("ACTIVE", "ENDED", "CANCELLED", async () => {
      // For ACTIVE, ENDED, or CANCELLED - calculate and show leaderboard
      await addLeaderboard(embed, status, competition);
    })
    .exhaustive();

  // Add footer with criteria description
  const criteriaDescription = getCriteriaDescription(competition.criteria);
  embed.setFooter({ text: `${criteriaDescription} • Competition ID: ${competition.id.toString()}` });
  embed.setTimestamp(new Date());

  return embed;
}

/**
 * Get status text with emoji and time information
 */
function getStatusText(
  status: ReturnType<typeof getCompetitionStatus>,
  competition: NonNullable<Awaited<ReturnType<typeof getCompetitionById>>>,
): string {
  const now = new Date();

  return match(status)
    .with("DRAFT", () => {
      if (competition.startDate) {
        const daysUntilStart = daysUntil(competition.startDate, now);
        return `🔵 Draft (starts in ${daysUntilStart.toString()} day${daysUntilStart === 1 ? "" : "s"})`;
      }
      return "🔵 Draft";
    })
    .with("ACTIVE", () => {
      if (competition.endDate) {
        const daysRemaining = daysUntil(competition.endDate, now);
        return `🟢 Active (${daysRemaining.toString()} day${daysRemaining === 1 ? "" : "s"} remaining)`;
      }
      return "🟢 Active";
    })
    .with("ENDED", () => {
      if (competition.endDate) {
        const dateStr = formatHumanDateTime(competition.endDate).split(" ")[0] ?? "";
        return `🔴 Ended (Completed ${dateStr})`;
      }
      return "🔴 Ended";
    })
    .with("CANCELLED", () => "⚫ Cancelled")
    .exhaustive();
}

/**
 * Add participant list to embed (for DRAFT status)
 */
function addParticipantList(embed: EmbedBuilder, participants: Awaited<ReturnType<typeof getParticipants>>): void {
  embed.addFields({ name: "👥 Participants", value: "━━━━━━━━━━━━━━━━━━━━━", inline: false });

  if (participants.length === 0) {
    embed.addFields({ name: "\u200B", value: "No participants yet.", inline: false });
    return;
  }

  // Show participant list with their Discord usernames
  // When includePlayer=true is passed to getParticipants, each participant includes player relation
  const participantList = participants
    .map((p) => {
      // Validate if player relation exists using Zod schema
      const result = ParticipantWithPlayerSchema.safeParse(p);
      if (result.success) {
        return `• <@${result.data.player.discordId}>`;
      }
      return `• Player ID: ${p.playerId.toString()}`;
    })
    .join("\n");

  embed.addFields({ name: "\u200B", value: participantList, inline: false });

  // Add note about leaderboard availability
  embed.addFields({ name: "📊 Leaderboard", value: "━━━━━━━━━━━━━━━━━━━━━", inline: false });
  embed.addFields({
    name: "\u200B",
    value: "Leaderboard will be available when the competition starts.",
    inline: false,
  });
}

/**
 * Add leaderboard standings to embed
 * Loads from S3 cache if available, otherwise shows message that leaderboard is not yet available
 */
async function addLeaderboard(
  embed: EmbedBuilder,
  status: ReturnType<typeof getCompetitionStatus>,
  competition: NonNullable<Awaited<ReturnType<typeof getCompetitionById>>>,
): Promise<void> {
  const title = match(status)
    .with("ACTIVE", () => "📊 Current Standings")
    .with("ENDED", () => "🎉 Final Standings")
    .with("CANCELLED", () => "📊 Standings (at cancellation)")
    .otherwise(() => "📊 Leaderboard");

  embed.addFields({ name: title, value: "━━━━━━━━━━━━━━━━━━━━━", inline: false });

  // Try to load from cache
  logger.info(`[Competition View] Attempting to load cached leaderboard for competition ${competition.id.toString()}`);
  const cached = await loadCachedLeaderboard(competition.id);

  if (!cached) {
    logger.info(`[Competition View] No cached leaderboard found for competition ${competition.id.toString()}`);
    embed.addFields({
      name: "\u200B",
      value:
        "Leaderboard not yet available. The leaderboard is updated daily at midnight UTC. Check back after the next update!",
      inline: false,
    });
    return;
  }

  logger.info(`[Competition View] Using cached leaderboard from ${cached.calculatedAt}`);

  // Map cached entries to RankedLeaderboardEntry type to ensure type compatibility
  const leaderboard = cached.entries.map((entry) => ({
    playerId: entry.playerId,
    playerName: entry.playerName,
    score: entry.score,
    rank: entry.rank,
    ...(entry.metadata !== undefined && { metadata: entry.metadata }),
  }));
  const cachedAt = new Date(cached.calculatedAt);

  // Display leaderboard entries
  if (leaderboard.length === 0) {
    embed.addFields({
      name: "\u200B",
      value: "No participants have scores yet. Play some games to appear on the leaderboard!",
      inline: false,
    });
    return;
  }

  // Show top 10 entries
  const top10 = leaderboard.slice(0, 10);
  const leaderboardText = top10
    .map((entry) => {
      const medal = getMedalEmoji(entry.rank);
      const score = formatScore(entry.score, competition.criteria, entry.metadata);
      return `${medal} **${entry.rank.toString()}.** ${entry.playerName} - ${score}`;
    })
    .join("\n");

  embed.addFields({
    name: "\u200B",
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

  // Add cache timestamp
  const ageText = formatTimeAgo(cachedAt);
  const dateStr = formatHumanDateTime(cachedAt);

  embed.addFields({
    name: "\u200B",
    value: `_Last updated: ${dateStr} (${ageText})_`,
    inline: false,
  });
}

/**
 * Get medal emoji for rank position
 * Returns medal emoji for top 3, empty string with spacing for others
 */
function getMedalEmoji(rank: number): string {
  if (rank === 1) {
    return "🥇";
  }
  if (rank === 2) {
    return "🥈";
  }
  if (rank === 3) {
    return "🥉";
  }
  return "  "; // Two spaces for alignment
}

/**
 * Get human-readable description of criteria
 */
function getCriteriaDescription(
  criteria: NonNullable<Awaited<ReturnType<typeof getCompetitionById>>>["criteria"],
): string {
  return match(criteria)
    .with({ type: "MOST_GAMES_PLAYED" }, (c) => {
      const queue = formatQueueType(c.queue);
      return `Most games played in ${queue}`;
    })
    .with({ type: "HIGHEST_RANK" }, (c) => {
      const queue = c.queue === "SOLO" ? "Solo Queue" : "Flex Queue";
      return `Highest rank in ${queue}`;
    })
    .with({ type: "MOST_RANK_CLIMB" }, (c) => {
      const queue = c.queue === "SOLO" ? "Solo Queue" : "Flex Queue";
      return `Most rank climb in ${queue}`;
    })
    .with({ type: "MOST_WINS_PLAYER" }, (c) => {
      const queue = formatQueueType(c.queue);
      return `Most wins in ${queue}`;
    })
    .with({ type: "MOST_WINS_CHAMPION" }, (c) => {
      const queue = c.queue ? ` in ${formatQueueType(c.queue)}` : "";
      return `Most wins with Champion ${c.championId.toString()}${queue}`;
    })
    .with({ type: "HIGHEST_WIN_RATE" }, (c) => {
      const queue = formatQueueType(c.queue);
      return `Highest win rate in ${queue} (min ${c.minGames.toString()} games)`;
    })
    .exhaustive();
}

/**
 * Format queue type to human-readable string
 */
function formatQueueType(queue: string): string {
  return match(queue)
    .with("SOLO", () => "Solo Queue")
    .with("FLEX", () => "Flex Queue")
    .with("RANKED_ANY", () => "Ranked (Any)")
    .with("ARENA", () => "Arena")
    .with("ARAM", () => "ARAM")
    .with("ALL", () => "All Queues")
    .otherwise(() => queue);
}
