import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { DiscordChannelId } from "@scout-for-lol/domain/identity/discord.ts";
import type {
  NotificationIntentKind,
  NotificationRetirementReason,
} from "@scout-for-lol/domain/notifications/intent.ts";
import {
  retireOrphaned,
  type NotificationConflictReason,
  type NotificationTransitionResult,
} from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import type { Db } from "#src/database/index.ts";
import {
  listRetirableIntents,
  transitionIntent,
} from "#src/database/durable/intent-repository.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { scoutDurableNotificationIntentsRetired } from "#src/metrics/durable-pipeline.ts";
import { createLogger } from "#src/logger.ts";

/**
 * Retiring notification intents whose audience was deleted before delivery.
 *
 * An intent names one audience: a channel, reached through the subscriptions
 * that routed a match there when the intent was minted. When that audience is
 * gone the intent can never be sent correctly, and the prior ruling is to
 * retire it — never to reconstruct an identity for it by re-deriving a target
 * from whatever the channel or the subscriptions look like now. The retirement
 * is the domain's `retireOrphaned`, which only ever moves `pending` or `ready`
 * and loses to any send in flight.
 *
 * This module owns the evidence the database can give on its own, which is
 * cheap enough for both callers: the send path asks it before minting an
 * attempt, and the scheduled sweep asks it for every drivable intent it can
 * see. The Discord evidence — a deleted channel, a guild Scout left — is the
 * send path's alone (`temporal/v2/notification/intent-audience.ts`), because it
 * costs a request per intent.
 */

const logger = createLogger("notification-intent-retirement");

/**
 * The kinds whose audience IS a set of subscriptions.
 *
 * A match report and a game-start announcement go to the channels subscribed
 * to a tracked player in the match. A settlement recap and a Dare result go to
 * the channel the pool or Dare was posted in, which no subscription names, so
 * the subscription table says nothing about whether their audience stands.
 */
export const SUBSCRIPTION_AUDIENCE_KINDS: ReadonlySet<NotificationIntentKind> =
  new Set<NotificationIntentKind>(["postmatch", "prematch"]);

/**
 * Whether any subscription in the intent's channel still follows the match.
 *
 * When the match has tracked-account rows, the subscription must follow one of
 * those accounts: a channel that unsubscribed the only player in the game, or
 * whose tracked account was removed, has lost this match's audience even if
 * it still follows somebody else. A match with no tracked-account rows yet —
 * a game-start announcement is minted before the archive records them — has
 * nothing to compare against, so the question narrows to whether the channel
 * holds any subscription at all. That is the conservative reading: it can
 * leave an orphan for the send to discover, never retire a live audience.
 *
 * A muted subscription still stands. Muting is a choice about delivery that
 * the subscription's owner can reverse; it is not the audience being deleted.
 */
export async function subscriptionAudienceStands(
  db: Db,
  args: { matchId: RiotMatchId; channelId: DiscordChannelId },
): Promise<boolean> {
  const { channelId } = args;
  const tracked = await db.matchTrackedAccount.findMany({
    where: { riotMatchId: args.matchId },
    select: { puuid: true },
  });
  const standing = await db.subscription.findFirst({
    where:
      tracked.length === 0
        ? { channelId }
        : {
            channelId,
            player: {
              accounts: {
                some: { puuid: { in: tracked.map((row) => row.puuid) } },
              },
            },
          },
    select: { id: true },
  });
  return standing !== null;
}

/**
 * The retirement the database alone justifies for this intent, if any.
 *
 * Answers only for a channel intent of a subscription-backed kind; every
 * other intent has no database evidence either way.
 */
export async function subscriptionRetirementOf(
  db: Db,
  record: MatchNotificationIntentRecord,
): Promise<"subscription-deleted" | undefined> {
  const target = record.intent.target;
  if (target.kind !== "channel") return undefined;
  if (!SUBSCRIPTION_AUDIENCE_KINDS.has(record.intent.kind)) return undefined;
  return (await subscriptionAudienceStands(db, {
    matchId: record.matchId,
    channelId: target.channelId,
  }))
    ? undefined
    : "subscription-deleted";
}

/** Who discovered the missing audience: a send about to begin, or the sweep. */
export type NotificationRetirementSource = "send" | "sweep";

/**
 * Apply `retireOrphaned` through the guarded write, and count what it did.
 *
 * Counted and logged only when this call applied it, so a replay or a racing
 * writer never inflates the series.
 */
export async function retireNotificationIntent(
  db: Db,
  args: {
    record: MatchNotificationIntentRecord;
    reason: NotificationRetirementReason;
    source: NotificationRetirementSource;
  },
): Promise<NotificationTransitionResult> {
  const { record, reason, source } = args;
  const result = await transitionIntent(db, {
    intentKey: record.intent.key,
    transition: (intent) => retireOrphaned(intent, { reason }),
  });
  if (result.outcome === "applied") {
    scoutDurableNotificationIntentsRetired.inc({ reason, source });
    logger.info(
      `Retired ${record.intent.kind} intent ${record.intent.key} for ${record.matchId}: its audience is gone (${reason}); nothing will be sent`,
      { intentKey: record.intent.key, reason, source },
    );
  }
  return result;
}

export type NotificationIntentRetirementCounts = {
  /** Drivable subscription-backed intents the sweep examined. */
  selected: number;
  /** Intents this run retired. */
  retired: number;
  /** Intents a concurrent writer had already retired for the same reason. */
  alreadyRetired: number;
  /** Refusals by the domain's reason: a racing writer moved the intent first. */
  conflicts: Partial<Record<NotificationConflictReason, number>>;
  /** The batch was full, so later intents were not examined this run. */
  batchFilled: boolean;
};

/**
 * The sweep's half: retire drivable intents whose subscriptions are gone.
 *
 * Database evidence only — the Discord half costs a request per intent and
 * stays on the send path. The selection is the still-fresh `pending` and
 * `ready` intents of the subscription-backed kinds, oldest first; an overdue
 * one is the expiry sweep's, and an attempted one is never offered. The
 * domain refusing anything else is the second line, not the first: a
 * `beginSend` that commits between this read and its write makes the guard
 * miss and the re-read answers `send-in-flight`.
 *
 * The batch examines live intents too, and those simply stay. The drivable
 * backlog this runs over is small by construction — the notification child
 * drains it in seconds — so the oldest `limit` are the ones worth asking
 * about; an orphan past the batch is still retired by its own send.
 */
export async function retireOrphanedNotificationIntents(
  db: Db,
  args: { now: Date; limit: number },
): Promise<NotificationIntentRetirementCounts> {
  const records = await listRetirableIntents(db, {
    now: args.now,
    kinds: [...SUBSCRIPTION_AUDIENCE_KINDS],
    limit: args.limit,
  });
  const counts: NotificationIntentRetirementCounts = {
    selected: records.length,
    retired: 0,
    alreadyRetired: 0,
    conflicts: {},
    batchFilled: records.length === args.limit,
  };
  for (const record of records) {
    const reason = await subscriptionRetirementOf(db, record);
    if (reason === undefined) continue;
    const result = await retireNotificationIntent(db, {
      record,
      reason,
      source: "sweep",
    });
    switch (result.outcome) {
      case "applied":
        counts.retired += 1;
        break;
      case "already-applied":
        counts.alreadyRetired += 1;
        break;
      case "conflict":
        counts.conflicts[result.reason] =
          (counts.conflicts[result.reason] ?? 0) + 1;
        break;
    }
  }
  return counts;
}
