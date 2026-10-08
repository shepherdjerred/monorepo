import { recordCoreOutputsDelivered } from "#src/analytics/guild-lifecycle.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { createLogger } from "#src/logger.ts";
import {
  claimScoutEffectOnce,
  completeScoutEffect,
} from "#src/temporal/effect-claims.ts";
import { prematchGuildOfChannel } from "#src/temporal/prematch/prematch-markets.ts";

const logger = createLogger("scout-v2-postmatch-follow-up");

/** The effect kind the per-guild postmatch core-output event is claimed under. */
const POSTMATCH_CORE_OUTPUT_EFFECT_KIND = "core-output-postmatch";

function postmatchCoreOutputEffectKey(
  riotMatchId: string,
  guildId: string,
): string {
  return `core-output:postmatch:${riotMatchId}:${guildId}`;
}

/**
 * Count a delivered V2 post-match report as its guild's core output, once per
 * match and guild.
 *
 * v1 counts every guild a report reached once its delivery pass ends
 * (`recordCoreOutputsDelivered(..., "postmatch")` in `match-report-delivery.ts`),
 * so a guild with two subscribed channels is counted once. V2 delivers each
 * channel from its own notification run, and sibling channels of one guild
 * finish within moments of each other, so this claims
 * `core-output:postmatch:<riotMatchId>:<guildId>` first and only the claimant
 * records. The claim is at-most-once (`claimScoutEffectOnce`): a duplicate
 * analytics event is the failure to avoid, and a claimant that dies before
 * recording costs one missed event.
 *
 * Best-effort, like the analytics it records: the caller reports a failure
 * rather than failing an answered send over it. A channel no subscription
 * names any more has no guild to count against, which is an answer, not a
 * fault.
 */
export async function afterPostmatchDelivered(
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
  const key = postmatchCoreOutputEffectKey(record.matchId, guildId);
  const claim = await claimScoutEffectOnce({
    key,
    kind: POSTMATCH_CORE_OUTPUT_EFFECT_KIND,
  });
  if (claim === "taken") return;
  await recordCoreOutputsDelivered([guildId], "postmatch");
  await completeScoutEffect(key);
}
