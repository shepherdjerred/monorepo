import * as Sentry from "@sentry/bun";
import {
  claimScoutEffect,
  completeScoutEffectWithResult,
  recordScoutEffectFailure,
  requireCompletedScoutEffectResult,
} from "#src/temporal/effect-claims.ts";
import {
  deliveryAttemptNonce,
  type ChannelDeliveryRecorder,
} from "#src/durable/match/delivery-intents.ts";
import {
  filtersPass,
  DiscordGuildIdSchema,
  type DiscordChannelId,
  type DiscordGuildId,
  type QueueType,
} from "@scout-for-lol/data/index.ts";
import type { SubscribedChannel } from "#src/database/index.ts";
import {
  send,
  ChannelSendError,
  isReplyPermissionError,
} from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";
import type { MessageCreateOptions } from "discord.js";

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

/** No durable record kept for this delivery; the send is unchanged either way. */
const RECORD_NOTHING: ChannelDeliveryRecorder = () => Promise.resolve();

function isPermissionError(error: unknown): boolean {
  return error instanceof ChannelSendError && error.permissionError;
}

/**
 * Send one rendered message to a channel, falling back to a plain send when
 * the channel denies replies.
 *
 * A reply requires Read Message History. Without it the report itself is still
 * deliverable wherever plain sending is allowed, so a reply-permission failure
 * retries as a normal message rather than losing the report.
 */
async function sendWithReplyFallback(params: {
  message: MessageCreateOptions;
  replyToMessageId: string | undefined;
  nonce: string | undefined;
  channel: DiscordChannelId;
  guildId: DiscordGuildId;
}): Promise<Awaited<ReturnType<typeof send>>> {
  const idempotency =
    params.nonce === undefined
      ? {}
      : { nonce: params.nonce, enforceNonce: true };
  const replied: MessageCreateOptions =
    params.replyToMessageId === undefined
      ? params.message
      : {
          ...params.message,
          reply: {
            messageReference: params.replyToMessageId,
            // If the prematch message was deleted, still deliver the
            // postmatch report as a normal message.
            failIfNotExists: false,
          },
        };
  try {
    return await send(
      { ...replied, ...idempotency },
      params.channel,
      params.guildId,
    );
  } catch (error) {
    if (
      params.replyToMessageId === undefined ||
      !(error instanceof ChannelSendError) ||
      !isReplyPermissionError(error)
    ) {
      throw error;
    }
    return await send(
      { ...params.message, ...idempotency },
      params.channel,
      params.guildId,
    );
  }
}

/**
 * Send a rendered message to each channel, tolerating per-channel failures:
 * missing-permission errors are logged and skipped, anything else is reported
 * to Sentry, so one bad channel never blocks the rest.
 *
 * `recordDelivery` is the durable notification-intent recorder. It observes
 * the send; it never gates it — the `ScoutEffectClaim` below remains the
 * at-most-once guard — and every one of its writes is fail-open, so a
 * recorder outage cannot stop a message going out.
 */
export async function deliverToChannels(params: {
  message: MessageCreateOptions;
  channels: { channel: SubscribedChannel["channel"]; serverId: string }[];
  logPrefix: string;
  sentryTags: Record<string, string>;
  replyToMessageIds?: ReadonlyMap<string, string>;
  effectKeyPrefix?: string;
  recordDelivery?: ChannelDeliveryRecorder | undefined;
}): Promise<{
  deliveredGuildIds: Set<DiscordGuildId>;
  messageIdsByChannel: Map<DiscordChannelId, string>;
}> {
  const deliveredGuildIds = new Set<DiscordGuildId>();
  const messageIdsByChannel = new Map<DiscordChannelId, string>();
  const recordDelivery = params.recordDelivery ?? RECORD_NOTHING;
  for (const { channel, serverId } of params.channels) {
    const effectKey =
      params.effectKeyPrefix === undefined
        ? undefined
        : `${params.effectKeyPrefix}:${channel}`;
    let effectClaimed = false;
    try {
      if (effectKey !== undefined) {
        const claim = await claimScoutEffect({
          key: effectKey,
          kind: "discord-channel-message",
        });
        if (claim === "completed") {
          // An earlier run already sent this message, but its intent writes are
          // fail-open, so that run may have ended anywhere between minting the
          // intent and confirming it — leaving the row missing, `pending`,
          // `ready`, or `sending`. No later pass reaches the lifecycle below,
          // so this is the only place that can still close it out. The recorder
          // adopts the delivery from wherever the intent stopped; a row already
          // delivered under this message id answers `already-applied`, so the
          // ordinary replay stays quiet.
          const messageId = await requireCompletedScoutEffectResult(effectKey);
          deliveredGuildIds.add(DiscordGuildIdSchema.parse(serverId));
          messageIdsByChannel.set(channel, messageId);
          await recordDelivery({
            kind: "already-delivered",
            channelId: channel,
            messageId,
          });
          continue;
        }
        effectClaimed = true;
      }
      await recordDelivery({ kind: "prepared", channelId: channel });
      const guildId = DiscordGuildIdSchema.parse(serverId);
      await recordDelivery({ kind: "send-started", channelId: channel });
      const sentMessage = await sendWithReplyFallback({
        message: params.message,
        replyToMessageId: params.replyToMessageIds?.get(channel),
        nonce:
          effectKey === undefined ? undefined : deliveryAttemptNonce(effectKey),
        channel,
        guildId,
      });
      if (effectKey !== undefined) {
        await completeScoutEffectWithResult(effectKey, sentMessage.id);
      }
      deliveredGuildIds.add(guildId);
      messageIdsByChannel.set(channel, sentMessage.id);
      await recordDelivery({
        kind: "delivered",
        channelId: channel,
        messageId: sentMessage.id,
      });
    } catch (error) {
      if (effectKey !== undefined && effectClaimed) {
        await recordScoutEffectFailure(effectKey, error);
      }
      await recordDelivery({
        kind: "failed",
        channelId: channel,
        permissionError: isPermissionError(error),
      });
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
  return { deliveredGuildIds, messageIdsByChannel };
}
