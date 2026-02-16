import type {
  CompetitionWithCriteria,
} from "@scout-for-lol/data";
import {
  getCompetitionStatus,
} from "@scout-for-lol/data";
import { EmbedBuilder } from "discord.js";
import { match } from "ts-pattern";
import type { RankedLeaderboardEntry } from "@scout-for-lol/backend/league/competition/leaderboard.ts";
import {
  formatCriteriaDescription,
  formatScore,
  getStatusColor,
  getStatusText,
  getMedalEmoji,
} from "@scout-for-lol/backend/discord/embeds/competition-format-helpers.ts";

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
 */
export function generateLeaderboardEmbed(
  competition: CompetitionWithCriteria,
  leaderboard: RankedLeaderboardEntry[],
  viewingUserId?: string,
): EmbedBuilder {
  const status = getCompetitionStatus(competition);
  const color = getStatusColor(status);

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${competition.title}`)
    .setColor(color);

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
  embed.addFields({
    name: "Owner",
    value: `<@${competition.ownerId}>`,
    inline: true,
  });

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
        const score = formatScore(
          entry.score,
          competition.criteria,
          entry.metadata,
        );
        const isViewingUser =
          viewingUserId && entry.discordId === viewingUserId;
        const baseText = `${medal} **${entry.rank.toString()}.** ${entry.playerName} - ${score}`;
        return isViewingUser ? `${baseText} 👤` : baseText;
      })
      .join("\n");

    embed.addFields({
      name: standingsTitle,
      value: leaderboardText,
      inline: false,
    });

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
    const userEntry = leaderboard.find(
      (entry) => entry.discordId === viewingUserId,
    );
    if (userEntry && userEntry.rank > 10) {
      const score = formatScore(
        userEntry.score,
        competition.criteria,
        userEntry.metadata,
      );
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
 */
export function generateCompetitionDetailsEmbed(
  competition: CompetitionWithCriteria,
): EmbedBuilder {
  const status = getCompetitionStatus(competition);
  const color = getStatusColor(status);

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${competition.title}`)
    .setColor(color);

  if (competition.description) {
    embed.setDescription(competition.description);
  }

  const statusText = getStatusText(status, competition);
  embed.addFields({ name: "Status", value: statusText, inline: true });

  embed.addFields({
    name: "Owner",
    value: `<@${competition.ownerId}>`,
    inline: true,
  });

  embed.addFields({
    name: "Channel",
    value: `<#${competition.channelId}>`,
    inline: true,
  });

  const visibilityText = match(competition.visibility)
    .with("OPEN", () => "Open to All")
    .with("INVITE_ONLY", () => "Invite Only")
    .with("SERVER_WIDE", () => "Server-Wide")
    .otherwise(() => competition.visibility);
  embed.addFields({ name: "Visibility", value: visibilityText, inline: true });

  embed.addFields({
    name: "Max Participants",
    value: competition.maxParticipants.toString(),
    inline: true,
  });

  const createdDate = competition.createdTime.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  embed.addFields({ name: "Created", value: createdDate, inline: true });

  embed.addFields({ name: "\u200B", value: "\u200B", inline: false });

  const criteriaDescription = formatCriteriaDescription(competition.criteria);
  embed.addFields({
    name: "📊 Ranking Criteria",
    value: criteriaDescription,
    inline: false,
  });

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

  embed.setFooter({ text: `Competition ID: ${competition.id.toString()}` });
  embed.setTimestamp(new Date());

  return embed;
}
