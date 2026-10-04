import type { ScoutIntentAttemptRefV2 } from "@scout-for-lol/temporal/contracts-v2";
import type { ScoutNotificationFollowUpV2Result } from "@scout-for-lol/temporal/activity-contracts-v2";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { afterDareSummaryDeliveredV2 } from "#src/temporal/v2/notification/dare-summary-notification.ts";
import { afterHallRecordBreakDeliveredV2 } from "#src/temporal/v2/notification/hall-record-break-notification.ts";
import { afterPostmatchDeliveredV2 } from "#src/temporal/v2/notification/postmatch-follow-up.ts";
import { afterPrematchDeliveredV2 } from "#src/temporal/v2/notification/prematch-follow-up.ts";
import { requireIntentRecordV2 } from "#src/temporal/v2/notification-reads.ts";
import { createLogger } from "#src/logger.ts";
import { confirmNotificationTip } from "#src/temporal/v2/notification/notification-presentation.ts";

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
 * `prematch-follow-up.ts`). A Dare summary refreshes the Dare callout once the
 * result has been posted. The Dare refresh used to run inside
 * `deliverNotificationV2`, at the end,
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
    case "dare-summary":
      return afterDareSummaryDeliveredV2;
    case "hall-record-break":
      return afterHallRecordBreakDeliveredV2;
    case "postmatch":
      return afterPostmatchDeliveredV2;
    case "prematch":
    case "settlement":
    case "duel-status":
    case "dare-status":
      return undefined;
  }
}

export async function afterNotificationDeliveredV2(
  input: ScoutIntentAttemptRefV2,
): Promise<ScoutNotificationFollowUpV2Result> {
  const record = await requireIntentRecordV2(input.intentKey);
  if ("duelId" in record || "dareId" in record) {
    return { outcome: "skipped" };
  }
  if (record.intent.kind === "prematch" || record.intent.kind === "postmatch")
    await confirmNotificationTip(record);
  if (record.intent.kind === "prematch") {
    // Not caught here, unlike the Dare refresh: the pool's message ref is the
    // settlement announcement's only destination, so a failure to record it
    // is thrown for the Activity's retry to repair. Every step it holds is
    // idempotent, and its genuinely best-effort steps report their own
    // failures (see `prematch-follow-up.ts`).
    return await afterPrematchDeliveredV2(record);
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
