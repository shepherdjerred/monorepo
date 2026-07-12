import * as Sentry from "@sentry/bun";
import {
  filtersPass,
  DiscordGuildIdSchema,
  type QueueType,
} from "@scout-for-lol/data/index.ts";
import type { SubscribedChannel } from "#src/database/index.ts";
import { send, ChannelSendError } from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("notification-dispatch");

/**
 * Filter resolved channels down to those that should be notified for a match,
 * applying each subscription's notification filters. A channel is kept iff at
 * least one of its in-match subscriptions is unmuted and passes (the rendered
 * message is match-level, covering every tracked player in the game).
 */
export function channelsPassingQueueFilter(
  channels: SubscribedChannel[],
  queueType: QueueType | undefined,
): SubscribedChannel[] {
  return channels.filter((channel) =>
    channel.subscriptions.some(
      (subscription) =>
        !subscription.isMuted &&
        filtersPass(subscription.filters, { queueType }),
    ),
  );
}

/**
 * Send a rendered message to each channel, tolerating per-channel failures:
 * missing-permission errors are logged and skipped, anything else is reported
 * to Sentry, so one bad channel never blocks the rest.
 */
export async function deliverToChannels(params: {
  message: Parameters<typeof send>[0];
  channels: { channel: SubscribedChannel["channel"]; serverId: string }[];
  logPrefix: string;
  sentryTags: Record<string, string>;
}): Promise<void> {
  for (const { channel, serverId } of params.channels) {
    try {
      await send(params.message, channel, DiscordGuildIdSchema.parse(serverId));
    } catch (error) {
      if (error instanceof ChannelSendError && error.permissionError) {
        logger.warn(
          `${params.logPrefix} ⚠️  Permission error for channel ${channel}: ${error.message}`,
        );
        continue;
      }
      logger.error(
        `${params.logPrefix} ❌ Failed to send to channel ${channel}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "discord-notification", ...params.sentryTags, channel },
      });
    }
  }
}
