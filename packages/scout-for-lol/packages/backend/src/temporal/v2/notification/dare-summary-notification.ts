import type { MessageCreateOptions } from "discord.js";
import { refreshDareCallout } from "#src/betting/dares/presentation/dare-callout.ts";
import { dareResultMessage } from "#src/betting/dares/presentation/dare-copy.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import {
  dareSettlementSummaryOf,
  dareSummaryAnnouncementCodec,
} from "#src/temporal/v2/notification/announcement-codecs.ts";
import { requireAnnouncementV2 } from "#src/temporal/v2/notification/settlement-notification.ts";

/**
 * The Dare-shaped notification: what a `dare-summary` intent delivers.
 *
 * One intent is one Dare's resolution, announced once in the Dare's own
 * channel with the restricted mention allowlist v1 uses, built by v1's
 * `dareResultMessage` from the summary the Dare settlement produced and the
 * intent carries. A `captured` or `abandoned` resolution produces no message
 * in v1 and must not be minted as an intent; one that reaches here is a
 * broken contract.
 *
 * v1 follows the send with a best-effort edit of the public callout — final
 * content, components removed — read back from the database. That is kept,
 * as a post-delivery step the arm runs only after Discord accepted the send,
 * and it can never change the delivery outcome: `refreshDareCallout` logs
 * its own failures and never throws.
 */
export function buildDareSummaryNotificationMessageV2(
  record: MatchNotificationIntentRecord,
): MessageCreateOptions {
  const summary = dareSettlementSummaryOf(
    dareSummaryAnnouncementCodec.parse(requireAnnouncementV2(record)),
  );
  const message = dareResultMessage(summary);
  if (message === undefined) {
    throw new Error(
      `Dare-summary intent ${record.intent.key} resolves as ${summary.resolution}, which produces no result message and must not be minted`,
    );
  }
  return {
    content: message.content,
    allowedMentions: { parse: [], users: message.mentionUserIds },
  };
}

/** The callout refresh v1 performs once the result message is out. */
export async function afterDareSummaryDeliveredV2(
  record: MatchNotificationIntentRecord,
): Promise<void> {
  const summary = dareSettlementSummaryOf(
    dareSummaryAnnouncementCodec.parse(requireAnnouncementV2(record)),
  );
  if (summary.messageRef === null) return;
  await refreshDareCallout(summary.dareId);
}
