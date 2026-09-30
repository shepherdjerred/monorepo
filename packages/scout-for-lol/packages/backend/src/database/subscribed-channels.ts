import {
  type DiscordChannelId,
  type LeaguePuuid,
  DiscordChannelIdSchema,
  parseSubscriptionFilters,
  type SubscriptionFilterSpec,
} from "@scout-for-lol/data";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

const logger = createLogger("database");

// A channel that should be notified about a match, plus the in-match
// subscriptions routing to it and their parsed notification filters. Filters
// are per-subscription; the caller decides delivery (e.g. notify the channel
// iff at least one of its in-match subscriptions passes its filter).
export type SubscribedChannelSubscription = {
  subscriptionId: number;
  playerId: number;
  filters: SubscriptionFilterSpec | null;
  isMuted: boolean;
};
export type SubscribedChannel = {
  channel: DiscordChannelId;
  serverId: string;
  subscriptions: SubscribedChannelSubscription[];
};

export async function getChannelsSubscribedToPlayers(
  puuids: LeaguePuuid[],
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<SubscribedChannel[]> {
  logger.info(
    `🔍 Fetching channels subscribed to ${puuids.length.toString()} players`,
  );

  try {
    const startTime = Date.now();

    // the accounts that are subscribed to the players
    const accounts = await prismaClient.account.findMany({
      where: {
        puuid: {
          in: puuids,
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

    const queryTime = Date.now() - startTime;
    logger.info(
      `📊 Found ${accounts.length.toString()} accounts in ${queryTime.toString()}ms`,
    );

    // Group subscriptions by channel. A channel can host several in-match
    // subscriptions (different players), and one player can have multiple
    // accounts in the queried set, so dedupe subscriptions by id per channel.
    const byChannel = new Map<
      DiscordChannelId,
      {
        serverId: string;
        subscriptions: Map<number, SubscribedChannelSubscription>;
      }
    >();
    for (const account of accounts) {
      for (const subscription of account.player.subscriptions) {
        const channel = DiscordChannelIdSchema.parse(subscription.channelId);
        let entry = byChannel.get(channel);
        if (entry === undefined) {
          entry = { serverId: subscription.serverId, subscriptions: new Map() };
          byChannel.set(channel, entry);
        }
        const filters = parseSubscriptionFilters(subscription.filters);
        // `parseSubscriptionFilters` is fail-open: a corrupt/unknown blob
        // yields null (= notify-all) rather than dropping notifications. That
        // is the right runtime behavior, but a silent revert is invisible.
        // Surface it: a non-empty raw value that parses to null is corruption
        // (invalid JSON, wrong schema version, manual DB edit), not an
        // intentionally-empty filter set.
        const rawFilters = subscription.filters;
        if (
          filters === null &&
          rawFilters !== null &&
          rawFilters.trim() !== ""
        ) {
          logger.warn(
            `⚠️  Subscription ${subscription.id.toString()} in ${channel} has unparseable filters; falling back to notify-all`,
            {
              subscriptionId: subscription.id,
              channelId: channel,
              serverId: subscription.serverId,
            },
          );
        }
        entry.subscriptions.set(subscription.id, {
          subscriptionId: subscription.id,
          playerId: subscription.playerId,
          filters,
          isMuted: subscription.isMuted,
        });
      }
    }

    const result: SubscribedChannel[] = [...byChannel.entries()].map(
      ([channel, entry]) => ({
        channel,
        serverId: entry.serverId,
        subscriptions: [...entry.subscriptions.values()],
      }),
    );

    logger.info(`📺 Returning ${result.length.toString()} unique channels`);
    return result;
  } catch (error) {
    logger.error("❌ Error fetching subscribed channels:", error);
    Sentry.captureException(error, {
      tags: { source: "db-get-subscribed-channels" },
    });
    throw error;
  }
}
