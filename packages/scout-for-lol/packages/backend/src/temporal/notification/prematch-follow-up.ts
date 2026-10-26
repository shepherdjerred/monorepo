import { recordCoreOutputsDelivered } from "#src/analytics/guild-lifecycle.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { prematchGuildOfChannel } from "#src/temporal/prematch/prematch-markets.ts";
import type { ScoutNotificationFollowUpResult } from "@scout-for-lol/temporal/activity-contracts";
export async function afterPrematchDelivered(
  record: MatchNotificationIntentRecord,
): Promise<ScoutNotificationFollowUpResult> {
  if (
    record.intent.state.kind !== "delivered" ||
    record.intent.target.kind !== "channel"
  )
    return { outcome: "skipped" };
  const guildId = await prematchGuildOfChannel(record.intent.target.channelId);
  if (guildId === null) return { outcome: "skipped" };
  await recordCoreOutputsDelivered([guildId], "prematch");
  return { outcome: "completed" };
}
