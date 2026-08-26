import { prisma } from "#src/database/index.ts";
import { send } from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index.ts";
import * as Sentry from "@sentry/bun";
import {
  claimScoutEffect,
  completeScoutEffect,
  recordScoutEffectFailure,
} from "#src/temporal/effect-claims.ts";

const logger = createLogger("offline-notification");

export async function sendOfflineNotification(
  outageStartedAt: Date = new Date(0),
): Promise<void> {
  logger.info("Sending offline recovery notification to subscribed channels");

  const subscriptions = await prisma.subscription.findMany({
    select: { channelId: true, serverId: true },
    distinct: ["channelId"],
  });

  if (subscriptions.length === 0) {
    logger.info("No channels to notify about downtime");
    return;
  }

  logger.info(
    `Notifying ${subscriptions.length.toString()} channel(s) about downtime recovery`,
  );

  const message =
    "Scout was offline for a bit. Sorry about that! I'm back now and catching up on missed matches.";

  let successCount = 0;
  let failCount = 0;

  for (const { channelId, serverId } of subscriptions) {
    const effectKey = `offline-notification:${outageStartedAt.toISOString()}:${channelId}`;
    let claimed = false;
    try {
      const claim = await claimScoutEffect({
        key: effectKey,
        kind: "offline-notification",
      });
      if (claim === "completed") {
        successCount += 1;
        continue;
      }
      claimed = true;
      await send(
        {
          content: message,
          nonce: `sof:${outageStartedAt.getTime().toString(36)}:${channelId.slice(-6)}`,
          enforceNonce: true,
        },
        channelId,
        DiscordGuildIdSchema.parse(serverId),
      );
      await completeScoutEffect(effectKey);
      successCount += 1;
    } catch (error) {
      if (claimed) await recordScoutEffectFailure(effectKey, error);
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
