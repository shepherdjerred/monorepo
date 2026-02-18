import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index";
import type { DiscordGuildId } from "@scout-for-lol/data/index";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import {
  validateCommandArgs,
  executeWithTiming,
} from "@scout-for-lol/backend/discord/commands/admin/utils/validation.ts";
import { findPlayerByAliasWithCompetitions } from "@scout-for-lol/backend/discord/commands/admin/utils/player-queries.ts";
import type { PlayerWithCompetitions } from "@scout-for-lol/backend/discord/commands/admin/utils/player-queries.ts";
import { getLimit } from "@scout-for-lol/backend/configuration/flags.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("admin-player-view");

const ArgsSchema = z.object({
  alias: z.string().min(1).max(100),
  guildId: DiscordGuildIdSchema,
});

async function getRateLimitInfo(guildId: DiscordGuildId) {
  const accountLimitRaw = getLimit("accounts", { server: guildId });
  const accountLimit = accountLimitRaw === "unlimited" ? null : accountLimitRaw;
  const subscriptionLimitRaw = getLimit("player_subscriptions", {
    server: guildId,
  });
  const subscriptionLimit =
    subscriptionLimitRaw === "unlimited" ? null : subscriptionLimitRaw;

  const totalServerAccounts = await prisma.account.count({
    where: { serverId: guildId },
  });

  const totalServerPlayers = await prisma.player.count({
    where: {
      serverId: guildId,
      subscriptions: {
        some: {},
      },
    },
  });

  return {
    accountLimit,
    subscriptionLimit,
    totalServerAccounts,
    totalServerPlayers,
  };
}

function buildPlayerInfoSections(
  player: NonNullable<PlayerWithCompetitions>,
  rateLimits: Awaited<ReturnType<typeof getRateLimitInfo>>,
): string[] {
  const sections: string[] = [];
  const {
    accountLimit,
    subscriptionLimit,
    totalServerAccounts,
    totalServerPlayers,
  } = rateLimits;

  // Player Info Section
  sections.push(`# 👤 Player Info: ${player.alias}`);
  sections.push(`**ID:** ${player.id.toString()}`);
  sections.push(`**Discord ID:** ${player.discordId ?? "Not set"}`);
  sections.push(`**Server ID:** ${player.serverId}`);

  // Accounts Section
  sections.push(`\n## 🎮 Accounts (${player.accounts.length.toString()})`);
  if (player.accounts.length > 0) {
    for (const account of player.accounts) {
      const lastProcessed = account.lastProcessedMatchId
        ? `Last match: \`${account.lastProcessedMatchId}\``
        : "No matches processed yet";
      sections.push(`• **${account.alias}** (${account.region.toUpperCase()})`);
      sections.push(`  - PUUID: \`${account.puuid}\``);
      sections.push(`  - ${lastProcessed}`);
      sections.push(`  - ID: ${account.id.toString()}`);
    }
  } else {
    sections.push("*No accounts linked*");
  }

  // Rate Limiting Info Section
  sections.push(`\n## ⏱️ Server Rate Limits`);
  sections.push(
    `**Account Limit:** ${accountLimit === null ? `${totalServerAccounts.toString()} (unlimited)` : `${totalServerAccounts.toString()}/${accountLimit.toString()}`}`,
  );
  sections.push(
    `**Subscription Limit:** ${subscriptionLimit === null ? `${totalServerPlayers.toString()} players (unlimited)` : `${totalServerPlayers.toString()}/${subscriptionLimit.toString()} players`}`,
  );

  // Subscriptions Section
  sections.push(
    `\n## 🔔 Subscriptions (${player.subscriptions.length.toString()})`,
  );
  if (player.subscriptions.length > 0) {
    for (const sub of player.subscriptions) {
      sections.push(
        `• <#${sub.channelId}> - Created <t:${Math.floor(sub.createdTime.getTime() / 1000).toString()}:R> (ID: ${sub.id.toString()})`,
      );
    }
  } else {
    sections.push("*No active subscriptions*");
  }

  // Competitions Section
  const activeCompetitions = player.competitionParticipants.filter(
    (p) => !p.competition.isCancelled && p.status === "JOINED",
  );
  const invitedCompetitions = player.competitionParticipants.filter(
    (p) => !p.competition.isCancelled && p.status === "INVITED",
  );

  sections.push(`\n## 🏆 Competitions`);
  if (activeCompetitions.length > 0) {
    sections.push(`**Active (${activeCompetitions.length.toString()}):**`);
    for (const participant of activeCompetitions) {
      const comp = participant.competition;
      const joinedAt = participant.joinedAt
        ? `<t:${Math.floor(participant.joinedAt.getTime() / 1000).toString()}:R>`
        : "Unknown";
      sections.push(`• **${comp.title}** (ID: ${comp.id.toString()})`);
      sections.push(`  - Joined: ${joinedAt}`);
      sections.push(`  - Channel: <#${comp.channelId}>`);
    }
  }

  if (invitedCompetitions.length > 0) {
    sections.push(`**Invited (${invitedCompetitions.length.toString()}):**`);
    for (const participant of invitedCompetitions) {
      const comp = participant.competition;
      const invitedAt = participant.invitedAt
        ? `<t:${Math.floor(participant.invitedAt.getTime() / 1000).toString()}:R>`
        : "Unknown";
      sections.push(`• **${comp.title}** (ID: ${comp.id.toString()})`);
      sections.push(`  - Invited: ${invitedAt}`);
    }
  }

  if (activeCompetitions.length === 0 && invitedCompetitions.length === 0) {
    sections.push("*No active or pending competitions*");
  }

  // Debug Info Section
  sections.push(`\n## 🐛 Debug Info`);
  sections.push(
    `**Created:** <t:${Math.floor(player.createdTime.getTime() / 1000).toString()}:F>`,
  );
  sections.push(
    `**Updated:** <t:${Math.floor(player.updatedTime.getTime() / 1000).toString()}:F>`,
  );
  sections.push(`**Creator Discord ID:** ${player.creatorDiscordId}`);

  return sections;
}

