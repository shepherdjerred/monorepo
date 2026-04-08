import {
  type ChatInputCommandInteraction,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
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

const playerInclude = {
  accounts: true,
  subscriptions: true,
  competitionParticipants: {
    include: {
      competition: true,
    },
  },
} as const;

type PlayerQueryResult = NonNullable<
  Awaited<
    ReturnType<
      typeof prisma.player.findFirst<{ include: typeof playerInclude }>
    >
  >
>;

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
    await (alias === undefined
      ? lookupByDiscordId(interaction, guildId, userId)
      : lookupByAlias(interaction, guildId, alias));
  } catch (error) {
    logger.error(`❌ Error in /me command:`, error);
    await interaction.editReply({
      content: `❌ **Error looking up player**\n\n${getErrorMessage(error)}`,
    });
  }
}

async function lookupByAlias(
  interaction: ChatInputCommandInteraction,
  guildId: DiscordGuildId,
  alias: string,
): Promise<void> {
  const player = await prisma.player.findUnique({
    where: {
      serverId_alias: {
        serverId: guildId,
        alias,
      },
    },
    include: playerInclude,
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
  guildId: DiscordGuildId,
  userId: DiscordAccountId,
): Promise<void> {
  const player = await prisma.player.findFirst({
    where: {
      serverId: guildId,
      discordId: userId,
    },
    include: playerInclude,
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

function formatPlayerInfo(player: PlayerQueryResult): string {
  const sections: string[] = [];

  // Header
  sections.push(`# 👤 ${player.alias}`);
  if (player.discordId) {
    sections.push(`**Discord:** <@${player.discordId}>`);
  }

  // Accounts
  sections.push(`\n## 🎮 Accounts (${player.accounts.length.toString()})`);
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
