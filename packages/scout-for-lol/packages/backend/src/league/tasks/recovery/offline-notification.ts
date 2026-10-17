import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import * as Sentry from "@sentry/bun";
import { mintProductAnnouncement } from "#src/temporal/notification/product/announcement.ts";

const logger = createLogger("offline-notification");

const OFFLINE_NOTICE =
  "Scout was offline for a bit. Sorry about that! I'm back now and catching up on missed matches.";

/** "I'm back now" is worthless once the catch-up it announces is long over. */
const OFFLINE_NOTICE_FRESHNESS_MS = 60 * 60 * 1000;

/**
 * Tell every subscribed channel that Scout recovered from an outage, once per
 * outage and channel.
 *
 * Each channel gets a `product-announcement` notification intent keyed by the
 * outage and the channel, minted with its Workflow start request in one
 * transaction. The notification lane owns the send: one stable nonce per
 * intent, an ambiguous send parked in `unknown-delivery` for an operator, and
 * a repeat recovery pass for the same outage finding the standing intent
 * instead of posting again.
 */
export async function sendOfflineNotification(
  outageStartedAt: Date = new Date(0),
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  logger.info("Queueing offline recovery notification to subscribed channels");

  const subscriptions = await database.subscription.findMany({
    select: { channelId: true, serverId: true },
    distinct: ["channelId"],
  });

  if (subscriptions.length === 0) {
    logger.info("No channels to notify about downtime");
    return;
  }

  const occurredAt = new Date();
  const announcementId = `offline-recovery:${outageStartedAt.toISOString()}`;
  const effect = {
    kind: "offline-recovery" as const,
    outageStartedAt: IsoInstantSchema.parse(outageStartedAt.toISOString()),
  };
  let queued = 0;
  let existing = 0;
  let failed = 0;

  for (const { channelId, serverId } of subscriptions) {
    try {
      const outcome = await database.$transaction(
        async (tx) =>
          await mintProductAnnouncement(tx, {
            announcementId,
            guildId: DiscordGuildIdSchema.parse(serverId),
            target: {
              kind: "channel",
              channelId: DiscordChannelIdSchema.parse(channelId),
            },
            message: { content: OFFLINE_NOTICE },
            effect,
            occurredAt,
            freshnessDeadline: new Date(
              occurredAt.getTime() + OFFLINE_NOTICE_FRESHNESS_MS,
            ),
          }),
      );
      if (outcome === "minted") queued += 1;
      else existing += 1;
    } catch (error) {
      failed += 1;
      logger.warn(
        `Failed to queue offline notification for channel ${channelId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "offline-notification", channelId },
      });
    }
  }

  logger.info(
    `Offline notification: ${queued.toString()} queued, ${existing.toString()} already standing, ${failed.toString()} failed`,
  );
}
