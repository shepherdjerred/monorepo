import type { MessageCreateOptions } from "discord.js";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { freezeNotificationMessage } from "#src/temporal/v2/notification/notification-presentation.ts";
import type { NotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { buildDuelStatusNotificationMessageV2 } from "#src/temporal/v2/notification/duel-status-notification.ts";
import { buildDareStatusNotificationMessageV2 } from "#src/temporal/v2/notification/dare-status-notification.ts";
import { buildHallRecordBreakNotificationMessageV2 } from "#src/temporal/v2/notification/hall-record-break-notification.ts";
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
  record: NotificationIntentRecord,
  abortSignal: AbortSignal,
  deliveryGuildId?: string,
): Promise<MessageCreateOptions> {
  if ("duelId" in record) {
    return await buildDuelStatusNotificationMessageV2(record, deliveryGuildId);
  }
  if ("dareId" in record) {
    return buildDareStatusNotificationMessageV2(record);
  }
  if (record.intent.kind === "duel-status") {
    throw new Error(
      `Intent ${record.intent.key}: duel-status requires a Duel subject`,
    );
  }
  if (record.intent.kind === "dare-status") {
    throw new Error(
      `Intent ${record.intent.key}: dare-status requires a Dare subject`,
    );
  }
  const riotMatchId = record.matchId;
  switch (record.intent.kind) {
    // The announcement kinds have no artifact: their render attested
    // `text-only`, and their message is built from the intent's own payload.
    case "settlement":
      return await buildSettlementNotificationMessageV2(record);
    case "hall-record-break":
      return buildHallRecordBreakNotificationMessageV2(record);
    case "postmatch":
      return await freezeNotificationMessage(
        record,
        buildPostmatchNotificationMessageV2(
          riotMatchId,
          await readAttestedReportArtifactV2(riotMatchId, abortSignal),
        ),
        deliveryGuildId,
      );
    case "prematch": {
      const saved = await prisma.notificationPresentation.findUnique({
        where: { intentKey: record.intent.key },
      });
      const presentation =
        saved?.guildPrematchArtifact === true
          ? {
              guildId: DiscordGuildIdSchema.parse(saved.serverId),
              clashEnabled: saved.clashEnabled,
            }
          : undefined;
      return await freezeNotificationMessage(
        record,
        await buildPrematchNotificationMessageV2(
          riotMatchId,
          await readAttestedPrematchArtifactV2(
            riotMatchId,
            abortSignal,
            presentation,
          ),
          record.intent.target,
          presentation?.clashEnabled,
        ),
        deliveryGuildId,
      );
    }
  }
}
