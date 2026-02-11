import type { ChatInputCommandInteraction } from "discord.js";
import { DiscordAccountIdSchema, LeaguePuuidSchema, RegionSchema, type RiotId } from "@shepherdjerred/scout-data/index";
import { prisma } from "@shepherdjerred/scout-backend/database/index.ts";
import { getErrorMessage } from "@shepherdjerred/scout-backend/utils/errors.ts";
import { backfillLastMatchTime } from "@shepherdjerred/scout-backend/league/api/backfill-match-history.ts";
import { sendWelcomeMatch } from "@shepherdjerred/scout-backend/discord/commands/subscription/welcome-match.ts";
import type { ArgsSchema } from "./add.ts";
import type { z } from "zod";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";

const logger = createLogger("subscription-add-helpers-internal");

type ArgsType = z.infer<typeof ArgsSchema>;

export function validateSubscriptionArgs(
  interaction: ChatInputCommandInteraction,
  schema: typeof ArgsSchema,
): ArgsType | null {
  const username = interaction.user.username;

  try {
    const args = schema.parse({
      channel: interaction.options.getChannel("channel")?.id,
      region: interaction.options.getString("region"),
      riotId: interaction.options.getString("riot-id"),
      user: interaction.options.getUser("user")?.id,
      alias: interaction.options.getString("alias"),
      guildId: interaction.guildId,
    });

    logger.info(`✅ Command arguments validated successfully`);
    logger.info(
      `📋 Args: channel=${args.channel}, region=${args.region}, riotId=${args.riotId.game_name}#${args.riotId.tag_line}, alias=${args.alias}`,
    );

    return args;
  } catch (error) {
    logger.error(`❌ Invalid command arguments from ${username}:`, error);
    return null;
  }
}

export async function createSubscriptionRecords(params: {
  args: ArgsType;
  existingPlayer: { id: number } | null;
  puuid: string;
  userId: string;
  now: Date;
}): Promise<
  | {
      success: true;
      subscription: { id: number };
      playerAccount: {
        player: {
          id: number;
          alias: string;
          accounts: { alias: string; region: string }[];
        };
      };
      isAddingToExistingPlayer: boolean;
      isFirstSubscription: boolean;
    }
  | {
      success: false;
      error: string;
      playerAccount?: {
        player: {
          id: number;
          alias: string;
          accounts: { alias: string; region: string }[];
        };
      };
      isAddingToExistingPlayer?: boolean;
    }
