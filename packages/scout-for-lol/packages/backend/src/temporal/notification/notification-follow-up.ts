import type { ScoutIntentAttemptRef } from "@scout-for-lol/temporal/pipeline-contracts";
import type { ScoutNotificationFollowUpResult } from "@scout-for-lol/temporal/activity-contracts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { afterDareStatusDelivered } from "#src/temporal/notification/dare-status-notification.ts";
import { afterHallRecordBreakDelivered } from "#src/temporal/notification/hall-record-break-notification.ts";
import { afterPostmatchDelivered } from "#src/temporal/notification/postmatch-follow-up.ts";
import { afterPrematchDelivered } from "#src/temporal/notification/prematch-follow-up.ts";
import { requireIntentRecord } from "#src/temporal/notification-lane/notification-reads.ts";
import { createLogger } from "#src/logger.ts";
import { confirmNotificationTip } from "#src/temporal/notification/notification-presentation.ts";

const logger = createLogger("scout-v2-notification-follow-up");

/**
 * The best-effort work that follows a delivered notification, in its own
 * Activity and after the outcome is durably recorded.
 *
 * Four kinds have any. A delivered Hall record break captures its analytics
 * event, and a delivered post-match report counts its guild's core output
 * (see `postmatch-follow-up.ts`). A delivered prematch records its Bryan Bucks message
 * ref, refreshes the pool's messages, enqueues the game's parlay and counts
 * the guild's core output — v1's `recordPrematchOutputs`, per channel (see
 * `prematch-follow-up.ts`). A Dare result post refreshes the Dare callout once
 * the result has been posted. The Dare refresh used to run inside
 * `deliverNotification`, at the end,
 * guarded by a try/catch — which looks safe and is not. The refresh waits
 * behind its own serialized queue and then edits a Discord message, and either
 * wait can outlive the delivery Activity's ten-second heartbeat timeout. That
 * timeout fires at the Temporal server, OUTSIDE any try/catch this process
 * could write: the Activity is killed, its already-decided `delivered` result
 * never reaches the Workflow, and a message Discord accepted is recorded as an
 * ambiguous send — `unknown-delivery`, which only an operator leaves.
 *
 * Out here none of that is possible. The delivery has already answered, the
 * outcome is already written, and the worst this Activity can do is fail:
 * which it reports rather than throws, because a best-effort refresh is not a
 * reason to retry anything and never was.
 */
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
      return undefined;
  }
}

export async function afterNotificationDelivered(
  input: ScoutIntentAttemptRef,
): Promise<ScoutNotificationFollowUpResult> {
  const record = await requireIntentRecord(input.intentKey);
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
