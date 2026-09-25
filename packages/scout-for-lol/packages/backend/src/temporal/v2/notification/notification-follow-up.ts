import type { ScoutIntentAttemptRefV2 } from "@scout-for-lol/temporal/contracts-v2";
import type { ScoutNotificationFollowUpV2Result } from "@scout-for-lol/temporal/activity-contracts-v2";
import { afterDareSummaryDeliveredV2 } from "#src/temporal/v2/notification/dare-summary-notification.ts";
import { afterPrematchDeliveredV2 } from "#src/temporal/v2/notification/prematch-follow-up.ts";
import { requireIntentRecordV2 } from "#src/temporal/v2/notification-reads.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("scout-v2-notification-follow-up");

/**
 * The best-effort work that follows a delivered notification, in its own
 * Activity and after the outcome is durably recorded.
 *
 * Two kinds have any. A delivered prematch records its Bryan Bucks message
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
export async function afterNotificationDeliveredV2(
  input: ScoutIntentAttemptRefV2,
): Promise<ScoutNotificationFollowUpV2Result> {
  const record = await requireIntentRecordV2(input.intentKey);
  if (record.intent.kind === "prematch") {
    // Not caught here, unlike the Dare refresh: the pool's message ref is the
    // settlement announcement's only destination, so a failure to record it
    // is thrown for the Activity's retry to repair. Every step it holds is
    // idempotent, and its genuinely best-effort steps report their own
    // failures (see `prematch-follow-up.ts`).
    return await afterPrematchDeliveredV2(record);
  }
  if (record.intent.kind !== "dare-summary") {
    return { outcome: "skipped" };
  }
  try {
    await afterDareSummaryDeliveredV2(record);
    return { outcome: "completed" };
  } catch (error) {
    logger.error(
      `The post-delivery step for ${input.intentKey} failed after a delivered send; the delivery itself stands`,
      error,
    );
    return { outcome: "failed" };
  }
}
