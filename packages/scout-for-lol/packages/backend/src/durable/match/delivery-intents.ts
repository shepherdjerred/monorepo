import { createHash } from "node:crypto";
import {
  DiscordMessageIdSchema,
  NotificationIntentKeySchema,
  type IsoInstant,
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
  type NotificationIntent,
} from "@scout-for-lol/domain/notifications/intent.ts";
import {
  beginSend,
  confirmDelivered,
  markReady,
  recordFailure,
  type NotificationTransitionResult,
} from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
import {
  getIntent,
  transitionIntent,
  upsertIntent,
} from "#src/database/durable/intent-repository.ts";
import {
  recordDurableWrite,
  reportDurableWriteFailure,
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

/**
 * When a send that already happened began, and when it was observed to have
 * happened. Both are historical: a pass recovering the send can be running
 * hours later, and the intent's freshness guard would rightly reject a send
 * claiming to have started then.
 */
export type ProvenSend = { startedAt: Date; deliveredAt: Date };

export type ChannelDeliveryEvent =
  | { kind: "prepared"; channelId: string }
  | { kind: "send-started"; channelId: string }
  | { kind: "delivered"; channelId: string; messageId: string }
  /**
   * A send an EARLIER pass performed, proven by a completed effect claim. The
   * lifecycle above never runs for it, so its intent has to be adopted from
   * wherever that pass left it. See {@link adoptCompletedDelivery}.
   */
  | {
      kind: "already-delivered";
      channelId: string;
      messageId: string;
      send: ProvenSend;
    }
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

/**
 * Confirm a delivery, tolerating one that is already recorded under the same
 * message id.
 *
 * The domain compares the delivery instant as well as the id, which is right
 * for the transition itself: two confirmations naming different moments are
 * genuinely different claims. But a pass that finds the send already completed
 * knows the message id and NOT the instant the earlier pass stamped, and an
 * intent already delivered under that same id is exactly the fact being
 * recorded — so it is `already-applied` rather than drift. Without this, every
 * ordinary reprocess of a delivered match would report a conflict on the
 * counter the parity alerting watches. Every other state still goes through
 * the domain unchanged.
 *
 * The message id is parsed INSIDE the returned transition, which is what runs
 * inside {@link recordDurableWrite}. v1 hands over whatever Discord (or a test
 * double) answered with, and a value that cannot be a durable identity must be
 * counted as this recorder's failure rather than thrown at a send that already
 * succeeded.
 */
function confirmDelivery(args: {
  attemptNonce: NotificationAttemptNonce;
  messageId: string;
  deliveredAt: () => IsoInstant;
}): (intent: NotificationIntent) => NotificationTransitionResult {
  return (intent) => {
    const messageId = DiscordMessageIdSchema.parse(args.messageId);
    if (
      intent.state.kind === "delivered" &&
      intent.state.messageId === messageId
    ) {
      return { outcome: "already-applied" };
    }
    return confirmDelivered(intent, {
      attemptNonce: args.attemptNonce,
      messageId,
      deliveredAt: args.deliveredAt(),
    });
  };
}

async function upsertPendingIntent(
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
}

async function markIntentReady(
  config: RecorderConfig,
  channelId: string,
): Promise<void> {
  const key = NotificationIntentKeySchema.parse(
    intentKeyFor(config, channelId),
  );
  await recordDurableWrite(config.facts, "intent-ready", async (db) =>
    transitionIntent(db, { intentKey: key, transition: markReady }),
  );
}

async function createIntent(
  config: RecorderConfig,
  channelId: string,
): Promise<void> {
  await upsertPendingIntent(config, channelId);
  await markIntentReady(config, channelId);
}

/**
 * `startedAt` is passed rather than read from the clock because a recovery
 * adopts a send that began earlier, and `beginSend`'s freshness guard compares
 * against it. The guard stays exactly as the domain wrote it; what changes is
 * that it is given the true instant instead of the recovering pass's own.
 */
async function beginIntentSend(
  config: RecorderConfig,
  channelId: string,
  startedAt: Date,
): Promise<void> {
  const nonce = attemptNonceFor(config, channelId);
  await applyIntentTransition(
    config,
    channelId,
    "intent-send-started",
    (intent) =>
      beginSend(intent, {
        attemptNonce: nonce,
        startedAt: toIsoInstant(startedAt),
      }),
  );
}

async function confirmIntentDelivered(
  config: RecorderConfig,
  channelId: string,
  messageId: string,
  deliveredAt: Date,
): Promise<void> {
  await applyIntentTransition(
    config,
    channelId,
    "intent-delivered",
    confirmDelivery({
      attemptNonce: attemptNonceFor(config, channelId),
      messageId,
      deliveredAt: () => toIsoInstant(deliveredAt),
    }),
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
 * The lifecycle steps still owed to an intent whose send already happened.
 *
 * The domain machine does not allow skipping states, and this does not invent
 * a way around it: it reads where the intent actually stopped and replays the
 * ordinary transitions from exactly there.
 */
type AdoptionStep = "created" | "ready" | "send-started" | "delivered";

function stepsOwedTo(stored: NotificationIntent | null): AdoptionStep[] {
  if (stored === null) {
    return ["created", "ready", "send-started", "delivered"];
  }
  switch (stored.state.kind) {
    case "pending":
      return ["ready", "send-started", "delivered"];
    case "ready":
      return ["send-started", "delivered"];
    case "sending":
      return ["delivered"];
    // These owe only the confirmation, and the domain's answer to it is the
    // point: `delivered` under the same message id is `already-applied`, a
    // different one conflicts, `unknown-delivery` stays the operator's to
    // resolve, and a terminal state that disagrees with a proven send is a
    // conflict worth seeing. Adoption completes a record; it never overwrites
    // evidence that contradicts it.
    case "delivered":
    case "unknown-delivery":
    case "suppressed":
    case "expired":
    case "permission-denied":
      return ["delivered"];
  }
}

/**
 * Adopt a delivery an EARLIER pass performed, from wherever its intent stopped.
 *
 * The `ScoutEffectClaim` is the at-most-once guard, so a `completed` claim is
 * proof the message went out, and it names the message. The intent recording
 * that send is fail-open, though, so the run that sent it may have ended before
 * any of its writes landed: the row can be missing, `pending`, `ready`, or
 * `sending`. Every later pass takes the completed-claim branch and never runs
 * the lifecycle, so this is the only place those rows can still be finished —
 * and finishing them is the whole point of keeping the record.
 *
 * `beginSend` enforces the freshness deadline, and that guard stays exactly as
 * the domain wrote it. It passes because the adopted send is given the instant
 * it REALLY began — the claim row's own `claimedAt`, written immediately before
 * the send ran — rather than the recovering pass's clock. A recovery can run
 * hours after the deadline; the send it is adopting did not.
 *
 * Every step is separately guarded and separately fail-open, so a step that
 * cannot be applied is counted and the rest still run.
 */
async function adoptCompletedDelivery(
  config: RecorderConfig,
  channelId: string,
  messageId: string,
  send: ProvenSend,
): Promise<void> {
  const stored = await readIntent(config, channelId);
  if (stored === "unreadable") return;
  for (const step of stepsOwedTo(stored)) {
    switch (step) {
      case "created":
        await upsertPendingIntent(config, channelId);
        break;
      case "ready":
        await markIntentReady(config, channelId);
        break;
      case "send-started":
        await beginIntentSend(config, channelId, send.startedAt);
        break;
      case "delivered":
        await confirmIntentDelivered(
          config,
          channelId,
          messageId,
          send.deliveredAt,
        );
        break;
    }
  }
}

/**
 * Read the stored intent behind the same fail-open boundary as the writes: a
 * recorder that cannot reach its tables must not throw at a send that already
 * succeeded. `unreadable` is distinct from `null` — absent means "create it",
 * broken means "record nothing this pass".
 */
async function readIntent(
  config: RecorderConfig,
  channelId: string,
): Promise<NotificationIntent | null | "unreadable"> {
  try {
    const stored = await getIntent(config.facts.db, {
      intentKey: NotificationIntentKeySchema.parse(
        intentKeyFor(config, channelId),
      ),
    });
    return stored === null ? null : stored.intent;
  } catch (error) {
    reportDurableWriteFailure("intent-delivered", error);
    return "unreadable";
  }
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
      case "send-started":
        started.add(event.channelId);
        await beginIntentSend(config, event.channelId, config.facts.now());
        return;
      case "delivered":
        await confirmIntentDelivered(
          config,
          event.channelId,
          event.messageId,
          config.facts.now(),
        );
        return;
      case "already-delivered":
        await adoptCompletedDelivery(
          config,
          event.channelId,
          event.messageId,
          event.send,
        );
        return;
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
