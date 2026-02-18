import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  RegionSchema,
  RiotIdSchema,
} from "@scout-for-lol/data/index";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { fromError } from "zod-validation-error";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("subscription-add");
import {
  checkSubscriptionLimit,
  checkAccountLimit,
  resolveRiotIdToPuuid,
} from "@scout-for-lol/backend/discord/commands/subscription/add-helpers.ts";
import {
  buildSubscriptionResponse,
  createSubscriptionRecords,
  handleWelcomeMatch,
  validateSubscriptionArgs,
} from "@scout-for-lol/backend/discord/commands/subscription/add-helpers-internal.ts";

export const ArgsSchema = z.object({
  channel: DiscordChannelIdSchema,
  region: RegionSchema,
  riotId: RiotIdSchema,
  user: DiscordAccountIdSchema.optional(),
  alias: z.string(),
  guildId: DiscordGuildIdSchema,
});

export async function executeSubscriptionAdd(
  interaction: ChatInputCommandInteraction,
) {
  const startTime = Date.now();
  const userId = DiscordAccountIdSchema.parse(interaction.user.id);
  const username = interaction.user.username;

  logger.info(
    `🔔 Starting subscription process for user ${username} (${userId})`,
  );

  const args = validateSubscriptionArgs(interaction, ArgsSchema);
  if (!args) {
    const validationError = fromError(new Error("Invalid command arguments"));
    await interaction.reply({
      content: validationError.toString(),
      ephemeral: true,
    });
    return;
  }

  const { channel, region, riotId, user, alias, guildId } = args;

  // Defer reply immediately to avoid Discord's 3-second timeout
  // All subsequent responses must use editReply() instead of reply()
  await interaction.deferReply({ ephemeral: true });

  // Check if player already exists with this alias
  const existingPlayer = await prisma.player.findUnique({
    where: {
      serverId_alias: {
        serverId: guildId,
        alias: alias,
      },
    },
  });

  // Check subscription limit (only if creating a new player)
  const subscriptionLimitPassed = await checkSubscriptionLimit(
    interaction,
    guildId,
    existingPlayer,
  );
  if (!subscriptionLimitPassed) {
    return;
  }

  // Check account limit (always check, even for existing players)
  const accountLimitPassed = await checkAccountLimit(interaction, guildId);
  if (!accountLimitPassed) {
    return;
  }

  // Resolve Riot ID to PUUID
  const puuid = await resolveRiotIdToPuuid(interaction, riotId, region);
  if (puuid === undefined) {
    return;
  }

  // Check if this exact account already exists
  const existingAccount = await prisma.account.findUnique({
    where: {
      serverId_puuid: {
        serverId: guildId,
        puuid: puuid,
      },
    },
    include: {
      player: {
        include: {
          subscriptions: true,
        },
      },
    },
  });

  if (existingAccount) {
    logger.info(
      `⚠️  Account already exists: ${riotId.game_name}#${riotId.tag_line} (PUUID: ${puuid}) for player "${existingAccount.player.alias}"`,
    );

    const subscriptions = existingAccount.player.subscriptions;
    const channelList = subscriptions
      .map((sub) => `<#${sub.channelId}>`)
      .join(", ");

    await interaction.editReply({
      content: `ℹ️ **Account already subscribed**\n\nThe account **${riotId.game_name}#${riotId.tag_line}** is already subscribed as player "${existingAccount.player.alias}".\n\n${subscriptions.length > 0 ? `Currently posting to: ${channelList}` : "No active subscriptions."}`,
    });
    return;
  }

  const now = new Date();
  logger.info(`💾 Starting database operations for subscription`);

  const result = await createSubscriptionRecords({
    args,
    existingPlayer,
    puuid,
    userId,
    now,
  });

  if (!result.success) {
    if (
      result.error === "SUBSCRIPTION_EXISTS" &&
      result.playerAccount &&
      result.isAddingToExistingPlayer !== undefined
    ) {
      // Handle existing subscription case
      const playerAccount = await prisma.account.findUnique({
        where: {
          serverId_puuid: {
            serverId: guildId,
            puuid: puuid,
          },
        },
        include: {
          player: {
            include: {
              accounts: true,
              subscriptions: true,
            },
          },
        },
      });

      if (playerAccount) {
        if (result.isAddingToExistingPlayer) {
          const accountCount = playerAccount.player.accounts.length;
          const accountList = playerAccount.player.accounts
            .map((acc) => `• ${acc.alias} (${acc.region})`)
            .join("\n");

          await interaction.editReply({
            content: `✅ **Account added successfully**\n\nAdded **${riotId.game_name}#${riotId.tag_line}** to player "${playerAccount.player.alias}".\n\nThis player is already subscribed in <#${channel}> and now has ${accountCount.toString()} account${accountCount === 1 ? "" : "s"}:\n${accountList}\n\nMatch updates for all accounts will continue to be posted there.`,
          });
        } else {
          await interaction.editReply({
            content: `ℹ️ **Already subscribed**\n\nPlayer "${playerAccount.player.alias}" is already subscribed in <#${channel}>.\n\nMatch updates will continue to be posted there.`,
          });
        }
      }
    } else {
      await interaction.editReply({
        content: `Error creating database records: ${result.error}`,
      });
    }
    return;
  }

  const totalTime = Date.now() - startTime;
  logger.info(
    `🎉 Subscription completed successfully in ${totalTime.toString()}ms`,
  );

  const responseMessage = buildSubscriptionResponse({
    riotId,
    alias,
    isAddingToExistingPlayer: result.isAddingToExistingPlayer,
    playerAccount: result.playerAccount,
  });

  await interaction.editReply({
    content: responseMessage,
  });

  handleWelcomeMatch({
    interaction,
    isFirstSubscription: result.isFirstSubscription,
    riotId,
    alias,
    puuid,
    region,
    user,
  });
}
