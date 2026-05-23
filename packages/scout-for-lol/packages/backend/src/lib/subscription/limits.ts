import { type DiscordGuildId } from "@scout-for-lol/data/index.ts";
import { getLimit } from "#src/configuration/flags.ts";
import { LIMIT_WARNING_THRESHOLD } from "#src/configuration/subscription-limits.ts";
import { createLogger } from "#src/logger.ts";
import type { Db } from "#src/lib/audit/index.ts";
import type { LimitWarning } from "#src/lib/subscription/types.ts";

const logger = createLogger("subscription-limits");

export type LimitCheckResult =
  | { kind: "ok"; warnings: LimitWarning[] }
  | {
      kind: "subscription-limit-reached";
      current: number;
      max: number;
    }
  | {
      kind: "account-limit-reached";
      current: number;
      max: number;
    };

export async function checkSubscriptionAndAccountLimits(params: {
  guildId: DiscordGuildId;
  isAddingToExistingPlayer: boolean;
  db: Db;
}): Promise<LimitCheckResult> {
  const { guildId, isAddingToExistingPlayer, db } = params;
  const warnings: LimitWarning[] = [];

  if (!isAddingToExistingPlayer) {
    const subscriptionLimit = getLimit("player_subscriptions", {
      server: guildId,
    });
    if (subscriptionLimit !== "unlimited") {
      const subscribedPlayerCount = await db.player.count({
        where: {
          serverId: guildId,
          subscriptions: { some: {} },
        },
      });

      logger.info(
        `📊 Subscribed players: ${subscribedPlayerCount.toString()}/${subscriptionLimit.toString()}`,
      );

      if (subscribedPlayerCount >= subscriptionLimit) {
        return {
          kind: "subscription-limit-reached",
          current: subscribedPlayerCount,
          max: subscriptionLimit,
        };
      }

      const remainingSlots = subscriptionLimit - subscribedPlayerCount - 1;
      if (remainingSlots <= LIMIT_WARNING_THRESHOLD && remainingSlots > 0) {
        warnings.push({
          kind: "subscription-limit-near",
          remaining: remainingSlots,
          max: subscriptionLimit,
        });
      }
    }
  }

  const accountLimit = getLimit("accounts", { server: guildId });
  if (accountLimit !== "unlimited") {
    const accountCount = await db.account.count({
      where: { serverId: guildId },
    });

    logger.info(
      `📊 Accounts: ${accountCount.toString()}/${accountLimit.toString()}`,
    );

    if (accountCount >= accountLimit) {
      return {
        kind: "account-limit-reached",
        current: accountCount,
        max: accountLimit,
      };
    }

    const remainingAccountSlots = accountLimit - accountCount - 1;
    if (
      remainingAccountSlots <= LIMIT_WARNING_THRESHOLD &&
      remainingAccountSlots > 0
    ) {
      warnings.push({
        kind: "account-limit-near",
        remaining: remainingAccountSlots,
        max: accountLimit,
      });
    }
  }

  return { kind: "ok", warnings };
}
