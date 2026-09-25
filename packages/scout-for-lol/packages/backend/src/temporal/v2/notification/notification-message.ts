import type { MessageCreateOptions } from "discord.js";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { buildDareSummaryNotificationMessageV2 } from "#src/temporal/v2/notification/dare-summary-notification.ts";
import {
  readAttestedPrematchArtifactV2,
  readAttestedReportArtifactV2,
} from "#src/temporal/v2/notification/notification-artifact.ts";
import { buildPostmatchNotificationMessageV2 } from "#src/temporal/v2/notification/postmatch-notification.ts";
import { buildPrematchNotificationMessageV2 } from "#src/temporal/v2/notification/prematch-notification.ts";
import { buildSettlementNotificationMessageV2 } from "#src/temporal/v2/notification/settlement-notification.ts";

/**
 * The message this intent delivers, assembled from what the render Activity
 * attested and shaped by the intent's KIND.
 *
 * For a `postmatch` intent the message is rebuilt from the report the render
 * attested — image, review, content and components — with nothing read but the
 * receipt and the objects it names: no Riot payload, no rank, no flag, no
 * model. For a `prematch` intent the verified bytes become the loading screen
 * on v1's prematch payload, built from the archived spectator snapshot. In both
 * the attachment on the message IS the attested object, so the receipt's claim
 * about what was delivered stays true by construction — and a prematch intent
 * cannot be delivered as a post-match report, because its arm never reads one.
 * The kind-specific reader refuses a receipt that attests anything its kind
 * cannot deliver, and the delivery treats that refusal as terminal.
 *
 * Nothing here contacts Discord: every failure it raises is decided before the
 * send, which is what lets `notification-delivery.ts` classify them rather than
 * calling them ambiguous. The signal is the delivery's pre-send budget, so a
 * slow object store is answered by the Activity rather than by the timeout
 * that would otherwise answer for it.
 */
export async function buildAttestedMessageV2(
  record: MatchNotificationIntentRecord,
  abortSignal: AbortSignal,
): Promise<MessageCreateOptions> {
  const riotMatchId = record.matchId;
  switch (record.intent.kind) {
    // The two announcement kinds have no artifact: their render attested
    // `text-only`, and their message is built from the intent's own payload.
    case "settlement":
      return await buildSettlementNotificationMessageV2(record);
    case "dare-summary":
      return buildDareSummaryNotificationMessageV2(record);
    case "postmatch":
      return buildPostmatchNotificationMessageV2(
        riotMatchId,
        await readAttestedReportArtifactV2(riotMatchId, abortSignal),
      );
    case "prematch":
      return await buildPrematchNotificationMessageV2(
        riotMatchId,
        await readAttestedPrematchArtifactV2(riotMatchId, abortSignal),
        record.intent.target,
      );
  }
}
