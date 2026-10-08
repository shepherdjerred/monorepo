import type { MessageCreateOptions } from "discord.js";
import {
  DiscordMessageIdSchema,
  NotificationIntentKeySchema,
  type DiscordMessageId,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { OpaqueVersionedEnvelope } from "@scout-for-lol/domain/codec/versioned.ts";
import { prepareSettlementAnnouncement } from "#src/betting/notify/announce-prepare.ts";
import { prisma } from "#src/database/index.ts";
import {
  getIntent,
  listIntentsForMatch,
} from "#src/database/durable/intent-repository.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import {
  deliveryIntentKey,
  postmatchDeliveryKeyPrefix,
} from "#src/durable/match/delivery-intents.ts";
import {
  MalformedAnnouncementIntentError,
  settlementAnnouncementCodec,
  settlementAnnouncementInputOf,
} from "#src/temporal/notification/announcement-codecs.ts";

/**
 * The settlement-shaped notification: what a `settlement` intent delivers.
 *
 * One intent is one guild channel's Bryan Bucks recap for one match — the
 * outcome embed, the parlay result, or both — minted by the fenced settlement
 * effect with the summaries settlement produced, and rendered here through
 * v1's own `prepareSettlementAnnouncement`, so the pool read, the refund
 * reconstruction, the embed budget and the mention safety are one
 * implementation.
 *
 * ## The reply target
 *
 * v1 replies to the post-match report in the same channel, falling back to a
 * plain message when it cannot. The durable equivalent of v1's
 * `ActiveGame.postmatchMessageIds` is the delivered POSTMATCH intent for the
 * same (match, channel): its `state.messageId` is the message Discord
 * answered for, so that is what this replies to. `failIfNotExists: false`
 * makes a deleted report a plain send rather than a refused one, and the
 * delivery arm handles the reply-permission case the way v1 does — one
 * plain send after a refused reply.
 *
 * ## What is NOT here
 *
 * v1's settlement DMs (`deliverSettlementDms`, a per-bettor, budgeted,
 * flag-gated fan-out) are not part of this kind: a `settlement` intent
 * targets a channel, and the delivery arm refuses a DM target for it as
 * terminal. Private settlement receipts under V2 are an explicit gap.
 */

export function requireAnnouncement(
  record: MatchNotificationIntentRecord,
): OpaqueVersionedEnvelope {
  const announcement = record.intent.announcement;
  if (announcement === undefined) {
    // Unrepresentable through the domain schema, which requires an
    // announcement on exactly these kinds; reaching here means a row was
    // written around it.
    throw new MalformedAnnouncementIntentError({
      intentKey: record.intent.key,
      detail: `a ${record.intent.kind} intent was minted with no announcement payload`,
    });
  }
  return announcement;
}

/**
 * The delivered post-match report in this channel, if there is one to reply
 * to.
 *
 * Read from the intent row rather than from `ActiveGame`, because the intent
 * row is the durable record V2 writes and the one a resumed run can trust; a
 * post-match intent that is not yet delivered, or was suppressed or refused,
 * simply means there is nothing to reply to and the recap stands alone.
 */
export async function postmatchReplyTarget(
  riotMatchId: RiotMatchId,
  channelId: string,
): Promise<DiscordMessageId | undefined> {
  const report = await getIntent(prisma, {
    intentKey: NotificationIntentKeySchema.parse(
      deliveryIntentKey(postmatchDeliveryKeyPrefix(riotMatchId), channelId),
    ),
  });
  const state = report?.intent.state;
  return state?.kind !== "delivered" || state.messageId === undefined
    ? undefined
    : DiscordMessageIdSchema.parse(state.messageId);
}

/**
 * Every delivered post-match report for one match, by channel: what a recap
 * of this match replies to, in each channel it can.
 *
 * The match-wide form of {@link postmatchReplyTarget}, for the caller that
 * announces a whole match at once rather than one intent: the stale-pool void
 * sweep, which used to read v1's `ActiveGame.postmatchMessageIds`. Built from
 * the same rows by the same rule — a delivered POSTMATCH intent with a
 * message id — so the two forms cannot disagree about a channel.
 */
export async function postmatchReplyTargets(
  riotMatchId: RiotMatchId,
): Promise<Map<string, DiscordMessageId>> {
  const prefix = `${postmatchDeliveryKeyPrefix(riotMatchId)}:`;
  const targets = new Map<string, DiscordMessageId>();
  for (const record of await listIntentsForMatch(prisma, {
    matchId: riotMatchId,
  })) {
    const { key, state, target } = record.intent;
    if (
      !key.startsWith(prefix) ||
      target.kind !== "channel" ||
      state.kind !== "delivered" ||
      state.messageId === undefined
    ) {
      continue;
    }
    targets.set(
      target.channelId,
      DiscordMessageIdSchema.parse(state.messageId),
    );
  }
  return targets;
}

export async function buildSettlementNotificationMessage(
  record: MatchNotificationIntentRecord,
): Promise<MessageCreateOptions> {
  const announcement = settlementAnnouncementInputOf(
    settlementAnnouncementCodec.parse(requireAnnouncement(record)),
  );
  const prepared = await prepareSettlementAnnouncement(announcement, prisma);
  if (prepared.kind !== "message") {
    // The minter decides reportability with the same inputs this has, so a
    // pool that vanished or an announcement with nothing to say is a
    // disagreement between the two, not a state to deliver around.
    throw new Error(
      `Settlement intent ${record.intent.key} has nothing to announce (${prepared.kind})`,
    );
  }
  const target = record.intent.target;
  const replyTo =
    target.kind === "channel"
      ? await postmatchReplyTarget(record.matchId, target.channelId)
      : undefined;
  return {
    ...prepared.message,
    // A fifteen-person settlement must not ping fifteen people.
    allowedMentions: { parse: [] },
    ...(replyTo === undefined
      ? {}
      : {
          reply: {
            messageReference: replyTo,
            // Discord sends this as a normal message if the report disappeared.
            failIfNotExists: false,
          },
        }),
  };
}