> {
  const { args, existingPlayer, puuid, userId, now } = params;
  const { channel, region, user, alias, guildId } = args;

  try {
    const dbStartTime = Date.now();
    const isAddingToExistingPlayer = existingPlayer !== null;

    // add a new account
    logger.info(`📝 Creating account record for ${alias}`);
    const account = await prisma.account.create({
      data: {
        alias: alias,
        puuid: LeaguePuuidSchema.parse(puuid),
        region: region,
        serverId: guildId,
        creatorDiscordId: DiscordAccountIdSchema.parse(userId),
        player: {
          connectOrCreate: {
            where: {
              serverId_alias: {
                serverId: guildId,
                alias: alias,
              },
            },
            create: {
              alias: alias,
              discordId: user ?? null,
              createdTime: now,
              updatedTime: now,
              creatorDiscordId: DiscordAccountIdSchema.parse(userId),
              serverId: guildId,
            },
          },
        },
        createdTime: now,
        updatedTime: now,
      },
    });

    logger.info(`✅ Account created with ID: ${account.id.toString()}`);

    // Backfill match history to initialize lastMatchTime
    const playerConfigEntry = {
      alias: alias,
      league: {
        leagueAccount: {
          puuid: LeaguePuuidSchema.parse(puuid),
          region: region,
        },
      },
      discordAccount: {
        id: user ?? undefined,
      },
    };

    await backfillLastMatchTime(playerConfigEntry, LeaguePuuidSchema.parse(puuid));

    // get the player for the account
    const playerAccount = await prisma.account.findUnique({
      where: {
        id: account.id,
      },
      include: {
        player: {
          include: {
            accounts: true,
          },
        },
      },
    });

    if (!playerAccount) {
      logger.error(`❌ Failed to find player for account ID: ${account.id.toString()}`);
      return { success: false, error: "Error finding player for account" };
    }

    logger.info(`📝 Found player record: ${playerAccount.player.alias} (ID: ${playerAccount.player.id.toString()})`);

    // Check if subscription already exists for this player in this channel
    const existingSubscription = await prisma.subscription.findUnique({
      where: {
        serverId_playerId_channelId: {
          serverId: guildId,
          playerId: playerAccount.player.id,
          channelId: channel,
        },
      },
    });

    if (existingSubscription) {
      logger.info(`⚠️  Subscription already exists for player ${playerAccount.player.alias} in channel ${channel}`);
      return {
        success: false,
        error: "SUBSCRIPTION_EXISTS",
        playerAccount,
        isAddingToExistingPlayer,
      };
    }

    // Check if this is the first subscription for the server
    const existingSubscriptionCount = await prisma.subscription.count({
      where: {
        serverId: guildId,
      },
    });
    const isFirstSubscription = existingSubscriptionCount === 0;

    if (isFirstSubscription) {
      logger.info(`🎉 This is the first subscription for server ${guildId}`);
    }

    // create a new subscription
    logger.info(`📝 Creating subscription for channel ${channel}`);
    const subscription = await prisma.subscription.create({
      data: {
        channelId: channel,
        playerId: playerAccount.player.id,
        createdTime: now,
        updatedTime: now,
        creatorDiscordId: DiscordAccountIdSchema.parse(userId),
        serverId: guildId,
      },
    });

    const dbTime = Date.now() - dbStartTime;
    logger.info(`✅ Subscription created with ID: ${subscription.id.toString()} (${dbTime.toString()}ms)`);

    return {
      success: true,
      subscription,
      playerAccount,
      isAddingToExistingPlayer,
      isFirstSubscription,
    };
  } catch (error) {
    logger.error(`❌ Database error during subscription:`, error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export function buildSubscriptionResponse(params: {
  riotId: RiotId;
  alias: string;
  isAddingToExistingPlayer: boolean;
  playerAccount: {
    player: {
      accounts: { alias: string; region: string }[];
    };
  };
}): string {
  const { riotId, alias, isAddingToExistingPlayer, playerAccount } = params;

  let responseMessage = `Successfully subscribed to updates for ${riotId.game_name}#${riotId.tag_line}`;

  if (isAddingToExistingPlayer) {
    const accountCount = playerAccount.player.accounts.length;
    const accountList = playerAccount.player.accounts.map((acc) => `• ${acc.alias} (${acc.region})`).join("\n");
    responseMessage += `\n\n✨ **Added to existing player "${alias}"**`;
    responseMessage += `\nThis player now has ${accountCount.toString()} account${accountCount === 1 ? "" : "s"}:\n${accountList}`;
  } else {
    responseMessage += `\n\n✅ Created new player profile for "${alias}"`;
  }

  return responseMessage;
}

export function handleWelcomeMatch(params: {
  interaction: ChatInputCommandInteraction;
  isFirstSubscription: boolean;
  riotId: RiotId;
  alias: string;
  puuid: string;
  region: string;
  user: string | undefined;
}): void {
  const { interaction, isFirstSubscription, riotId, alias, puuid, region, user } = params;

  if (!isFirstSubscription) {
    return;
  }

  logger.info(`🎁 Triggering welcome match for ${riotId.game_name}#${riotId.tag_line}`);

  const playerConfigEntry = {
    alias: alias,
    league: {
      leagueAccount: {
        puuid: LeaguePuuidSchema.parse(puuid),
        region: RegionSchema.parse(region),
      },
    },
    ...(user && { discordAccount: { id: DiscordAccountIdSchema.parse(user) } }),
  };

  // Fire off async task to send welcome match
  void (async () => {
    try {
      await sendWelcomeMatch(interaction, playerConfigEntry);
    } catch (error) {
      logger.error(`❌ Error sending welcome match:`, error);
      // Don't throw - this is a background task
    }
  })();
}
