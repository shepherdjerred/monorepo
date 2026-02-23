import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { send } from "@scout-for-lol/backend/league/discord/channel.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import * as Sentry from "@sentry/bun";

const logger = createLogger("offline-notification");

export async function sendOfflineNotification(): Promise<void> {
  logger.info("Sending offline recovery notification to subscribed channels");

  const subscriptions = await prisma.subscription.findMany({
    select: { channelId: true },
    distinct: ["channelId"],
  });

  const channelIds = subscriptions.map((s) => s.channelId);

  if (channelIds.length === 0) {
    logger.info("No channels to notify about downtime");
    return;
  }

  logger.info(
    `Notifying ${channelIds.length.toString()} channel(s) about downtime recovery`,
  );

  const message =
    "Scout was offline for a bit. Sorry about that! I'm back now and catching up on missed matches.";

  let successCount = 0;
  let failCount = 0;

  for (const channelId of channelIds) {
    try {
      await send(message, channelId);
      successCount += 1;
    } catch (error) {
      failCount += 1;
      logger.warn(
        `Failed to send offline notification to channel ${channelId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "offline-notification", channelId },
      });
    }
  }

  logger.info(
    `Offline notification sent: ${successCount.toString()} succeeded, ${failCount.toString()} failed`,
  );
}
