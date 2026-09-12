import { createHash } from "node:crypto";
import {
  DiscordMessageIdSchema,
  NotificationIntentKeySchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/domain/identity/discord.ts";
import {
  NotificationAttemptNonceSchema,
  type NotificationAttemptNonce,
  type NotificationFailure,
} from "@scout-for-lol/domain/notifications/intent.ts";
import {
  beginSend,
  confirmDelivered,
  markReady,
  recordFailure,
} from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
import {
  transitionIntent,
  upsertIntent,
} from "#src/database/durable/intent-repository.ts";
import {
  recordDurableWrite,
  resolveDurableIdentity,
  type DurableFacts,
} from "#src/durable/match/durable-facts.ts";
import {
  toIsoInstant,
  toRiotMatchId,
} from "#src/durable/match/match-identity.ts";
import {
  buildMatchReceipt,
  deliveryEvidence,
  deliveryEvidenceCodec,
  MATCH_RECEIPT_KINDS,
  type DeliveredMessage,
} from "#src/durable/match/receipt-evidence.ts";

/**
 * The notification-intent service: a durable record of every Discord send the
 * v1 pipeline performs for a match.
 *
 * This wave RECORDS; it does not guard. On the post-match path the existing
 * `ScoutEffectClaim` rows remain the authoritative at-most-once delivery
 * guard, and the intent key is deliberately the same string as that claim's
 * effect key, so a later wave can promote the intent to the guard without
 * re-keying anything already stored. The attempt nonce uses the same recipe
 * for the same reason, and `deliverToChannels` now calls this helper rather
 * than repeating the hash inline, so the nonce Discord sees under
 * `enforceNonce` and the nonce the intent records cannot disagree.
 *
 * The pre-match path has no effect claim and sends no nonce to Discord — the
 * ActiveGame row is what stops a second detection from re-notifying — so its
 * keys and nonces are durable identifiers only, built the same way so both
 * paths read alike.
 */

/**
 * Discord's `nonce` field is limited to 25 characters, which is where the
 * slice comes from; base64url keeps it to characters Discord accepts.
 */
export function deliveryAttemptNonce(effectKey: string): string {
  return createHash("sha256")
    .update(effectKey)
    .digest("base64url")
    .slice(0, 25);
}

export type ChannelDeliveryEvent =
  | { kind: "prepared"; channelId: string }
  | { kind: "send-started"; channelId: string }
  | { kind: "delivered"; channelId: string; messageId: string }
  | { kind: "failed"; channelId: string; permissionError: boolean };

export type ChannelDeliveryRecorder = (
  event: ChannelDeliveryEvent,
) => Promise<void>;

/**
 * v1 distinguishes exactly one send failure from all the others: a Discord
 * permission error. That maps cleanly onto the domain's terminal
 * `permission-denied`; everything else is recorded as the generic retryable
 * class, because v1 has no finer taxonomy to record and guessing one would
 * put invented evidence in the table.
 */
function failureOf(permissionError: boolean): NotificationFailure {
  return permissionError
    ? { classification: "terminal", reason: "permission-denied" }
    : { classification: "retryable", reason: "service-unavailable" };
}

type RecorderConfig = {
  facts: DurableFacts;
  matchId: RiotMatchId;
  /**
   * The shared prefix of the delivery's effect keys — `postmatch-discord:<id>`
   * or `prematch-discord:<id>`. One intent key per channel is built from it.
   */
  keyPrefix: string;
  /** Sending after this instant is a conflict; the intent is stale. */
  freshnessDeadline: Date;
};

function intentKeyFor(config: RecorderConfig, channelId: string): string {
  return `${config.keyPrefix}:${channelId}`;
}

function attemptNonceFor(
  config: RecorderConfig,
  channelId: string,
): NotificationAttemptNonce {
  return NotificationAttemptNonceSchema.parse(
    deliveryAttemptNonce(intentKeyFor(config, channelId)),
  );
}

async function createIntent(
  config: RecorderConfig,
  channelId: string,
): Promise<void> {
  const key = NotificationIntentKeySchema.parse(
    intentKeyFor(config, channelId),
  );
  // A re-delivery after an ambiguous claim upserts the same key with a fresh
  // creation instant, which the repository answers with `intent-differs`. That
  // is the intended outcome: the stored intent is the one that counts, and the
  // transitions below then move that original row.
  await recordDurableWrite(config.facts, "intent-created", async (db) =>
    upsertIntent(db, {
      matchId: config.matchId,
      intent: {
        key,
        target: {
          kind: "channel",
          channelId: DiscordChannelIdSchema.parse(channelId),
        },
        freshnessDeadline: toIsoInstant(config.freshnessDeadline),
        createdAt: toIsoInstant(config.facts.now()),
        attemptCount: 0,
        state: { kind: "pending" },
      },
    }),
  );
  await recordDurableWrite(config.facts, "intent-ready", async (db) =>
    transitionIntent(db, { intentKey: key, transition: markReady }),
  );
}

async function applyIntentTransition(
  config: RecorderConfig,
  channelId: string,
  kind: "intent-send-started" | "intent-delivered" | "intent-failed",
  transition: Parameters<typeof transitionIntent>[1]["transition"],
): Promise<void> {
  const key = NotificationIntentKeySchema.parse(
    intentKeyFor(config, channelId),
  );
  await recordDurableWrite(config.facts, kind, async (db) =>
    transitionIntent(db, { intentKey: key, transition }),
  );
}

/**
 * Build a recorder for one delivery pass.
 *
 * The recorder remembers which channels actually began a send, so a failure
 * raised before the send — a claim lookup that threw, say — is not recorded as
 * a failed attempt that never happened.
 */
export function createChannelDeliveryRecorder(
  config: RecorderConfig,
): ChannelDeliveryRecorder {
  const started = new Set<string>();
  return async (event) => {
    switch (event.kind) {
      case "prepared":
        await createIntent(config, event.channelId);
        return;
      case "send-started": {
        started.add(event.channelId);
        const nonce = attemptNonceFor(config, event.channelId);
        await applyIntentTransition(
          config,
          event.channelId,
          "intent-send-started",
          (intent) =>
            beginSend(intent, {
              attemptNonce: nonce,
              startedAt: toIsoInstant(config.facts.now()),
            }),
        );
        return;
      }
      case "delivered": {
        const nonce = attemptNonceFor(config, event.channelId);
        await applyIntentTransition(
          config,
          event.channelId,
          "intent-delivered",
          (intent) =>
            confirmDelivered(intent, {
              attemptNonce: nonce,
              messageId: DiscordMessageIdSchema.parse(event.messageId),
              deliveredAt: toIsoInstant(config.facts.now()),
            }),
        );
        return;
      }
      case "failed": {
        if (!started.has(event.channelId)) return;
        const nonce = attemptNonceFor(config, event.channelId);
        await applyIntentTransition(
          config,
          event.channelId,
          "intent-failed",
          (intent) =>
            recordFailure(intent, {
              attemptNonce: nonce,
              failure: failureOf(event.permissionError),
            }),
        );
        return;
      }
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
  };
}

/**
 * Build a delivery recorder for one match, or `null` when the v1 match id
 * cannot be a durable identity — in which case the delivery runs exactly as it
 * did before, unrecorded, and the parity metric carries the loss.
 */
export function tryCreateChannelDeliveryRecorder(args: {
  facts: DurableFacts;
  matchId: string;
  keyPrefix: string;
  freshnessDeadline: Date;
}): ChannelDeliveryRecorder | null {
  const matchId = resolveDurableIdentity(() => toRiotMatchId(args.matchId));
  if (matchId === null) return null;
  return createChannelDeliveryRecorder({
    facts: args.facts,
    matchId,
    keyPrefix: args.keyPrefix,
    freshnessDeadline: args.freshnessDeadline,
  });
}

/**
 * Group the Discord messages this delivery produced by the guild they landed
 * in. Built from the channels that were targeted and came back with a message
 * id, so a delivery receipt's evidence describes delivery rather than intent,
 * and names each message by the id Discord itself will answer for.
 */
export function deliveredMessagesByGuild(
  channels: readonly { channel: string; serverId: string }[],
  messageIdsByChannel: ReadonlyMap<string, string>,
): Map<string, DeliveredMessage[]> {
  const byGuild = new Map<string, DeliveredMessage[]>();
  for (const { channel, serverId } of channels) {
    const messageId = messageIdsByChannel.get(channel);
    if (messageId === undefined) continue;
    byGuild.set(serverId, [
      ...(byGuild.get(serverId) ?? []),
      { channelId: channel, messageId },
    ]);
  }
  return byGuild;
}

/**
 * Record one delivery receipt per guild that received the match's message.
 *
 * Receipt scope is global, guild or account, so a per-channel receipt is not
 * representable; the guild is the audience the receipt describes, and the
 * evidence names every message delivered inside it. The intents carry the same
 * message ids per channel, so the two can be reconciled against each other and
 * against Discord.
 */
export async function recordDeliveryReceipts(args: {
  facts: DurableFacts;
  kind: "reportDelivery" | "prematchDelivery";
  matchId: string;
  messagesByGuild: ReadonlyMap<string, readonly DeliveredMessage[]>;
}): Promise<void> {
  const matchId = resolveDurableIdentity(() => toRiotMatchId(args.matchId));
  if (matchId === null) return;
  const writeKind =
    args.kind === "reportDelivery"
      ? "receipt-report-delivery"
      : "receipt-prematch-delivery";
  const recordedAt = toIsoInstant(args.facts.now());

  for (const [guildId, delivered] of args.messagesByGuild) {
    await recordDurableWrite(args.facts, writeKind, async (db) =>
      recordReceipt(
        db,
        buildMatchReceipt({
          matchId,
          kind: MATCH_RECEIPT_KINDS[args.kind],
          scope: {
            kind: "guild",
            guildId: DiscordGuildIdSchema.parse(guildId),
          },
          recordedAt,
          evidence: deliveryEvidenceCodec.serialize(
            deliveryEvidence(delivered),
          ),
        }),
      ),
    );
  }
}
