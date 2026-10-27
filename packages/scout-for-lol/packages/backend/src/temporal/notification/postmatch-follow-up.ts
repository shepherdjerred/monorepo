import { z } from "zod";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import {
  DiscordGuildIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/domain/identity/discord.ts";
import { ReceiptKindSchema } from "@scout-for-lol/domain/match-processing/states.ts";
import { recordCoreOutputsDelivered } from "#src/analytics/guild-lifecycle.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { prisma } from "#src/database/index.ts";
import { toIsoInstant } from "#src/durable/match/match-identity.ts";
import { buildMatchReceipt } from "#src/durable/match/receipt-evidence.ts";
import { createLogger } from "#src/logger.ts";
import { subscriptionGuildOfChannel } from "#src/temporal/notification/subscription-guild.ts";

const logger = createLogger("scout-v2-postmatch-follow-up");

/**
 * The receipt that a match's post-match report was counted as its guild's
 * core output. Guild-scoped, so sibling channels of one guild share one
 * identity and the receipt's unique constraint lets exactly one of them win.
 */
export const POSTMATCH_CORE_OUTPUT_RECEIPT_KIND = ReceiptKindSchema.parse(
  "postmatch-core-output",
);

/**
 * The evidence names the guild the receipt's scope already names and nothing
 * channel-specific, so every sibling channel builds byte-identical evidence and
 * the losers are answered `already-applied`, never `conflict`.
 */
const postmatchCoreOutputEvidenceCodec = defineVersionedCodec({
  kind: "scout-postmatch-core-output",
  version: 1,
  schema: z.strictObject({ guildId: DiscordGuildIdSchema }),
});

/**
 * Count a delivered V2 post-match report as its guild's core output, once per
 * match and guild.
 *
 * v1 counts every guild a report reached once its delivery pass ends
 * (`recordCoreOutputsDelivered(..., "postmatch")` in `match-report-delivery.ts`),
 * so a guild with two subscribed channels is counted once. V2 delivers each
 * channel from its own notification run, and sibling channels of one guild
 * finish within moments of each other, so this records the guild-scoped
 * `postmatch-core-output` receipt first and only the writer the table answers
 * `applied` records the event. That is at-most-once: a duplicate analytics
 * event is the failure to avoid, and a writer that dies between the receipt
 * and the event costs one missed event.
 *
 * Best-effort, like the analytics it records: the caller reports a failure
 * rather than failing an answered send over it. A channel no subscription
 * names any more has no guild to count against, which is an answer, not a
 * fault. A `conflict` is a broken contract — the evidence is derived from the
 * scope alone — and fails loudly.
 */
export async function afterPostmatchDelivered(
  record: MatchNotificationIntentRecord,
): Promise<void> {
  const state = record.intent.state;
  const target = record.intent.target;
  if (state.kind !== "delivered" || target.kind !== "channel") return;
  const guildId = await subscriptionGuildOfChannel(target.channelId);
  if (guildId === null) {
    logger.warn(
      `Post-match intent ${record.intent.key} was delivered to channel ${target.channelId}, which no subscription names any more; no guild to count the core output against`,
    );
    return;
  }
  const counted = await recordPostmatchCoreOutputReceipt(record, guildId);
  if (counted.outcome === "conflict") {
    throw new Error(
      `Post-match core-output receipt for ${record.matchId} in guild ${guildId} conflicts with its own scope-derived evidence`,
    );
  }
  if (counted.outcome === "already-applied") return;
  await recordCoreOutputsDelivered([guildId], "postmatch");
}

async function recordPostmatchCoreOutputReceipt(
  record: MatchNotificationIntentRecord,
  guildId: DiscordGuildId,
) {
  return await recordReceipt(
    prisma,
    buildMatchReceipt({
      matchId: record.matchId,
      kind: POSTMATCH_CORE_OUTPUT_RECEIPT_KIND,
      scope: { kind: "guild", guildId },
      recordedAt: toIsoInstant(new Date()),
      evidence: postmatchCoreOutputEvidenceCodec.serialize({ guildId }),
    }),
  );
}
