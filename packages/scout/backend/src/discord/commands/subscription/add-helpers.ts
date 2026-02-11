import { type ChatInputCommandInteraction } from "discord.js";
import { type DiscordGuildId, type Region, type RiotId } from "@shepherdjerred/scout-data/index";
import { riotApi } from "@shepherdjerred/scout-backend/league/api/api.ts";
import { mapRegionToEnum } from "@shepherdjerred/scout-backend/league/model/region.ts";
import { regionToRegionGroupForAccountAPI } from "twisted/dist/constants/regions.js";
import { prisma } from "@shepherdjerred/scout-backend/database/index.ts";
import { getLimit } from "@shepherdjerred/scout-backend/configuration/flags.ts";
import {
  DISCORD_SERVER_INVITE,
  LIMIT_WARNING_THRESHOLD,
} from "@shepherdjerred/scout-backend/configuration/subscription-limits.ts";
import { getErrorMessage } from "@shepherdjerred/scout-backend/utils/errors.ts";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";
import { withTimeout } from "@shepherdjerred/scout-backend/utils/timeout.ts";

const logger = createLogger("subscription-add-helpers");

/**
 * Check subscription limit for a server
 * Returns true if limit check passed, false if limit reached
 */
export async function checkSubscriptionLimit(
  interaction: ChatInputCommandInteraction,
  guildId: DiscordGuildId,
  existingPlayer: { id: number } | null,
): Promise<boolean> {
  // Check subscription limit (only if creating a new player)
  if (existingPlayer) {
    logger.info(`📌 Adding account to existing player (ID: ${existingPlayer.id.toString()}) - no limit check needed`);
    return true;
  }

  const subscriptionLimit = getLimit("player_subscriptions", { server: guildId });
  const isUnlimited = subscriptionLimit === "unlimited";

  if (!isUnlimited) {
    logger.info(`🔍 Checking subscription limit for server ${guildId}: ${subscriptionLimit.toString()} players`);

    // Count unique players with subscriptions in this server
    const subscribedPlayerCount = await prisma.player.count({
      where: {
        serverId: guildId,
        subscriptions: {
          some: {},
        },
      },
    });

    logger.info(`📊 Current subscribed players: ${subscribedPlayerCount.toString()}/${subscriptionLimit.toString()}`);

    if (subscribedPlayerCount >= subscriptionLimit) {
      logger.info(
        `❌ Subscription limit reached for server ${guildId} (${subscribedPlayerCount.toString()}/${subscriptionLimit.toString()})`,
      );

      await interaction.editReply({
        content: `❌ **Subscription limit reached**\n\nThis server can subscribe to a maximum of ${subscriptionLimit.toString()} players. You currently have ${subscribedPlayerCount.toString()} subscribed players.\n\nTo subscribe to a new player, please unsubscribe from an existing player first using \`/subscription delete\`.\n\nIf you need more subscriptions, please contact us: ${DISCORD_SERVER_INVITE}`,
      });
      return false;
    }

    // Warn if approaching limit (threshold or fewer slots remaining)
    const remainingSlots = subscriptionLimit - subscribedPlayerCount - 1;
    if (remainingSlots <= LIMIT_WARNING_THRESHOLD && remainingSlots > 0) {
      await interaction.followUp({
        content: `⚠️  **Approaching subscription limit**\n\nYou will have ${remainingSlots.toString()} subscription slot${remainingSlots === 1 ? "" : "s"} remaining after this addition.\n\nIf you need more subscriptions, please contact us: ${DISCORD_SERVER_INVITE}`,
        ephemeral: true,
      });
    }
  } else {
    logger.info(`♾️ Server ${guildId} has unlimited subscriptions`);
  }

  return true;
}

/**
 * Check account limit for a server
 * Returns true if limit check passed, false if limit reached
 */
export async function checkAccountLimit(
  interaction: ChatInputCommandInteraction,
  guildId: DiscordGuildId,
): Promise<boolean> {
  const accountLimit = getLimit("accounts", { server: guildId });
  const isUnlimitedAccounts = accountLimit === "unlimited";

  if (!isUnlimitedAccounts) {
    logger.info(`🔍 Checking account limit for server ${guildId}: ${accountLimit.toString()} accounts`);

    // Count all accounts in this server
    const accountCount = await prisma.account.count({
      where: {
        serverId: guildId,
      },
    });

    logger.info(`📊 Current accounts: ${accountCount.toString()}/${accountLimit.toString()}`);

    if (accountCount >= accountLimit) {
      logger.info(
        `❌ Account limit reached for server ${guildId} (${accountCount.toString()}/${accountLimit.toString()})`,
      );

      await interaction.editReply({
        content: `❌ **Account limit reached**\n\nThis server can have a maximum of ${accountLimit.toString()} accounts. You currently have ${accountCount.toString()} accounts.\n\nTo add a new account, please remove an existing account first.\n\nIf you need more accounts, please contact us: ${DISCORD_SERVER_INVITE}`,
      });
      return false;
    }

    // Warn if approaching limit (threshold or fewer slots remaining)
    const remainingAccountSlots = accountLimit - accountCount - 1;
    if (remainingAccountSlots <= LIMIT_WARNING_THRESHOLD && remainingAccountSlots > 0) {
      await interaction.followUp({
        content: `⚠️  **Approaching account limit**\n\nYou will have ${remainingAccountSlots.toString()} account slot${remainingAccountSlots === 1 ? "" : "s"} remaining after this addition.\n\nIf you need more accounts, please contact us: ${DISCORD_SERVER_INVITE}`,
        ephemeral: true,
      });
    }
  } else {
    logger.info(`♾️ Server ${guildId} has unlimited accounts`);
  }

  return true;
}

/**
 * Resolve Riot ID to PUUID
 * Returns PUUID or null if resolution failed
 */
export async function resolveRiotIdToPuuid(
  interaction: ChatInputCommandInteraction,
  riotId: RiotId,
  region: Region,
): Promise<string | null> {
  logger.info(`🔍 Looking up Riot ID: ${riotId.game_name}#${riotId.tag_line} in region ${region}`);

  try {
    const apiStartTime = Date.now();
    const regionGroup = regionToRegionGroupForAccountAPI(mapRegionToEnum(region));

    logger.info(`🌐 Using region group: ${regionGroup}`);

    const account = await withTimeout(riotApi.Account.getByRiotId(riotId.game_name, riotId.tag_line, regionGroup));

    const apiTime = Date.now() - apiStartTime;
    const puuid = account.response.puuid;

    logger.info(`✅ Successfully resolved Riot ID to PUUID: ${puuid} (${apiTime.toString()}ms)`);
    return puuid;
  } catch (error) {
    logger.error(`❌ Failed to resolve Riot ID ${riotId.game_name}#${riotId.tag_line}:`, error);
    await interaction.editReply({
      content: `Error looking up Riot ID: ${getErrorMessage(error)}`,
    });
    return null;
  }
}