async function sendPlayerInfo(
  interaction: ChatInputCommandInteraction,
  sections: string[],
): Promise<void> {
  const content = sections.join("\n");

  // Discord has a 2000 character limit for message content
  if (content.length > 2000) {
    // Split into multiple messages if needed
    const chunks: string[] = [];
    let currentChunk = "";

    for (const section of sections) {
      if (currentChunk.length + section.length + 1 > 1900) {
        chunks.push(currentChunk);
        currentChunk = section;
      } else {
        currentChunk += (currentChunk ? "\n" : "") + section;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    const firstChunk = chunks[0];
    if (firstChunk === undefined) {
      await interaction.reply({
        content: "❌ Error: No content to display",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: firstChunk,
      ephemeral: true,
    });

    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk !== undefined) {
        await interaction.followUp({
          content: chunk,
          ephemeral: true,
        });
      }
    }
  } else {
    await interaction.reply({
      content,
      ephemeral: true,
    });
  }
}

export async function executePlayerView(
  interaction: ChatInputCommandInteraction,
) {
  const validation = await validateCommandArgs(
    interaction,
    ArgsSchema,
    (i) => ({
      alias: i.options.getString("alias"),
      guildId: i.guildId,
    }),
    "player-view",
  );

  if (!validation.success) {
    return;
  }

  const { data: args, username } = validation;
  const { alias, guildId } = args;

  await executeWithTiming("player-view", username, async () => {
    const player = await findPlayerByAliasWithCompetitions(
      prisma,
      guildId,
      alias,
      interaction,
    );
    if (!player) {
      return;
    }

    logger.info(
      `✅ Player found: ${player.alias} (ID: ${player.id.toString()})`,
    );

    const rateLimits = await getRateLimitInfo(guildId);
    const sections = buildPlayerInfoSections(player, rateLimits);
    await sendPlayerInfo(interaction, sections);
  });
}
