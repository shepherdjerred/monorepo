import {
  type ChatInputCommandInteraction,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("commands-me");

export const meCommand = new SlashCommandBuilder()
  .setName("me")
  .setDescription("Look up player info and connected accounts")
  .setContexts(InteractionContextType.Guild)
  .addStringOption((option) =>
    option
      .setName("alias")
      .setDescription(
        "Player alias to look up (leave empty to look up your own account)",
      ),
  );

const ArgsSchema = z.object({
  alias: z.string().min(1).max(100).optional(),
  guildId: DiscordGuildIdSchema,
  userId: DiscordAccountIdSchema,
});

export async function executeMe(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const username = interaction.user.username;
  logger.info(`👤 Starting /me command for user ${username}`);

  const parseResult = ArgsSchema.safeParse({
    alias: interaction.options.getString("alias") ?? undefined,
    guildId: interaction.guildId,
    userId: interaction.user.id,
  });

  if (!parseResult.success) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const { alias, guildId, userId } = parseResult.data;

  await interaction.deferReply({ ephemeral: true });

  try {
    if (alias !== undefined) {
      // Look up by alias
      await lookupByAlias(interaction, guildId, alias);
    } else {
      // Look up caller's own linked player
      await lookupByDiscordId(interaction, guildId, userId);
    }
  } catch (error) {
    logger.error(`❌ Error in /me command:`, error);
    await interaction.editReply({
      content: `❌ **Error looking up player**\n\n${getErrorMessage(error)}`,
    });
  }
}

async function lookupByAlias(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  alias: string,
): Promise<void> {
  const player = await prisma.player.findUnique({
    where: {
      serverId_alias: {
        serverId: guildId,
        alias,
      },
    },
    include: {
      accounts: true,
      subscriptions: true,
      competitionParticipants: {
        include: {
          competition: true,
        },
      },
    },
  });

  if (!player) {
    await interaction.editReply({
      content: `❌ **Player not found**\n\nNo player with alias "${alias}" exists in this server.`,
    });
    return;
  }

  await interaction.editReply({
    content: formatPlayerInfo(player),
  });
}

async function lookupByDiscordId(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  userId: string,
): Promise<void> {
  const player = await prisma.player.findFirst({
    where: {
      serverId: guildId,
      discordId: userId,
    },
    include: {
      accounts: true,
      subscriptions: true,
      competitionParticipants: {
        include: {
          competition: true,
        },
      },
    },
  });

  if (!player) {
    await interaction.editReply({
      content:
        "ℹ️ **No linked account found**\n\nYou don't have a player account linked to your Discord profile in this server.\n\nAsk a server admin to link your account using `/admin player-link-discord`.",
    });
    return;
  }

  await interaction.editReply({
    content: formatPlayerInfo(player),
  });
}

type PlayerWithDetails = {
  alias: string;
  discordId: string | null;
  accounts: Array<{
    alias: string;
    region: string;
  }>;
  subscriptions: Array<{
    channelId: string;
  }>;
  competitionParticipants: Array<{
    status: string;
    competition: {
      title: string;
      isCancelled: boolean;
    };
  }>;
};

function formatPlayerInfo(player: PlayerWithDetails): string {
  const sections: string[] = [];

  // Header
  sections.push(`# 👤 ${player.alias}`);
  if (player.discordId) {
    sections.push(`**Discord:** <@${player.discordId}>`);
  }

  // Accounts
  sections.push(
    `\n## 🎮 Accounts (${player.accounts.length.toString()})`,
  );
  if (player.accounts.length > 0) {
    for (const account of player.accounts) {
      sections.push(`• **${account.alias}** (${account.region.toUpperCase()})`);
    }
  } else {
    sections.push("*No accounts linked*");
  }

  // Subscriptions
  sections.push(
    `\n## 🔔 Subscriptions (${player.subscriptions.length.toString()})`,
  );
  if (player.subscriptions.length > 0) {
    const channelList = player.subscriptions
      .map((sub) => `<#${sub.channelId}>`)
      .join(", ");
    sections.push(channelList);
  } else {
    sections.push("*No active subscriptions*");
  }

  // Active competitions
  const activeCompetitions = player.competitionParticipants.filter(
    (p) => !p.competition.isCancelled && p.status === "JOINED",
  );
  if (activeCompetitions.length > 0) {
    sections.push(
      `\n## 🏆 Competitions (${activeCompetitions.length.toString()})`,
    );
    for (const participant of activeCompetitions) {
      sections.push(`• ${participant.competition.title}`);
    }
  }

  return sections.join("\n");
}
