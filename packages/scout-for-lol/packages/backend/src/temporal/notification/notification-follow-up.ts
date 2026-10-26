import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { createLogger } from "#src/logger.ts";
import { requireIntentRecord } from "#src/temporal/notification-lane/notification-reads.ts";
import { afterDareStatusDelivered } from "#src/temporal/notification/dare-status-notification.ts";
import { afterHallRecordBreakDelivered } from "#src/temporal/notification/hall-record-break-notification.ts";
import { confirmNotificationTip } from "#src/temporal/notification/notification-presentation.ts";
import { afterPostmatchDelivered } from "#src/temporal/notification/postmatch-follow-up.ts";
import { afterPrematchDelivered } from "#src/temporal/notification/prematch-follow-up.ts";
import { afterProductAnnouncementDelivered } from "#src/temporal/notification/product/follow-up.ts";
import type { ScoutNotificationFollowUpResult } from "@scout-for-lol/temporal/activity-contracts";
import type { ScoutIntentAttemptRef } from "@scout-for-lol/temporal/pipeline-contracts";

const logger = createLogger("scout-v2-notification-follow-up");

/**
 * The kinds whose follow-up is genuinely best-effort, and what it is. A Hall
 * record break captures v1's `hall_record_broken` analytics event, and a
 * post-match report its guild's core-output event — bookkeeping that must
 * describe a send Discord accepted, which is why it runs here and not before
 * the send, and which must never turn a delivered announcement into a failed
 * Activity.
 */
function bestEffortFollowUpOf(
  kind: MatchNotificationIntentRecord["intent"]["kind"],
): ((record: MatchNotificationIntentRecord) => Promise<void>) | undefined {
  switch (kind) {
    case "hall-record-break":
      return afterHallRecordBreakDelivered;
    case "postmatch":
      return afterPostmatchDelivered;
    case "prematch":
    case "settlement":
    case "duel-status":
    case "dare-status":
    case "product-announcement":
      return undefined;
  }
}

export async function afterNotificationDelivered(
  input: ScoutIntentAttemptRef,
): Promise<ScoutNotificationFollowUpResult> {
  const record = await requireIntentRecord(input.intentKey);
  if ("announcementId" in record) {
    await afterProductAnnouncementDelivered(record);
    return { outcome: "completed" };
  }
  if ("duelId" in record) return { outcome: "skipped" };
  if ("dareId" in record) {
    try {
      return (await afterDareStatusDelivered(record)) === "refreshed"
        ? { outcome: "completed" }
        : { outcome: "skipped" };
    } catch (error) {
      logger.error(
        `The Dare callout refresh after ${input.intentKey} failed after a delivered send; the delivery itself stands`,
        error,
      );
      return { outcome: "failed" };
    }
  }
  if (record.intent.kind === "prematch" || record.intent.kind === "postmatch")
    await confirmNotificationTip(record);
  if (record.intent.kind === "prematch") {
    // Not caught here, unlike the Dare refresh: the pool's message ref is the
    // settlement announcement's only destination, so a failure to record it
    // is thrown for the Activity's retry to repair. Every step it holds is
    // idempotent, and its genuinely best-effort steps report their own
    // failures (see `prematch-follow-up.ts`).
    return await afterPrematchDelivered(record);
  }
  const bestEffort = bestEffortFollowUpOf(record.intent.kind);
  if (bestEffort === undefined) {
    return { outcome: "skipped" };
  }
  try {
    await bestEffort(record);
    return { outcome: "completed" };
  } catch (error) {
    logger.error(
      `The post-delivery step for ${input.intentKey} failed after a delivered send; the delivery itself stands`,
      error,
    );
    return { outcome: "failed" };
  }
}
