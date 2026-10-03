import { recordCoreOutputsDelivered } from "#src/analytics/guild-lifecycle.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { createLogger } from "#src/logger.ts";
import { prematchGuildOfChannel } from "#src/temporal/v2/prematch/prematch-markets.ts";

const logger = createLogger("scout-v2-postmatch-follow-up");

/**
 * Count one delivered V2 post-match report as its guild's core output.
 *
 * v1 counts every guild a report reached once its delivery pass ends
 * (`recordCoreOutputsDelivered(..., "postmatch")` in `match-report-delivery.ts`).
 * V2 delivers each channel from its own notification run, so this counts
 * once per delivered CHANNEL, for the guild that channel belongs to — the
 * same per-channel shape the prematch follow-up uses, resolving the guild
 * from the channel the same way.
 *
 * Best-effort, like the analytics it records: the caller reports a failure
 * rather than failing an answered send over it. A channel no subscription
 * names any more has no guild to count against, which is an answer, not a
 * fault.
 */
export async function afterPostmatchDeliveredV2(
  record: MatchNotificationIntentRecord,
): Promise<void> {
  const state = record.intent.state;
  const target = record.intent.target;
  if (state.kind !== "delivered" || target.kind !== "channel") return;
  const guildId = await prematchGuildOfChannel(target.channelId);
  if (guildId === null) {
    logger.warn(
      `Post-match intent ${record.intent.key} was delivered to channel ${target.channelId}, which no subscription names any more; no guild to count the core output against`,
    );
    return;
  }
  await recordCoreOutputsDelivered([guildId], "postmatch");
}
