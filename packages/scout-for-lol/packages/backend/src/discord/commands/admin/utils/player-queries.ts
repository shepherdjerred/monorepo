import type { PrismaClient, Prisma } from "@scout-for-lol/backend/generated/prisma/client/index.js";
import { type ChatInputCommandInteraction } from "discord.js";
import { type DiscordGuildId } from "@scout-for-lol/data";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("utils-player-queries");

export type PlayerWithAccounts = Awaited<ReturnType<typeof findPlayerByAliasWithAccounts>>;
export type PlayerWithSubscriptions = Awaited<ReturnType<typeof findPlayerByAliasWithSubscriptions>>;
export type PlayerWithCompetitions = Awaited<ReturnType<typeof findPlayerByAliasWithCompetitions>>;

/**
 * Build options object, conditionally including interaction if defined
 */
function buildFindPlayerOptions<T extends Prisma.PlayerInclude>(options: {
  prisma: PrismaClient;
  serverId: DiscordGuildId;
  alias: string;
  include: T;
  interaction?: ChatInputCommandInteraction;
}): {
  prisma: PrismaClient;
  serverId: DiscordGuildId;
  alias: string;
  include: T;
  interaction?: ChatInputCommandInteraction;
} {
  const { prisma, serverId, alias, include, interaction } = options;
  if (interaction) {
    return { prisma, serverId, alias, include, interaction };
  }
  return { prisma, serverId, alias, include };
}

/**
 * Generic helper to find a player by alias with configurable includes
 */
async function findPlayerByAliasGeneric<T extends Prisma.PlayerInclude>(options: {
  prisma: PrismaClient;
  serverId: DiscordGuildId;
  alias: string;
  include: T;
  interaction?: ChatInputCommandInteraction;
}): Promise<Prisma.PlayerGetPayload<{ include: T }> | null> {
  const { prisma, serverId, alias, include, interaction } = options;
  const player = await prisma.player.findUnique({
    where: {
      serverId_alias: {
        serverId,
        alias,
      },
    },
    include,
  });

  if (!player && interaction) {
    logger.info(`❌ Player not found: "${alias}"`);
    await interaction.reply({
      content: `❌ **Player not found**\n\nNo player with alias "${alias}" exists in this server.`,
      ephemeral: true,
    });
  }

  return player;
}

/**
 * Find a player by alias with accounts included
 */
export async function findPlayerByAliasWithAccounts(
  prisma: PrismaClient,
  serverId: DiscordGuildId,
  alias: string,
  interaction?: ChatInputCommandInteraction,
) {
  return findPlayerByAliasGeneric(
    buildFindPlayerOptions({
      prisma,
      serverId,
      alias,
      include: { accounts: true },
      ...(interaction && { interaction }),
    }),
  );
}

/**
 * Find a player by alias with subscriptions included
 */
export async function findPlayerByAliasWithSubscriptions(
  prisma: PrismaClient,
  serverId: DiscordGuildId,
  alias: string,
  interaction?: ChatInputCommandInteraction,
) {
  return findPlayerByAliasGeneric(
    buildFindPlayerOptions({
      prisma,
      serverId,
      alias,
      include: { accounts: true, subscriptions: true },
      ...(interaction && { interaction }),
    }),
  );
}

/**
 * Find a player by alias with competition participants included
 */
export async function findPlayerByAliasWithCompetitions(
  prisma: PrismaClient,
  serverId: DiscordGuildId,
  alias: string,
  interaction?: ChatInputCommandInteraction,
) {
  return findPlayerByAliasGeneric(
    buildFindPlayerOptions({
      prisma,
      serverId,
      alias,
      include: {
        accounts: true,
        subscriptions: true,
        competitionParticipants: {
          include: {
            competition: true,
          },
        },
      },
      ...(interaction && { interaction }),
    }),
  );
}
