import * as Sentry from "@sentry/bun";
import {
  claimScoutEffect,
  DISCORD_CHANNEL_MESSAGE_EFFECT_KIND,
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
  type LeaguePuuid,
  type QueueType,
} from "@scout-for-lol/data/index.ts";
import { uniqueBy } from "remeda";
import {
  getChannelsSubscribedToPlayers,
  type SubscribedChannel,
} from "#src/database/subscribed-channels.ts";
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

/**
 * Where one finished match's report goes: the channels subscribed to its
 * tracked players that pass their queue filter, and the guilds those channels
 * belong to.
 *
 * One derivation for both consumers on purpose. v1 delivers to `deliverable`
 * and generates the report against `guildIds`; the V2 notification lane
 * renders its attested report against the same `guildIds`, because the
 * per-guild feature flags the generator evaluates (the AI review) must see
 * the same audience whichever pipeline sends. `subscribed` is the unfiltered
 * set, kept for the log line that explains an empty delivery.
 */
export async function resolvePostmatchDeliveryChannels(args: {
  puuids: LeaguePuuid[];
  queueType: QueueType | undefined;
}): Promise<{
  subscribed: SubscribedChannel[];
  deliverable: SubscribedChannel[];
  guildIds: DiscordGuildId[];
}> {
  const subscribed = await getChannelsSubscribedToPlayers(args.puuids);
  const deliverable = channelsPassingQueueFilter(subscribed, args.queueType);
  const guildIds = uniqueBy(
    deliverable.map((channel) => DiscordGuildIdSchema.parse(channel.serverId)),
    (id) => id,
  );
  return { subscribed, deliverable, guildIds };
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
  /**
   * Per-guild last look at the message before it is sent, and a confirmation
   * to run once that guild's send is accepted.
   *
   * One built message fans out to every subscribed guild, so anything
   * guild-specific — a feature tip, for instance — has to be applied here
   * rather than by the caller, and must return a copy instead of mutating the
   * shared message.
   */
  decorate?: (
    message: MessageCreateOptions,
    guildId: DiscordGuildId,
  ) => Promise<{
    message: MessageCreateOptions;
    confirm: () => Promise<void>;
    release: () => Promise<void>;
  }>;
}): Promise<{
  deliveredGuildIds: Set<DiscordGuildId>;
  messageIdsByChannel: Map<DiscordChannelId, string>;
}> {
  const deliveredGuildIds = new Set<DiscordGuildId>();
  const messageIdsByChannel = new Map<DiscordChannelId, string>();
  const recordDelivery = params.recordDelivery ?? RECORD_NOTHING;
  for (const { channel, serverId } of params.channels) {
    // Declared out here so a failed send can hand its tip claim back.
    let decorated:
      Awaited<ReturnType<NonNullable<typeof params.decorate>>> | undefined;
    let sendAccepted = false;
    const effectKey =
      params.effectKeyPrefix === undefined
        ? undefined
        : `${params.effectKeyPrefix}:${channel}`;
    let effectClaimed = false;
    try {
      if (effectKey !== undefined) {
        const claim = await claimScoutEffect({
          key: effectKey,
          kind: DISCORD_CHANNEL_MESSAGE_EFFECT_KIND,
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
          const completed = await requireCompletedScoutEffectResult(effectKey);
          deliveredGuildIds.add(DiscordGuildIdSchema.parse(serverId));
          messageIdsByChannel.set(channel, completed.resultId);
          await recordDelivery({
            kind: "already-delivered",
            channelId: channel,
            messageId: completed.resultId,
            // The claim brackets the send it proves — taken immediately before
            // it ran, completed immediately after it returned — so those are
            // the instants to record, not this pass's clock.
            send: {
              startedAt: completed.claimedAt,
              deliveredAt: completed.completedAt,
            },
          });
          continue;
        }
        effectClaimed = true;
      }
      await recordDelivery({ kind: "prepared", channelId: channel });
      const guildId = DiscordGuildIdSchema.parse(serverId);
      decorated =
        params.decorate === undefined
          ? undefined
          : await params.decorate(params.message, guildId);
      await recordDelivery({ kind: "send-started", channelId: channel });
      const sentMessage = await sendWithReplyFallback({
        message: decorated?.message ?? params.message,
        replyToMessageId: params.replyToMessageIds?.get(channel),
        nonce:
          effectKey === undefined ? undefined : deliveryAttemptNonce(effectKey),
        channel,
        guildId,
      });
      sendAccepted = true;
      // Before the effect is completed, not after: a crash in between would
      // otherwise leave the tip delivered but unrecorded, and the retry would
      // take the `completed` branch below and never confirm it — so the same
      // audience could be shown the same tip twice. Confirming first inverts
      // the risk to a recorded tip whose message is resent, which costs at
      // most one tip rather than breaking the once-only promise.
      await decorated?.confirm();
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
      // The decoration claimed its tip before the send; give it back so the
      // audience stays eligible for it.
      if (!sendAccepted) await decorated?.release();
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
