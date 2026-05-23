import {
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
} from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import { backfillLastMatchTime } from "#src/league/api/backfill-match-history.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import type {
  AddSubscriptionInput,
  AddSubscriptionResult,
} from "#src/lib/subscription/types.ts";
import { resolveRiotIdToPuuid } from "#src/lib/subscription/resolve.ts";
import { checkSubscriptionAndAccountLimits } from "#src/lib/subscription/limits.ts";

const logger = createLogger("subscription-add");

export async function addSubscription(
  input: AddSubscriptionInput,
): Promise<AddSubscriptionResult> {
  const {
    guildId,
    channelId,
    region,
    riotId,
    alias,
    discordUserId,
    creatorDiscordId,
  } = input;

  const existingPlayer = await prisma.player.findUnique({
    where: { serverId_alias: { serverId: guildId, alias } },
  });

  const limits = await checkSubscriptionAndAccountLimits({
    guildId,
    isAddingToExistingPlayer: existingPlayer !== null,
  });
  if (limits.kind !== "ok") {
    return limits;
  }

  const resolved = await resolveRiotIdToPuuid(riotId, region);
  if (resolved.kind !== "ok") {
    return { kind: "riot-id-not-found", message: resolved.message };
  }
  const puuid = LeaguePuuidSchema.parse(resolved.puuid);

  const existingAccount = await prisma.account.findUnique({
    where: { serverId_puuid: { serverId: guildId, puuid } },
    include: { player: { include: { subscriptions: true } } },
  });

  if (existingAccount) {
    logger.info(
      `⚠️  Account already exists for "${existingAccount.player.alias}"`,
    );
    return {
      kind: "account-already-subscribed",
      existingPlayerAlias: existingAccount.player.alias,
      channelIds: existingAccount.player.subscriptions.map((s) => s.channelId),
    };
  }

  const now = new Date();
  try {
    const isAddingToExistingPlayer = existingPlayer !== null;

    const account = await prisma.account.create({
      data: {
        alias,
        puuid,
        region,
        serverId: guildId,
        creatorDiscordId,
        player: {
          connectOrCreate: {
            where: { serverId_alias: { serverId: guildId, alias } },
            create: {
              alias,
              discordId: discordUserId ?? null,
              createdTime: now,
              updatedTime: now,
              creatorDiscordId,
              serverId: guildId,
            },
          },
        },
        createdTime: now,
        updatedTime: now,
      },
    });

    const playerConfigEntry = {
      alias,
      league: {
        leagueAccount: { puuid, region },
      },
      discordAccount: { id: discordUserId },
    };

    await backfillLastMatchTime(playerConfigEntry, puuid);

    const playerAccount = await prisma.account.findUnique({
      where: { id: account.id },
      include: { player: { include: { accounts: true } } },
    });

    if (!playerAccount) {
      return {
        kind: "internal-error",
        message: "Failed to find player for newly created account",
      };
    }

    const existingSubscription = await prisma.subscription.findUnique({
      where: {
        serverId_playerId_channelId: {
          serverId: guildId,
          playerId: playerAccount.player.id,
          channelId,
        },
      },
    });

    if (existingSubscription) {
      return {
        kind: "subscription-already-exists",
        playerAlias: playerAccount.player.alias,
        addedToExistingPlayer: isAddingToExistingPlayer,
        accounts: playerAccount.player.accounts.map((a) => ({
          alias: a.alias,
          region: a.region,
        })),
      };
    }

    const existingSubscriptionCount = await prisma.subscription.count({
      where: { serverId: guildId },
    });
    const isFirstSubscription = existingSubscriptionCount === 0;

    const subscription = await prisma.subscription.create({
      data: {
        channelId,
        playerId: playerAccount.player.id,
        createdTime: now,
        updatedTime: now,
        creatorDiscordId: DiscordAccountIdSchema.parse(creatorDiscordId),
        serverId: guildId,
      },
    });

    return {
      kind: "created",
      subscription: { id: subscription.id },
      account: {
        id: playerAccount.id,
        puuid,
        region: playerAccount.region,
        alias: playerAccount.alias,
      },
      player: {
        id: playerAccount.player.id,
        alias: playerAccount.player.alias,
        accounts: playerAccount.player.accounts.map((a) => ({
          alias: a.alias,
          region: a.region,
        })),
      },
      isAddingToExistingPlayer,
      isFirstSubscription,
      warnings: limits.warnings,
    };
  } catch (error) {
    logger.error("❌ Database error during subscription:", error);
    return { kind: "internal-error", message: getErrorMessage(error) };
  }
}
