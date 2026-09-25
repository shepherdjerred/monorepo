import {
  expire,
  type NotificationConflictReason,
} from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import type { Db } from "#src/database/index.ts";
import {
  listOverdueIntentKeys,
  transitionIntent,
} from "#src/database/durable/intent-repository.ts";
import { createLogger } from "#src/logger.ts";

/**
 * The expiry sweep: move unattempted intents past their freshness deadline to
 * the domain's terminal `expired`.
 *
 * `beginSend` refuses any start after the deadline, so a `pending` or `ready`
 * intent that is overdue can never be sent, and nothing else would ever move
 * it: without this sweep it sits in a drivable state forever, inflating the
 * drivable series of `scout_durable_notification_intents` and hiding the
 * intents that really are stuck.
 *
 * Every write is the domain's `expire` applied through `transitionIntent`,
 * whose update is guarded by the exact state the snapshot observed. A
 * `beginSend` that commits between this sweep's read and its write therefore
 * makes the guard miss, and the re-read answers `send-in-flight` rather than
 * clobbering the attempt. The selection only ever offers `pending` and
 * `ready`; the domain refusing everything else is the second line, not the
 * first.
 */

const logger = createLogger("notification-intent-expiry");

/**
 * One run's budget. The backlog this exists for is dozens of rows; the bound
 * keeps a pathological backlog from turning one Activity into an unbounded
 * loop, and the next scheduled run takes the rest.
 */
export const NOTIFICATION_INTENT_EXPIRY_BATCH = 200;

export type NotificationIntentExpiryCounts = {
  /** Overdue `pending`/`ready` intents the selection returned. */
  selected: number;
  /** Intents this run moved to `expired`. */
  expired: number;
  /** Intents a concurrent writer had already expired. */
  alreadyExpired: number;
  /** Refusals by the domain's reason: a racing writer moved the intent first. */
  conflicts: Partial<Record<NotificationConflictReason, number>>;
  /** The batch was full, so more overdue intents may remain for the next run. */
  batchFilled: boolean;
};

export async function expireOverdueNotificationIntents(
  db: Db,
  args: { now: Date; limit: number },
): Promise<NotificationIntentExpiryCounts> {
  const keys = await listOverdueIntentKeys(db, args);
  const counts: NotificationIntentExpiryCounts = {
    selected: keys.length,
    expired: 0,
    alreadyExpired: 0,
    conflicts: {},
    batchFilled: keys.length === args.limit,
  };
  for (const intentKey of keys) {
    const result = await transitionIntent(db, {
      intentKey,
      transition: expire,
    });
    switch (result.outcome) {
      case "applied":
        counts.expired += 1;
        break;
      case "already-applied":
        counts.alreadyExpired += 1;
        break;
      case "conflict":
        counts.conflicts[result.reason] =
          (counts.conflicts[result.reason] ?? 0) + 1;
        break;
    }
  }
  return counts;
}

/** The scheduled entry point: the process database and the wall clock. */
export async function runNotificationIntentExpiry(): Promise<NotificationIntentExpiryCounts> {
  const { prisma } = await import("#src/database/index.ts");
  const counts = await expireOverdueNotificationIntents(prisma, {
    now: new Date(),
    limit: NOTIFICATION_INTENT_EXPIRY_BATCH,
  });
  logger.info(
    `Notification intent expiry: expired ${counts.expired.toString()} of ${counts.selected.toString()} overdue intent(s)`,
    counts,
  );
  return counts;
}
